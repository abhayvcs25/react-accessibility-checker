import type { ContextualAssessmentEvidence } from '../types/checker.js';
import type {
  ContextRecordRef,
  TargetContextInputUnit,
  TargetRelationshipProjection,
} from '../types/contextV2.js';

const NAMING_RELATIONSHIPS = new Set(['native-label', 'aria-labelledby']);

function isResolvedNamingRelationship(
  relationship: TargetRelationshipProjection,
): relationship is TargetRelationshipProjection & {
  destination: { status: 'resolved'; record: ContextRecordRef };
} {
  return (
    NAMING_RELATIONSHIPS.has(relationship.kind) &&
    relationship.destination.status === 'resolved' &&
    relationship.destination.record.recordType === 'evidence' &&
    relationship.completeness.status === 'complete'
  );
}

export function getNamingEvidence(
  unit: TargetContextInputUnit,
): ContextualAssessmentEvidence[] {
  const evidenceById = new Map(
    unit.associatedEvidence.map(({ evidence }) => [evidence.id, evidence]),
  );
  const usedEvidenceIds = new Set(
    unit.relationships
      .filter(isResolvedNamingRelationship)
      .map((relationship) => relationship.destination.record.id),
  );

  const evidence: ContextualAssessmentEvidence[] = [
    {
      record: { recordType: 'target', id: unit.focal.id },
      ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
    },
  ];

  for (const id of usedEvidenceIds) {
    const record = evidenceById.get(id);
    if (record) {
      evidence.push({
        record: { recordType: 'evidence', id },
        ...(record.text ? { text: record.text.value } : {}),
      });
    }
  }

  return evidence;
}
