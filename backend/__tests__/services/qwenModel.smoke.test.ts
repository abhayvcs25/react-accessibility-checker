import { afterAll, describe, expect, it } from 'vitest';
import {
  closeQwenModel,
  generateQwenText,
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
} from '../../src/services/qwenModel.js';

describe('local Qwen model smoke test', () => {
  it.skipIf(process.env.RUN_QWEN_MODEL_SMOKE !== '1')(
    'loads the pinned model locally and generates valid JSON',
    async () => {
      const startedAt = performance.now();
      const output = await generateQwenText(
        'Return exactly this JSON object and nothing else: {"ok":true}',
      );
      const elapsedMilliseconds = Math.round(performance.now() - startedAt);
      const memory = process.memoryUsage();
      const maxResidentSetKiB = process.resourceUsage().maxRSS;
      console.info(
        JSON.stringify({
          model: QWEN_MODEL_ID,
          revision: QWEN_MODEL_REVISION,
          elapsedMilliseconds,
          rssBytes: memory.rss,
          maxResidentSetKiB,
          heapUsedBytes: memory.heapUsed,
          outputPreview: output.slice(0, 200),
        }),
      );

      expect(JSON.parse(output)).toEqual({ ok: true });
    },
    30 * 60 * 1000,
  );

  afterAll(async () => {
    await closeQwenModel();
  });
});
