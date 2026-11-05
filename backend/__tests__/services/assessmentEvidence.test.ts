import { describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import { getNamingEvidence } from '../../src/services/assessmentEvidence.js';

function getFormControlUnit(html: string) {
  const adapted = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
  if (!('input' in adapted)) {
    throw new Error('Expected the form context to be available for the test.');
  }
  const unit = adapted.input.units.find(
    (candidate) => candidate.focal.kind === 'form-control',
  );
  if (!unit) {
    throw new Error('Expected a form-control context unit for the test.');
  }
  return unit;
}

describe('getNamingEvidence', () => {
  it('returns the target first and complete naming evidence in relationship order', () => {
    const unit = getFormControlUnit(
      '<form><label for="name">Full name</label><span id="override">Display name</span><span id="help">Use your full name</span><input id="name" aria-labelledby="override" aria-describedby="help"></form>',
    );

    const evidence = getNamingEvidence(unit);
    const namingEvidenceIds = unit.relationships
      .filter(
        (relationship) =>
          ['native-label', 'aria-labelledby'].includes(relationship.kind) &&
          relationship.destination.status === 'resolved' &&
          relationship.destination.record.recordType === 'evidence' &&
          relationship.completeness.status === 'complete',
      )
      .map((relationship) => relationship.destination.record.id);
    const expectedEvidence = namingEvidenceIds.map((id) => {
      const record = unit.associatedEvidence.find(
        ({ evidence: candidate }) => candidate.id === id,
      )?.evidence;
      if (!record) {
        throw new Error(`Expected associated evidence ${id} to be present.`);
      }
      return {
        record: { recordType: 'evidence' as const, id },
        ...(record.text ? { text: record.text.value } : {}),
      };
    });

    expect(evidence).toEqual([
      {
        record: { recordType: 'target', id: unit.focal.id },
        ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
      },
      ...expectedEvidence,
    ]);
    expect(evidence.map(({ text }) => text).filter(Boolean)).not.toContain(
      'Use your full name',
    );
  });

  it('does not include unresolved naming relationships', () => {
    const unit = getFormControlUnit(
      '<form><input id="name" aria-labelledby="missing"></form>',
    );

    expect(getNamingEvidence(unit)).toEqual([
      {
        record: { recordType: 'target', id: unit.focal.id },
        ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
      },
    ]);
  });

  it('does not include incomplete naming relationships', () => {
    const unit = getFormControlUnit(
      '<form><label for="name">Full name</label><input id="name"></form>',
    );
    const relationship = unit.relationships.find(
      (candidate) => candidate.kind === 'native-label',
    );
    if (
      !relationship ||
      relationship.destination.status !== 'resolved' ||
      relationship.destination.record.recordType !== 'evidence'
    ) {
      throw new Error('Expected a resolved native-label relationship.');
    }

    const evidenceId = relationship.destination.record.id;
    relationship.completeness = {
      status: 'partial',
      reason: 'candidate-list-limit',
    };

    expect(getNamingEvidence(unit)).toEqual([
      {
        record: { recordType: 'target', id: unit.focal.id },
        ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
      },
    ]);
    expect(getNamingEvidence(unit).map(({ record }) => record.id)).not.toContain(
      evidenceId,
    );
  });
});
