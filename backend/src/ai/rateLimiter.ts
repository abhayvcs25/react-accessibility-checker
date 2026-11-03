import {
  AI_MODELS,
  AI_PROVIDERS,
  aiRuntimeConfig,
  type AiModelId,
  type AiProviderId,
} from './config.js';
import {
  getProviderDailyRequestCount,
  getRecentRateUsage,
  recordApiAttemptStart,
} from './usage.js';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const queues = new Map<AiProviderId, Promise<void>>();
const activeRequests = new Map<AiProviderId, number>();
const concurrencyWaiters = new Map<AiProviderId, Array<() => void>>();

export async function withProviderConcurrency<T>(
  provider: AiProviderId,
  operation: () => Promise<T>,
): Promise<T> {
  const active = activeRequests.get(provider) ?? 0;
  if (active >= aiRuntimeConfig.concurrency) {
    await new Promise<void>((resolve) => {
      const waiters = concurrencyWaiters.get(provider) ?? [];
      waiters.push(resolve);
      concurrencyWaiters.set(provider, waiters);
    });
  }
  activeRequests.set(provider, (activeRequests.get(provider) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    activeRequests.set(provider, (activeRequests.get(provider) ?? 1) - 1);
    const waiters = concurrencyWaiters.get(provider);
    const next = waiters?.shift();
    if (next) {
      next();
    }
  }
}

export async function waitForProviderCapacity(
  modelId: AiModelId,
  estimatedTokens: number,
): Promise<number> {
  const provider = AI_MODELS[modelId].provider;
  const limits = AI_PROVIDERS[provider];
  const maxRequests = Math.min(
    aiRuntimeConfig.requestsPerMinute,
    limits.localRpmCap,
  );
  const maxTokens = Math.min(
    aiRuntimeConfig.tokensPerMinute,
    limits.localTpmCap,
    modelId === 'gemini-3.8-flash' || modelId === 'gemini-3.6-flash'
      ? 3_000_000
      : Number.POSITIVE_INFINITY,
  );
  const maxDailyRequests = Math.min(
    aiRuntimeConfig.dailyRequestBudget,
    limits.localDailyRequestCap,
  );
  if (estimatedTokens > maxTokens) {
    throw new Error('AI request exceeds the configured per-minute token limit.');
  }

  const previous = queues.get(provider) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  queues.set(
    provider,
    previous.then(() => queued),
  );
  await previous;
  try {
    while (true) {
      if (getProviderDailyRequestCount(provider) >= maxDailyRequests) {
        throw new Error('AI daily free-tier request budget exhausted.');
      }
      const now = Date.now();
      const usage = getRecentRateUsage(provider, now);
      if (
        usage.requests < maxRequests &&
        usage.tokens + estimatedTokens <= maxTokens
      ) {
        return recordApiAttemptStart(modelId, estimatedTokens);
      }
      const delay = Math.max(
        100,
        (usage.oldestAt ?? now) + 60_000 - now + 50,
      );
      await wait(delay);
    }
  } finally {
    releaseQueue();
  }
}
