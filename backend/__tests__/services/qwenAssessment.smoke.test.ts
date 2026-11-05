import { afterAll, describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import {
  closeQwenModel,
  initializeQwenModel,
} from '../../src/services/qwenModel.js';
import { assessUnitsWithQwen } from '../../src/services/qwenAssessment.js';

describe('local Qwen contextual assessment smoke test', () => {
  it.skipIf(process.env.RUN_QWEN_ASSESSMENT_SMOKE !== '1')(
    'loads Qwen and returns a schema-valid assessment citing supplied evidence',
    async () => {
      await initializeQwenModel();
      const context = adaptContextSnapshotV2(
        extractHtmlContextResultV2('<button>Save changes</button>'),
      );
      if (context.status !== 'ready') {
        throw new Error(
          `Expected ready button context, received ${context.status}.`,
        );
      }
      const unit = context.input.units[0];
      if (!unit) {
        throw new Error('Expected an extracted button target.');
      }
      const assessments = await assessUnitsWithQwen([
        { ruleId: 'BUTTON-PURPOSE-CLARITY', unit },
      ]);
      const assessment = assessments[0];

      expect(assessments).toHaveLength(1);
      expect(assessment?.source).toBe('qwen3.5-4b');
      expect(
        assessment?.evidence.some(
          ({ record }) =>
            record.recordType === 'target' &&
            record.id === assessment.targetId,
        ),
      ).toBe(true);
      expect(assessment?.confidence).toBeNull();
    },
    30 * 60 * 1000,
  );

  afterAll(async () => {
    await closeQwenModel();
  });
});
