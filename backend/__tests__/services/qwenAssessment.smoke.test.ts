import { afterAll, describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import { assessAdaptedContext } from '../../src/services/contextualAssessment.js';
import {
  closeQwenModel,
  initializeQwenModel,
} from '../../src/services/qwenModel.js';

describe('local Qwen contextual assessment smoke test', () => {
  it.skipIf(process.env.RUN_QWEN_ASSESSMENT_SMOKE !== '1')(
    'loads Qwen and returns a schema-valid assessment citing supplied evidence',
    async () => {
      const previousFlag = process.env.RAC_ENABLE_QWEN_ASSESSMENTS;
      process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';

      try {
        await initializeQwenModel();
        const context = adaptContextSnapshotV2(
          extractHtmlContextResultV2('<button>Save changes</button>'),
        );
        const report = await assessAdaptedContext(context);
        const assessment = report.assessments[0];

        expect(report.inferenceStatus).toBe('completed');
        expect(report.modelLoaded).toBe(true);
        expect(report.assessments).toHaveLength(1);
        expect(assessment?.source).toBe('qwen3.5-4b');
        expect(
          assessment?.evidence.some(
            ({ record }) =>
              record.recordType === 'target' &&
              record.id === assessment.targetId,
          ),
        ).toBe(true);
        expect(assessment?.confidence).toBeNull();
      } finally {
        if (previousFlag === undefined) {
          delete process.env.RAC_ENABLE_QWEN_ASSESSMENTS;
        } else {
          process.env.RAC_ENABLE_QWEN_ASSESSMENTS = previousFlag;
        }
      }
    },
    30 * 60 * 1000,
  );

  afterAll(async () => {
    await closeQwenModel();
  });
});
