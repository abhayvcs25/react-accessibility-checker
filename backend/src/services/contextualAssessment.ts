import type {
  ContextAdapterResult,
  ContextRecordRef,
  EvaluationTarget,
  TargetContextInputUnit,
} from '../types/contextV2.js';
import type {
  ContextualAssessment,
  ContextualAssessmentEvidence,
  ContextualAssessmentReport,
  ContextualAssessmentRuleId,
} from '../types/checker.js';
import {
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
} from './qwenModel.js';

function isButtonTarget(target: EvaluationTarget): boolean {
  return (
    target.kind === 'button' ||
    (target.kind === 'custom-widget' && target.basis.role === 'button')
  );
}

function hasAuthoredAriaName(unit: TargetContextInputUnit): boolean {
  const aria = unit.focal.attributes.aria.values;
  const namingAttributes = [aria['aria-label'], aria['aria-labelledby']];

  return (
    namingAttributes.some(
      (attribute) => attribute !== undefined && attribute.status !== 'absent',
    ) || unit.relationships.some((relationship) => relationship.kind === 'aria-labelledby')
  );
}

function hasLabelRelationship(unit: TargetContextInputUnit): boolean {
  return unit.relationships.some(
    (relationship) => relationship.kind === 'native-label',
  );
}

function hasOmittedRelationships(unit: TargetContextInputUnit): boolean {
  return (
    unit.completeness.status === 'partial' &&
    unit.completeness.truncations.includes('relationship-omitted')
  );
}

function toEvidenceRecords(
  unit: TargetContextInputUnit,
): ContextualAssessmentEvidence[] {
  const evidence = new Map<string, ContextualAssessmentEvidence>();
  const targetRecord: ContextRecordRef = {
    recordType: 'target',
    id: unit.focal.id,
  };
  evidence.set(`target:${unit.focal.id}`, {
    record: targetRecord,
    ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
  });

  for (const associated of unit.associatedEvidence) {
    const record: ContextRecordRef = {
      recordType: 'evidence',
      id: associated.evidence.id,
    };
    evidence.set(`evidence:${associated.evidence.id}`, {
      record,
      ...(associated.evidence.text
        ? { text: associated.evidence.text.value }
        : {}),
    });
  }

  return [...evidence.values()];
}

function getApplicableRules(
  unit: TargetContextInputUnit,
): ContextualAssessmentRuleId[] {
  const rules: ContextualAssessmentRuleId[] = [];

  if (isButtonTarget(unit.focal)) {
    rules.push('BUTTON-PURPOSE-CLARITY');
  }
  if (
    unit.focal.kind === 'form-control' &&
    (hasLabelRelationship(unit) || hasOmittedRelationships(unit))
  ) {
    rules.push('FORM-LABEL-RELEVANCE');
  }
  if (hasAuthoredAriaName(unit)) {
    rules.push('ARIA-NAME-CLARITY');
  }

  return rules;
}

function getMissingPrerequisites(
  ruleId: ContextualAssessmentRuleId,
  unit: TargetContextInputUnit,
  result: Extract<ContextAdapterResult, { status: 'ready' | 'partial' }>,
): string[] {
  const missing =
    ruleId === 'FORM-LABEL-RELEVANCE'
      ? [
          'browser-computed-accessible-name',
          'independently-evidenced-expected-information',
        ]
      : ruleId === 'BUTTON-PURPOSE-CLARITY'
        ? [
            'browser-computed-accessible-name',
            'evidenced-purpose-or-action',
          ]
        : [
            'browser-computed-accessible-name',
            'evidenced-target-purpose',
          ];

  if (
    result.status === 'partial' ||
    unit.completeness.status === 'partial' ||
    unit.focal.completeness.status === 'partial'
  ) {
    missing.push('complete-context-capture');
  }

  if (
    ruleId === 'FORM-LABEL-RELEVANCE' &&
    unit.relationships.some(
      (relationship) =>
        relationship.kind === 'native-label' &&
        (relationship.destination.status !== 'resolved' ||
          relationship.completeness.status === 'partial'),
    )
  ) {
    missing.push('unambiguous-native-label-association');
  }
  if (
    ruleId === 'FORM-LABEL-RELEVANCE' &&
    !hasLabelRelationship(unit) &&
    hasOmittedRelationships(unit)
  ) {
    missing.push('native-label-association-not-captured');
  }
  if (
    ruleId === 'ARIA-NAME-CLARITY' &&
    unit.relationships.some(
      (relationship) =>
        relationship.kind === 'aria-labelledby' &&
        (relationship.destination.status !== 'resolved' ||
          relationship.completeness.status === 'partial'),
    )
  ) {
    missing.push('unambiguous-aria-naming-reference');
  }
  if (
    unit.associatedEvidence.some(
      (associated) => associated.evidence.completeness.status === 'partial',
    )
  ) {
    missing.push('complete-associated-evidence');
  }

  return missing;
}

function makeAbstention(
  ruleId: ContextualAssessmentRuleId,
  unit: TargetContextInputUnit,
  result: Extract<ContextAdapterResult, { status: 'ready' | 'partial' }>,
): ContextualAssessment {
  const missing = getMissingPrerequisites(ruleId, unit, result);

  return {
    ruleId,
    targetId: unit.focal.id,
    assessment: 'insufficient_context',
    evidence: toEvidenceRecords(unit),
    explanation:
      'No accessibility conclusion was made. Static V2 context does not include the evidence required by this rule.',
    confidence: null,
    uncertainty: missing,
    source: 'evidence_gate',
  };
}

function unavailableReport(errorCode: string): ContextualAssessmentReport {
  return {
    modelId: QWEN_MODEL_ID,
    modelRevision: QWEN_MODEL_REVISION,
    inferenceStatus: 'unavailable',
    modelLoaded: false,
    assessments: [],
    errorCode,
  };
}

export function assessAdaptedContext(
  result: ContextAdapterResult | undefined,
): ContextualAssessmentReport {
  if (!result) {
    return unavailableReport('context-extraction-failed');
  }
  if (result.status === 'unavailable') {
    return unavailableReport(`context-${result.reason}`);
  }
  if (result.status === 'error') {
    return unavailableReport(`adapter-${result.errorCode}`);
  }
  if (result.status === 'empty') {
    return {
      modelId: QWEN_MODEL_ID,
      modelRevision: QWEN_MODEL_REVISION,
      inferenceStatus: 'not_invoked_no_targets',
      modelLoaded: false,
      assessments: [],
    };
  }

  const assessments = result.input.units.flatMap((unit) =>
    getApplicableRules(unit).map((ruleId) =>
      makeAbstention(ruleId, unit, result),
    ),
  );

  return {
    modelId: QWEN_MODEL_ID,
    modelRevision: QWEN_MODEL_REVISION,
    inferenceStatus:
      assessments.length > 0 || result.status === 'partial'
        ? 'not_invoked_insufficient_context'
        : 'not_invoked_no_targets',
    modelLoaded: false,
    assessments,
  };
}
