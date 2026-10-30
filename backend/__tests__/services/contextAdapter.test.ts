import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, ElementContext } from '../../src/types/context.js';
import {
  MAX_ASSOCIATED_CONTEXT_RECORDS,
  MAX_GROUP_EVIDENCE_CHARACTERS,
  MAX_GROUP_SERIALIZED_CHARACTERS,
  adaptContextSnapshot,
} from '../../src/services/contextAdapter.js';

function element(
  contextId: string,
  relationships: Partial<ElementContext['relationships']> = {},
  fields: Partial<ElementContext> = {},
): ElementContext {
  return {
    contextId,
    tagName: 'div',
    kind: 'other',
    attributes: { aria: {} },
    nameEvidence: [],
    relationships: {
      childContextIds: [],
      labelContextIds: [],
      labelledByContextIds: [],
      describedByContextIds: [],
      ...relationships,
    },
    ...fields,
  };
}

function snapshot(...elements: ElementContext[]): ContextSnapshot {
  return { schemaVersion: 1, elementsTruncated: false, elements };
}

function unitFor(
  result: ReturnType<typeof adaptContextSnapshot>,
  contextId: string,
) {
  if (result.status !== 'ready' && result.status !== 'partial') {
    throw new Error(`Expected adapter result with units, got ${result.status}`);
  }
  const unit = result.units.find((item) => item.focal.contextId === contextId);
  if (!unit) {
    throw new Error(`Expected focal unit for ${contextId}`);
  }
  return unit;
}

describe('adaptContextSnapshot', () => {
  it('produces stable output for identical snapshots and identifies each focal element', () => {
    const input = snapshot(
      element('focus', { labelledByContextIds: ['label'] }),
      element('label', {}, {
        tagName: 'span',
        text: { ownText: 'Name', truncated: false },
      }),
    );

    const first = adaptContextSnapshot(input);
    const second = adaptContextSnapshot(input);

    expect(first).toEqual(second);
    expect(unitFor(first, 'focus').focal.evidence.contextId).toBe('focus');
    expect(unitFor(first, 'label').focal.evidence.contextId).toBe('label');
  });

  it('preserves relationship types and source IDs for associated evidence', () => {
    const input = snapshot(
      element('focus', {
        labelContextIds: ['label'],
        labelledByContextIds: ['aria-label'],
        describedByContextIds: ['description'],
        parentContextId: 'parent',
        childContextIds: ['child'],
      }),
      element('label'),
      element('aria-label'),
      element('description'),
      element('parent'),
      element('child'),
    );

    const unit = unitFor(adaptContextSnapshot(input), 'focus');
    const relationshipByTarget = new Map(
      unit.associated.map((record) => [
        record.contextId,
        record.relationshipProvenance.map((item) => item.relationship),
      ]),
    );

    expect(relationshipByTarget.get('label')).toContain('native-label');
    expect(relationshipByTarget.get('aria-label')).toContain(
      'aria-labelledby',
    );
    expect(relationshipByTarget.get('description')).toContain(
      'aria-describedby',
    );
    expect(relationshipByTarget.get('parent')).toContain('parent');
    expect(relationshipByTarget.get('child')).toContain('child');
    expect(
      unit.associated.find((record) => record.contextId === 'aria-label')
        ?.relationshipProvenance[0],
    ).toMatchObject({
      sourceContextId: 'focus',
      targetContextId: 'aria-label',
      direction: 'outgoing',
    });
    expect(
      unitFor(adaptContextSnapshot(input), 'label')
        .associated.find((record) => record.contextId === 'focus')
        ?.relationshipProvenance,
    ).toContainEqual(
      expect.objectContaining({
        relationship: 'native-label',
        direction: 'incoming',
        sourceContextId: 'focus',
        targetContextId: 'label',
      }),
    );
  });

  it('deduplicates associated records while retaining distinct relationship provenance', () => {
    const input = snapshot(
      element('focus', {
        labelContextIds: ['shared'],
        labelledByContextIds: ['shared', 'shared'],
      }),
      element('shared'),
    );
    const unit = unitFor(adaptContextSnapshot(input), 'focus');

    expect(unit.associated).toHaveLength(1);
    expect(
      unit.associated[0]?.relationshipProvenance.map(
        (item) => item.relationship,
      ),
    ).toEqual(['native-label', 'aria-labelledby']);
  });

  it('distinguishes unresolved references from explicitly omitted targets', () => {
    const unresolved = unitFor(
      adaptContextSnapshot(
        snapshot(element('focus', { labelledByContextIds: ['not-in-snapshot'] })),
      ),
      'focus',
    );
    const omitted = unitFor(
      adaptContextSnapshot(
        snapshot(
          element('focus', {
            labelledByTargetsOmitted: true,
            labelledByContextIds: [],
          }),
        ),
      ),
      'focus',
    );

    expect(unresolved.completeness.unresolvedRelationshipReferences).toBe(true);
    expect(unresolved.completeness.labelledByTargetsOmitted).toBe(false);
    expect(omitted.completeness.unresolvedRelationshipReferences).toBe(false);
    expect(omitted.completeness.labelledByTargetsOmitted).toBe(true);
    expect(unresolved.completeness.status).toBe('partial');
    expect(omitted.completeness.status).toBe('partial');
  });

  it('propagates snapshot and source text truncation', () => {
    const input: ContextSnapshot = {
      schemaVersion: 1,
      elementsTruncated: true,
      elements: [
        element(
          'focus',
          {
            labelledByReferencesTruncated: true,
            describedByReferencesTruncated: true,
            labelledByTargetsTruncated: true,
            describedByTargetsTruncated: true,
            labelledByTargetsOmitted: true,
            describedByTargetsOmitted: true,
            labelTargetsOmitted: true,
          },
          { text: { ownText: 'Some text', truncated: true } },
        ),
      ],
    };
    const result = adaptContextSnapshot(input);

    expect(result.status).toBe('partial');
    expect(unitFor(result, 'focus').completeness).toMatchObject({
      snapshotElementsTruncated: true,
      sourceTextTruncated: true,
      labelledByReferencesTruncated: true,
      describedByReferencesTruncated: true,
      labelledByTargetsTruncated: true,
      describedByTargetsTruncated: true,
      labelledByTargetsOmitted: true,
      describedByTargetsOmitted: true,
      nativeLabelTargetsOmitted: true,
      status: 'partial',
    });
  });

  it('caps associated records and serialized group size while reporting omissions', () => {
    const associatedIds = Array.from(
      { length: 20 },
      (_, index) => `associated-${String(index).padStart(2, '0')}`,
    );
    const input = snapshot(
      element(
        'focus',
        {
          childContextIds: associatedIds,
        },
        {
          nameEvidence: ([
              'aria-label',
              'aria-labelledby',
              'explicit-label',
              'wrapping-label',
              'alt',
              'title',
              'text-content',
              'value-attribute',
            ] as const).map((source) => ({
              source,
              targetContextIds: Array.from(
                { length: 8 },
                (_, targetIndex) =>
                  `missing-${String(targetIndex).padStart(56, 'x')}`,
              ),
            })),
          text: {
            ownText: 'f'.repeat(500),
            nearbyText: 'n'.repeat(200),
            truncated: false,
          },
        },
      ),
      ...associatedIds.map((id) =>
        element(id, {}, {
          text: {
            ownText: 'a'.repeat(500),
            nearbyText: 'b'.repeat(200),
            truncated: false,
          },
          attributes: { aria: { 'aria-label': 'c'.repeat(250) } },
        }),
      ),
    );
    const result = adaptContextSnapshot(input);
    const unit = unitFor(result, 'focus');
    const serialized = JSON.stringify(unit);
    const records = [unit.focal, ...unit.associated];
    const evidenceCharacters = records
      .flatMap((record) => [
        record.evidence.attributes.authoredId,
        record.evidence.attributes.role,
        record.evidence.attributes.alt,
        record.evidence.attributes.title,
        record.evidence.attributes.inputType,
        record.evidence.attributes.name,
        record.evidence.attributes.placeholder,
        ...Object.values(record.evidence.attributes.aria),
        record.evidence.domPath,
        record.evidence.text?.ownText,
        record.evidence.text?.nearbyText,
      ])
      .filter((value): value is string => value !== undefined)
      .reduce((total, value) => total + value.length, 0);

    expect(unit.associated.length).toBeLessThanOrEqual(
      MAX_ASSOCIATED_CONTEXT_RECORDS,
    );
    expect(serialized.length).toBeLessThanOrEqual(
      MAX_GROUP_SERIALIZED_CHARACTERS,
    );
    expect(evidenceCharacters).toBeLessThanOrEqual(
      MAX_GROUP_EVIDENCE_CHARACTERS,
    );
    expect(unit.completeness.associatedRecordsTruncated).toBe(true);
    expect(unit.completeness.associatedRecordsOmitted).toBeGreaterThan(0);
    expect(unit.completeness.serializedSizeTruncated).toBe(true);
    expect(unit.completeness.omittedAssociatedContextIds.length).toBeGreaterThan(
      0,
    );
  });

  it('uses the associated-record limit when the serialized-size limit is not reached', () => {
    const associatedIds = Array.from({ length: 12 }, (_, index) => `child-${index}`);
    const input = snapshot(
      element('focus', { childContextIds: associatedIds }),
      ...associatedIds.map((id) => element(id)),
    );
    const unit = unitFor(adaptContextSnapshot(input), 'focus');

    expect(unit.associated).toHaveLength(MAX_ASSOCIATED_CONTEXT_RECORDS);
    expect(unit.completeness.associatedRecordsOmitted).toBe(4);
    expect(unit.completeness.serializedSizeTruncated).toBe(false);
  });

  it('bounds copied text and marks adapter-level evidence truncation', () => {
    const input = snapshot(
      element(
        'focus',
        {},
        {
          text: {
            ownText: 'x'.repeat(MAX_GROUP_EVIDENCE_CHARACTERS + 10),
            nearbyText: 'y'.repeat(200),
            truncated: false,
          },
        },
      ),
    );
    const unit = unitFor(adaptContextSnapshot(input), 'focus');

    expect(unit.focal.evidence.text?.ownText?.length).toBe(
      MAX_GROUP_EVIDENCE_CHARACTERS,
    );
    expect(unit.focal.evidence.text?.nearbyText?.length).toBeLessThanOrEqual(
      200,
    );
    expect(unit.focal.evidence.text?.truncated).toBe(true);
    expect(unit.completeness.evidenceTruncated).toBe(true);
    expect(unit.completeness.status).toBe('partial');
  });

  it('distinguishes an empty extracted snapshot from unavailable extraction', () => {
    expect(adaptContextSnapshot(snapshot()).status).toBe('empty');
    expect(adaptContextSnapshot(undefined)).toEqual({
      status: 'unavailable',
      units: [],
    });
    expect(adaptContextSnapshot(null).status).toBe('unavailable');
  });

  it('handles malformed relationship references safely and rejects invalid snapshots explicitly', () => {
    const dangling = adaptContextSnapshot(
      snapshot(
        element('focus', {
          parentContextId: 'absent-parent',
          describedByContextIds: ['absent-description'],
        }),
      ),
    );
    const invalid = adaptContextSnapshot({
      schemaVersion: 1,
      elementsTruncated: false,
      elements: [
        element('duplicate'),
        element('duplicate'),
      ],
    });

    expect(dangling.status).toBe('partial');
    expect(
      unitFor(dangling, 'focus').completeness
        .unresolvedRelationshipReferences,
    ).toBe(true);
    expect(invalid).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
      units: [],
    });
  });
});
