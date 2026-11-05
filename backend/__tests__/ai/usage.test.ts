import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UsageModule from '../../src/ai/usage.js';

let usage: typeof UsageModule;
let temporaryDirectory: string;
const environmentKeys = [
  'RAC_AI_USAGE_FILE',
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'rac-ai-usage-'));
  process.env.RAC_AI_USAGE_FILE = join(temporaryDirectory, 'usage.json');
  vi.resetModules();
  usage = await import('../../src/ai/usage.js');
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
});

describe('provider-neutral usage accounting', () => {
  it('continues recording requests beyond previous local daily caps', () => {
    for (let index = 0; index < 55; index += 1) {
      const attempt = usage.recordApiAttemptStart('test-model', 10);
      usage.recordApiAttemptEnd(
        'test-model',
        attempt,
        1,
        { inputTokens: 5, outputTokens: 5 },
        index === 0,
      );
    }

    expect(usage.getDailyUsage('test-model').requests).toBe(55);
    expect(usage.getDailyUsage('test-model').inputTokens).toBe(275);
    expect(usage.getDailyUsage('test-model').rateLimitResponses).toBe(1);
    expect(usage.getDailyUsage('test-model').estimatedCostUsd).toBeNull();
  });

  it('uses the existing usage-ledger day boundary at midnight Pacific time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T07:59:59.000Z'));
    expect(usage.getAiUsageSummary().date).toBe('2026-11-03');

    vi.setSystemTime(new Date('2026-11-04T08:00:00.000Z'));
    expect(usage.getAiUsageSummary().date).toBe('2026-11-04');
  });

  it('treats the legacy hard-coded zero cost as unknown', async () => {
    const date = usage.getAiUsageSummary().date;
    const usageFile = process.env.RAC_AI_USAGE_FILE;
    if (!usageFile) {
      throw new Error('The test usage ledger path was not configured.');
    }
    writeFileSync(
      usageFile,
      JSON.stringify({
        version: 1,
        days: [
          {
            date,
            analysisDurationMs: 0,
            providers: {
              'legacy-model': {
                modelId: 'legacy-model',
                requests: 1,
                inputTokens: 0,
                outputTokens: 0,
                estimatedInputTokens: 0,
                estimatedOutputTokens: 0,
                estimatedCostUsd: 0,
                rateLimitResponses: 0,
                requestLatenciesMs: [],
                attempts: [],
              },
            },
          },
        ],
      }),
    );
    vi.resetModules();
    usage = await import('../../src/ai/usage.js');

    expect(
      usage.getAiUsageSummary().providers['legacy-model']?.estimatedCostUsd,
    ).toBeNull();
  });
});
