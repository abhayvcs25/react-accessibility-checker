import { describe, expect, it } from 'vitest';
import {
  aiRuntimeConfig,
  type AiProviderId,
} from '../../src/ai/config.js';
import { withProviderConcurrency } from '../../src/ai/rateLimiter.js';

describe('provider concurrency limit', () => {
  it('never exceeds the configured limit during a concurrent arrival burst', async () => {
    const provider: AiProviderId = 'gemini';
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 50 }, () =>
        withProviderConcurrency(provider, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          active -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(aiRuntimeConfig.concurrency);
    expect(active).toBe(0);
  });

  it('releases the slot when a request fails', async () => {
    const provider: AiProviderId = 'openrouter';

    await expect(
      withProviderConcurrency(provider, async () => {
        throw new Error('request failed');
      }),
    ).rejects.toThrow('request failed');

    await expect(
      withProviderConcurrency(provider, async () => 'available'),
    ).resolves.toBe('available');
  });
});
