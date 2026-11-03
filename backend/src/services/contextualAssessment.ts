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
  ContextualInferenceStatus,
  ContextualAssessmentRuleId,
} from '../types/checker.js';
import {
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
  isQwenGenerationInProgress,
} from './qwenModel.js';
import {
  assessUnitsWithQwen,
  QwenAssessmentTimeoutError,
  type QwenAssessmentWorkItem,
} from './qwenAssessment.js';
import {
  isProviderConfigured,
  remoteAiEnabled,
  selectedProvider,
  selectedModel,
  AI_PROVIDERS,
} from '../ai/config.js';
import { assessUnitsWithRemoteAi } from './remoteAssessment.js';

const NAMING_RELATIONSHIPS = new Set(['native-label', 'aria-labelledby']);
const MAX_ASSESSMENTS_PER_ANALYSIS = 10;

function logAnalysis(event: string, details: Record<string, unknown>): void {
  if (process.env.RAC_LOG_ANALYSIS === '1') {
    console.info(`[analysis] ${event} ${JSON.stringify(details)}`);
  }
}

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

function hasFormLabelRelationship(unit: TargetContextInputUnit): boolean {
  return unit.relationships.some(
    (relationship) =>
      relationship.kind === 'native-label' ||
      relationship.kind === 'aria-labelledby',
  );
}

function hasOmittedRelationships(unit: TargetContextInputUnit): boolean {
  return (
    unit.completeness.status === 'partial' &&
    unit.completeness.truncations.includes('relationship-omitted')
  );
}

function hasUsableText(
  value: { value: string; truncated: boolean } | undefined,
): boolean {
  return Boolean(value && !value.truncated && value.value.trim());
}

function hasUsableAriaLabel(unit: TargetContextInputUnit): boolean {
  const observation = unit.focal.attributes.aria.values['aria-label'];
  return observation?.status === 'present' && hasUsableText(observation.value);
}

function hasResolvedNamingEvidence(
  unit: TargetContextInputUnit,
  allowedKinds = NAMING_RELATIONSHIPS,
): boolean {
  const evidenceIds = new Set(
    unit.relationships.flatMap((relationship) =>
      allowedKinds.has(relationship.kind) &&
      relationship.destination.status === 'resolved' &&
      relationship.destination.record.recordType === 'evidence' &&
      relationship.completeness.status === 'complete'
        ? [relationship.destination.record.id]
        : [],
    ),
  );

  return unit.associatedEvidence.some(
    ({ evidence }) =>
      evidenceIds.has(evidence.id) &&
      evidence.completeness.status === 'complete' &&
      hasUsableText(evidence.text),
  );
}

function hasUsableAriaName(unit: TargetContextInputUnit): boolean {
  return (
    hasUsableAriaLabel(unit) ||
    hasResolvedNamingEvidence(unit, new Set(['aria-labelledby']))
  );
}

function hasAuthoredName(unit: TargetContextInputUnit): boolean {
  return (
    hasUsableText(unit.focal.text) ||
    hasUsableAriaLabel(unit) ||
    hasResolvedNamingEvidence(unit)
  );
}

function getIncompleteEvidenceReasons(
  unit: TargetContextInputUnit,
): string[] {
  const reasons = new Set<string>();

  if (unit.focal.text?.truncated) {
    reasons.add('truncated-authored-name');
  }
  if (unit.focal.attributes.aria.truncated) {
    reasons.add('truncated-aria-name');
  }
  if (
    unit.focal.attributes.aria.values['aria-label']?.status === 'present' &&
    unit.focal.attributes.aria.values['aria-label'].value.truncated
  ) {
    reasons.add('truncated-authored-name');
  }
  if (
    unit.relationships.some(
      (relationship) =>
        NAMING_RELATIONSHIPS.has(relationship.kind) &&
        (relationship.destination.status !== 'resolved' ||
          relationship.completeness.status === 'partial'),
    )
  ) {
    reasons.add('unambiguous-naming-reference');
  }
  if (
    unit.relationships.some(
      (relationship) => {
        const destination = relationship.destination;
        if (
          !NAMING_RELATIONSHIPS.has(relationship.kind) ||
          destination.status !== 'resolved' ||
          destination.record.recordType !== 'evidence'
        ) {
          return false;
        }

        const evidenceId = destination.record.id;
        return !unit.associatedEvidence.some(
          ({ evidence }) =>
            evidence.id === evidenceId &&
            evidence.completeness.status === 'complete' &&
            hasUsableText(evidence.text),
        );
      },
    )
  ) {
    reasons.add('usable-associated-name-required');
  }
  if (
    unit.associatedEvidence.some(
      ({ evidence }) =>
        evidence.completeness.status === 'partial' || evidence.text?.truncated,
    )
  ) {
    reasons.add('complete-associated-evidence');
  }

  return [...reasons];
}

function toEvidenceRecords(
  unit: TargetContextInputUnit,
  ruleId: ContextualAssessmentRuleId,
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

  const allowedRelationshipKinds =
    ruleId === 'ARIA-NAME-CLARITY'
      ? new Set(['aria-labelledby'])
      : new Set(['native-label', 'aria-labelledby']);
  const namingEvidenceIds = new Set(
    unit.relationships.flatMap((relationship) =>
      allowedRelationshipKinds.has(relationship.kind) &&
      relationship.destination.status === 'resolved' &&
      relationship.destination.record.recordType === 'evidence'
        ? [relationship.destination.record.id]
        : [],
    ),
  );

  for (const associated of unit.associatedEvidence) {
    if (!namingEvidenceIds.has(associated.evidence.id)) {
      continue;
    }
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
    (hasFormLabelRelationship(unit) || hasOmittedRelationships(unit))
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
  const missing = getIncompleteEvidenceReasons(unit);

  if (
    result.status === 'partial' ||
    unit.completeness.status === 'partial' ||
    unit.focal.completeness.status === 'partial'
  ) {
    missing.push('complete-context-capture');
  }

  if (ruleId === 'FORM-LABEL-RELEVANCE' && !hasResolvedNamingEvidence(unit)) {
    missing.push(
      hasOmittedRelationships(unit)
        ? 'label-association-not-captured'
        : 'resolved-nonempty-label-required',
    );
  }
  if (ruleId === 'ARIA-NAME-CLARITY' && !hasUsableAriaName(unit)) {
    missing.push('usable-authored-aria-name-required');
  }
  if (ruleId === 'BUTTON-PURPOSE-CLARITY' && !hasAuthoredName(unit)) {
    missing.push('usable-authored-name-required');
  }

  return [...new Set(missing)];
}

function makeAbstention(
  ruleId: ContextualAssessmentRuleId,
  unit: TargetContextInputUnit,
  uncertainty: string[],
  assessment: 'insufficient_context' | 'not_assessed' = 'insufficient_context',
): ContextualAssessment {
  return {
    ruleId,
    targetId: unit.focal.id,
    assessment,
    evidence: toEvidenceRecords(unit, ruleId),
    explanation:
      assessment === 'not_assessed'
        ? 'No Qwen assessment was produced; see uncertainty for the reason.'
        : 'No accessibility conclusion was made. This experimental review requires complete authored naming text and supporting context.',
    confidence: null,
    uncertainty,
    source: 'evidence_gate',
  };
}

function unavailableReport(errorCode: string): ContextualAssessmentReport {
  return {
    modelId: remoteAiEnabled ? selectedModel.modelId : QWEN_MODEL_ID,
    modelRevision: remoteAiEnabled
      ? `${selectedProvider}-managed`
      : QWEN_MODEL_REVISION,
    inferenceStatus: 'unavailable',
    modelLoaded: false,
    assessments: [],
    errorCode,
  };
}

export async function assessAdaptedContext(
  result: ContextAdapterResult | undefined,
): Promise<ContextualAssessmentReport> {
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
      modelId: remoteAiEnabled ? selectedModel.modelId : QWEN_MODEL_ID,
      modelRevision: remoteAiEnabled
        ? `${selectedProvider}-managed`
        : QWEN_MODEL_REVISION,
      inferenceStatus: 'not_invoked_no_targets',
      modelLoaded: false,
      assessments: [],
    };
  }

  const work = result.input.units.flatMap((unit) =>
    getApplicableRules(unit).map((ruleId) => ({ ruleId, unit })),
  );
  logAnalysis('context extracted', {
    status: result.status,
    documentTitle:
      result.input.document.title.status === 'present'
        ? result.input.document.title.value.slice(0, 100)
        : result.input.document.title.status,
    targetCount: result.input.units.length,
    candidateCount: work.length,
    targets: work.slice(0, MAX_ASSESSMENTS_PER_ANALYSIS).map(({ ruleId, unit }) => ({
      id: unit.focal.id,
      kind: unit.focal.kind,
      ruleId,
      text: unit.focal.text?.value.slice(0, 100) ?? '',
      authoredAriaLabel:
        unit.focal.attributes.aria.values['aria-label']?.status === 'present'
          ? unit.focal.attributes.aria.values['aria-label'].value.value.slice(0, 100)
          : undefined,
      namingEvidence: unit.associatedEvidence
        .filter(({ relationships }) =>
          relationships.some((relationship) =>
            NAMING_RELATIONSHIPS.has(relationship.kind),
          ),
        )
        .flatMap(({ evidence }) =>
          evidence.text ? [evidence.text.value.slice(0, 100)] : [],
        ),
      completeness: unit.completeness.status,
    })),
  });
  if (work.length === 0) {
    return {
      modelId: remoteAiEnabled ? selectedModel.modelId : QWEN_MODEL_ID,
      modelRevision: remoteAiEnabled
        ? `${selectedProvider}-managed`
        : QWEN_MODEL_REVISION,
      inferenceStatus:
        result.status === 'partial'
          ? 'not_invoked_insufficient_context'
          : 'not_invoked_no_targets',
      modelLoaded: false,
      assessments: [],
    };
  }

  const qwenEnabled =
    !remoteAiEnabled && process.env.RAC_ENABLE_QWEN_ASSESSMENTS === '1';
  const enabled = remoteAiEnabled || qwenEnabled;
  const assessmentByWorkIndex = new Map<number, ContextualAssessment>();
  let eligibleCount = 0;
  let generatedCount = 0;
  let limitReached = false;
  let inferenceFailed = false;
  let inferenceTimedOut = false;
  let inferenceBusy = false;
  let inferenceUnavailable = false;
  let budgetExceeded = false;

  const eligibleWork: Array<QwenAssessmentWorkItem & { workIndex: number }> = [];
  for (const [workIndex, { ruleId, unit }] of work.entries()) {
    const missing = getMissingPrerequisites(ruleId, unit, result);
    if (missing.length > 0) {
      assessmentByWorkIndex.set(
        workIndex,
        makeAbstention(ruleId, unit, missing),
      );
      continue;
    }

    eligibleCount += 1;
    if (!enabled) {
      assessmentByWorkIndex.set(
        workIndex,
        makeAbstention(
          ruleId,
          unit,
          ['experimental-model-disabled'],
          'not_assessed',
        ),
      );
      continue;
    }
    if (eligibleWork.length < MAX_ASSESSMENTS_PER_ANALYSIS) {
      eligibleWork.push({ ruleId, unit, workIndex });
    } else {
      limitReached = true;
      assessmentByWorkIndex.set(
        workIndex,
        makeAbstention(
          ruleId,
          unit,
          [
            qwenEnabled
              ? 'per-document-qwen-target-limit-reached'
              : 'per-document-assessment-limit-reached',
          ],
          'not_assessed',
        ),
      );
    }
  }

  if (remoteAiEnabled && !isProviderConfigured(selectedProvider)) {
    inferenceUnavailable = true;
    eligibleWork.forEach(({ ruleId, unit, workIndex }) => {
      assessmentByWorkIndex.set(
        workIndex,
        makeAbstention(
          ruleId,
          unit,
          [`missing-${AI_PROVIDERS[selectedProvider].keyEnv}`],
          'not_assessed',
        ),
      );
    });
  } else if (remoteAiEnabled && eligibleWork.length > 0) {
    const outcomes = await assessUnitsWithRemoteAi(
      eligibleWork.map(({ ruleId, unit, workIndex }) => ({
        ruleId,
        unit,
        workIndex,
      })),
    );
    for (const outcome of outcomes) {
      const workItem = eligibleWork.find(
        ({ workIndex }) => workIndex === outcome.workIndex,
      );
      if (!workItem) {
        continue;
      }
      if (outcome.assessment) {
        assessmentByWorkIndex.set(workItem.workIndex, outcome.assessment);
        generatedCount += 1;
      } else {
        if (outcome.budgetExceeded) {
          budgetExceeded = true;
        } else {
          inferenceFailed = true;
        }
        assessmentByWorkIndex.set(
          workItem.workIndex,
          makeAbstention(
            workItem.ruleId,
            workItem.unit,
            [
              outcome.budgetExceeded
                ? 'ai-daily-budget-exhausted'
                : 'remote-ai-assessment-failed',
            ],
            'not_assessed',
          ),
        );
      }
    }
  } else if (qwenEnabled && eligibleWork.length > 0) {
    if (isQwenGenerationInProgress()) {
      inferenceBusy = true;
      eligibleWork.forEach(({ ruleId, unit, workIndex }) => {
        assessmentByWorkIndex.set(
          workIndex,
          makeAbstention(
            ruleId,
            unit,
            ['qwen-inference-in-progress'],
            'not_assessed',
          ),
        );
      });
    } else {
      try {
        const generatedAssessments = await assessUnitsWithQwen(
          eligibleWork.map(({ ruleId, unit }) => ({ ruleId, unit })),
        );
        generatedAssessments.forEach((assessment, index) => {
          const workItem = eligibleWork[index];
          if (workItem) {
            assessmentByWorkIndex.set(workItem.workIndex, assessment);
          }
        });
        generatedCount = eligibleWork.length;
      } catch (error) {
        inferenceTimedOut = error instanceof QwenAssessmentTimeoutError;
        inferenceFailed = !inferenceTimedOut;
        console.error(
          inferenceTimedOut
            ? 'Qwen exceeded the response time budget; returning IBM results without waiting for it.'
            : 'Qwen contextual assessment failed; IBM accessibility results are unaffected.',
          error instanceof Error ? error.message : 'Unknown Qwen error',
        );
        eligibleWork.forEach(({ ruleId, unit, workIndex }) => {
          assessmentByWorkIndex.set(
            workIndex,
            makeAbstention(
              ruleId,
              unit,
              [
                inferenceTimedOut
                  ? 'qwen-response-time-budget-exceeded'
                  : 'qwen-inference-failed',
              ],
              'not_assessed',
            ),
          );
        });
      }
    }
  }

  const assessments = work.flatMap((_, index) => {
    const assessment = assessmentByWorkIndex.get(index);
    return assessment ? [assessment] : [];
  });

  let inferenceStatus: ContextualInferenceStatus
  if (inferenceUnavailable) {
    inferenceStatus = 'unavailable'
  } else if (inferenceFailed) {
    inferenceStatus = 'failed'
  } else if (inferenceTimedOut) {
    inferenceStatus = 'timed_out'
  } else if (inferenceBusy) {
    inferenceStatus = 'busy'
  } else if (limitReached || budgetExceeded) {
    inferenceStatus = 'completed_with_limit'
  } else if (generatedCount > 0) {
    inferenceStatus = 'completed'
  } else if (!enabled && eligibleCount > 0) {
    inferenceStatus = 'not_invoked_disabled'
  } else {
    inferenceStatus = 'not_invoked_insufficient_context'
  }

  return {
    modelId: remoteAiEnabled ? selectedModel.modelId : QWEN_MODEL_ID,
    modelRevision: remoteAiEnabled
      ? `${selectedProvider}-managed`
      : QWEN_MODEL_REVISION,
    inferenceStatus,
    modelLoaded: generatedCount > 0,
    assessments,
    ...(inferenceUnavailable
      ? {
          errorCode: !isProviderConfigured(selectedProvider)
            ? `missing-${AI_PROVIDERS[selectedProvider].keyEnv}`
            : 'paid-usage-opt-in-required',
        }
      : inferenceFailed
        ? { errorCode: remoteAiEnabled ? 'remote-ai-inference-failed' : 'qwen-inference-failed' }
        : inferenceTimedOut
        ? { errorCode: 'qwen-response-time-budget-exceeded' }
        : inferenceBusy
          ? { errorCode: 'qwen-inference-in-progress' }
          : budgetExceeded
            ? { errorCode: 'ai-daily-budget-exhausted' }
          : {}),
  };
}
