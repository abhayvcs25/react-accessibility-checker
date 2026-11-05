import type { ContextAdapterResult } from '../types/contextV2.js';
import type { ContextualAssessmentReport } from '../types/checker.js';

function report(
  inferenceStatus: ContextualAssessmentReport['inferenceStatus'],
  errorCode?: string,
): ContextualAssessmentReport {
  return {
    modelId: 'not-configured',
    modelRevision: 'provider-migration-pending',
    inferenceStatus,
    modelLoaded: false,
    assessments: [],
    ...(errorCode ? { errorCode } : {}),
  };
}

export async function assessAdaptedContext(
  result: ContextAdapterResult | undefined,
): Promise<ContextualAssessmentReport> {
  if (!result) {
    return report('unavailable', 'context-extraction-failed');
  }
  if (result.status === 'unavailable') {
    return report('unavailable', `context-${result.reason}`);
  }
  if (result.status === 'error') {
    return report('unavailable', `adapter-${result.errorCode}`);
  }
  if (result.status === 'empty') {
    return report('not_invoked_no_targets');
  }

  return report('not_invoked_disabled', 'six-model-migration-pending');
}
