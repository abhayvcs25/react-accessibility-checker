import type { ContextAdapterResult } from '../types/contextV2.js';
import type { ContextualAssessmentReport } from '../types/checker.js';

/**
 * Contextual AI Assessment - CURRENTLY DISABLED
 * 
 * The six-model AI assessment pipeline (Groq + Cloudflare) is disabled
 * pending migration completion. See docs/ai/SIX_MODEL_ARCHITECTURE.md.
 * 
 * This module is kept as a stub so the main checker.ts can import
 * `assessAdaptedContext` without breaking the build. When the six-model
 * migration is complete, replace this stub with the real implementation.
 */

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

  // DISABLED: Six-model AI migration pending
  return report('not_invoked_disabled', 'six-model-migration-pending');
}
