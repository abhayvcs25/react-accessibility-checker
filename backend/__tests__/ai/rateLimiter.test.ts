import { describe, expect, it } from 'vitest';
import {
  aiRuntimeConfig,
  type AiProviderId,
} from '../../src/ai/config.js';
import { withProviderConcurrency } from '../../src/ai/rateLimiter.js';

describe('provider concurrency limit', () => {
  it('bounds simultaneous requests across work to the configured worker limit', async () => {
    const provider: AiProviderId = 'gemini';
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withProviderConcurrency(provider, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          active -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(aiRuntimeConfig.concurrency);
    expect(active).toBe(0);
  });
});
