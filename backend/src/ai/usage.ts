import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AI_MODELS,
  AI_PROVIDERS,
  aiRuntimeConfig,
  type AiModelId,
  type AiProviderId,
} from './config.js';

interface ApiAttempt {
  at: number;
  estimatedTokens: number;
  latencyMs: number | null;
  rateLimited: boolean;
}

interface ModelUsage {
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  rateLimitResponses: number;
  requestLatenciesMs: number[];
  attempts: ApiAttempt[];
}

interface DailyUsage {
  date: string;
  analysisDurationMs: number;
  providers: Record<string, ModelUsage>;
}

interface UsageDatabase {
  version: 1;
  days: DailyUsage[];
}

const localDataDirectory = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'ReactAccessibilityChecker')
  : join(homedir(), '.react-accessibility-checker');
const usageFile =
  process.env.RAC_AI_USAGE_FILE?.trim() ||
  join(localDataDirectory, 'ai-usage.json');

const reservations = new Map<
  string,
  { provider: AiProviderId; tokens: number; requests: number }
>();
let nextReservationId = 0;
let database = loadDatabase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDatabase(value: unknown): value is UsageDatabase {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.days) &&
    value.days.every(
      (day) =>
        isRecord(day) &&
        typeof day.date === 'string' &&
        typeof day.analysisDurationMs === 'number' &&
        isRecord(day.providers),
    )
  );
}

function loadDatabase(): UsageDatabase {
  if (!existsSync(usageFile)) {
    return { version: 1, days: [] };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(usageFile, 'utf8'));
    if (!validateDatabase(parsed)) {
      throw new Error('Unsupported or invalid AI usage ledger format.');
    }
    return parsed;
  } catch (error) {
    console.error(
      `Could not read the AI usage ledger at ${usageFile}; usage tracking cannot continue safely.`,
      error,
    );
    throw error;
  }
}

function persistDatabase(): void {
  mkdirSync(dirname(usageFile), { recursive: true });
  const temporaryFile = `${usageFile}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(database), {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporaryFile, usageFile);
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getToday(create = true): DailyUsage | undefined {
  const date = getTodayKey();
  let today = database.days.find((day) => day.date === date);
  if (!today && create) {
    today = { date, analysisDurationMs: 0, providers: {} };
    database.days.push(today);
    const oldestDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    database.days = database.days.filter((day) => day.date >= oldestDate);
  }
  return today;
}

function emptyModelUsage(modelId: AiModelId): ModelUsage {
  return {
    modelId,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    rateLimitResponses: 0,
    requestLatenciesMs: [],
    attempts: [],
  };
}

function getModelUsage(
  modelId: AiModelId,
  create = true,
): ModelUsage | undefined {
  const today = getToday(create);
  if (!today) {
    return undefined;
  }
  let usage = today.providers[modelId];
  if (!usage && create) {
    usage = emptyModelUsage(modelId);
    today.providers[modelId] = usage;
  }
  return usage;
}

export function getDailyUsage(modelId: AiModelId): ModelUsage {
  return getModelUsage(modelId, false) ?? emptyModelUsage(modelId);
}

function getProviderModelUsage(provider: AiProviderId): ModelUsage[] {
  const entries = Object.values(getToday(false)?.providers ?? {});
  return entries.filter((usage) =>
    Object.values(AI_MODELS).some(
      (model) =>
        model.modelId === usage.modelId && model.provider === provider,
    ),
  );
}

function getProviderDailyTotals(provider: AiProviderId): {
  requests: number;
  tokens: number;
  estimatedCostUsd: number;
} {
  return getProviderModelUsage(provider).reduce(
    (total, usage) => ({
      requests: total.requests + usage.requests,
      tokens: total.tokens + usage.inputTokens + usage.outputTokens,
      estimatedCostUsd: total.estimatedCostUsd + usage.estimatedCostUsd,
    }),
    { requests: 0, tokens: 0, estimatedCostUsd: 0 },
  );
}

export function getProviderDailyRequestCount(
  provider: AiProviderId,
): number {
  return getProviderDailyTotals(provider).requests;
}

export function reserveEstimatedUsage(
  modelId: AiModelId,
  estimatedTokens: number,
): () => void {
  const provider = AI_MODELS[modelId].provider;
  const totals = getProviderDailyTotals(provider);
  const reserved = [...reservations.values()].reduce(
    (total, reservation) =>
      reservation.provider === provider
        ? {
            tokens: total.tokens + reservation.tokens,
            requests: total.requests + reservation.requests,
          }
        : total,
    { tokens: 0, requests: 0 },
  );
  const tokenCap = aiRuntimeConfig.dailyTokenBudget;
  const requestCap = Math.min(
    aiRuntimeConfig.dailyRequestBudget,
    AI_PROVIDERS[provider].localDailyRequestCap,
  );
  if (
    totals.tokens + reserved.tokens + estimatedTokens > tokenCap ||
    totals.requests + reserved.requests + 1 > requestCap
  ) {
    console.warn(
      `[ai] ${provider} request blocked before exceeding a configured free-tier usage budget.`,
    );
    throw new Error('AI daily free-tier usage budget would be exceeded.');
  }

  if (
    (totals.tokens + reserved.tokens + estimatedTokens) / tokenCap >=
      aiRuntimeConfig.warningThreshold ||
    (totals.requests + reserved.requests + 1) / requestCap >=
      aiRuntimeConfig.warningThreshold
  ) {
    console.warn(
      `[ai] ${provider} is approaching a configured daily free-tier usage limit.`,
    );
  }

  const id = String(++nextReservationId);
  reservations.set(id, { provider, tokens: estimatedTokens, requests: 1 });
  return () => reservations.delete(id);
}

export function getRecentRateUsage(
  provider: AiProviderId,
  now = Date.now(),
): { requests: number; tokens: number; oldestAt?: number } {
  const attempts = getProviderModelUsage(provider)
    .flatMap((usage) => usage.attempts)
    .filter(({ at }) => now - at < 60_000)
    .sort((left, right) => left.at - right.at);
  return {
    requests: attempts.length,
    tokens: attempts.reduce(
      (total, attempt) => total + attempt.estimatedTokens,
      0,
    ),
    ...(attempts[0] ? { oldestAt: attempts[0].at } : {}),
  };
}

export function recordApiAttemptStart(
  modelId: AiModelId,
  estimatedTokens: number,
): number {
  const startedAt = Date.now();
  const usage = getModelUsage(modelId);
  if (!usage) {
    throw new Error('Could not initialize AI usage tracking.');
  }
  usage.requests += 1;
  usage.attempts.push({
    at: startedAt,
    estimatedTokens,
    latencyMs: null,
    rateLimited: false,
  });
  usage.attempts = usage.attempts.slice(-2_000);
  persistDatabase();
  return startedAt;
}

export function recordApiAttemptEnd(
  modelId: AiModelId,
  startedAt: number,
  latencyMs: number,
  usageTokens: { inputTokens: number; outputTokens: number },
  rateLimited: boolean,
): void {
  const usage = getModelUsage(modelId);
  if (!usage) {
    throw new Error('Could not update AI usage tracking.');
  }
  const attempt = [...usage.attempts]
    .reverse()
    .find((item) => item.at === startedAt);
  if (!attempt) {
    throw new Error('AI usage attempt was not found.');
  }
  attempt.latencyMs = latencyMs;
  attempt.rateLimited = rateLimited;
  if (rateLimited) {
    usage.rateLimitResponses += 1;
  }
  usage.requestLatenciesMs.push(latencyMs);
  usage.requestLatenciesMs = usage.requestLatenciesMs.slice(-1_000);
  usage.inputTokens += usageTokens.inputTokens;
  usage.outputTokens += usageTokens.outputTokens;
  usage.estimatedCostUsd = 0;
  warnAtBudget(AI_MODELS[modelId].provider);
  persistDatabase();
}

function warnAtBudget(provider: AiProviderId): void {
  const totals = getProviderDailyTotals(provider);
  const reserved = [...reservations.values()].reduce(
    (total, reservation) =>
      reservation.provider === provider
        ? {
            tokens: total.tokens + reservation.tokens,
            requests: total.requests + reservation.requests,
          }
        : total,
    { tokens: 0, requests: 0 },
  );
  const requestCap = Math.min(
    aiRuntimeConfig.dailyRequestBudget,
    AI_PROVIDERS[provider].localDailyRequestCap,
  );
  const ratio = Math.max(
    (totals.tokens + reserved.tokens) / aiRuntimeConfig.dailyTokenBudget,
    (totals.requests + reserved.requests) / requestCap,
  );
  if (ratio >= aiRuntimeConfig.warningThreshold) {
    console.warn(
      `[ai] ${provider} has used ${Math.round(ratio * 100)}% of a configured free-tier limit.`,
    );
  }
}

export function recordAnalysisDuration(durationMs: number): void {
  const today = getToday();
  if (!today) {
    throw new Error('Could not initialize AI usage tracking.');
  }
  today.analysisDurationMs += Math.max(0, Math.round(durationMs));
  persistDatabase();
}

export function getAiUsageSummary(): {
  date: string;
  analysisDurationMs: number;
  providers: Record<string, Omit<ModelUsage, 'attempts'>>;
} {
  const today = getToday(false);
  const providers: Record<string, Omit<ModelUsage, 'attempts'>> = {};
  for (const [modelId, usage] of Object.entries(today?.providers ?? {})) {
    if (usage) {
      const { attempts: _attempts, ...publicUsage } = usage;
      providers[modelId] = publicUsage;
    }
  }
  return {
    date: getTodayKey(),
    analysisDurationMs: today?.analysisDurationMs ?? 0,
    providers,
  };
}

export function getUsageHistory(): Array<{
  date: string;
  analysisDurationMs: number;
  providers: Record<string, Omit<ModelUsage, 'attempts'>>;
}> {
  return database.days.slice(-30).map((day) => {
    const providers: Record<string, Omit<ModelUsage, 'attempts'>> = {};
    for (const [modelId, usage] of Object.entries(day.providers)) {
      if (usage) {
        const { attempts: _attempts, ...publicUsage } = usage;
        providers[modelId] = publicUsage;
      }
    }
    return { ...day, providers };
  });
}
