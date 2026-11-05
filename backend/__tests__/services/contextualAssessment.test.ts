import { describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import { assessAdaptedContext } from '../../src/services/contextualAssessment.js';

describe('contextual assessment during provider migration', () => {
  it('does not make or claim provider assessments while migration is pending', async () => {
    const extracted = extractHtmlContextResultV2('<button>Save</button>');
    const adapted = adaptContextSnapshotV2(extracted);
    const report = await assessAdaptedContext(adapted);

    expect(report).toEqual({
      modelId: 'not-configured',
      modelRevision: 'provider-migration-pending',
      inferenceStatus: 'not_invoked_disabled',
      modelLoaded: false,
      assessments: [],
      errorCode: 'six-model-migration-pending',
    });
  });

  it('keeps empty-context status distinct from pending provider migration', async () => {
    const report = await assessAdaptedContext({
      status: 'empty',
      input: {
        document: {
          title: { status: 'absent' },
          language: { status: 'absent' },
        },
        units: [],
        extractionCompleteness: {
          status: 'complete',
          truncations: [],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount: 0, ambiguousCount: 0 },
        },
        adapterCompleteness: { status: 'complete', truncations: [] },
      },
    });

    expect(report.inferenceStatus).toBe('not_invoked_no_targets');
    expect(report.errorCode).toBeUndefined();
  });
});
