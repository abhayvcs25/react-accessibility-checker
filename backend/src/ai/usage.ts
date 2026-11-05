import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface ApiAttempt {
  id: string;
  at: number;
  estimatedTokens: number;
  latencyMs: number | null;
  rateLimited: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

interface ModelUsage {
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number | null;
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

let database = loadDatabase();

export interface ApiAttemptHandle {
  id: string;
  at: number;
}

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
    for (const day of parsed.days) {
      for (const value of Object.values(day.providers)) {
        if (!isRecord(value)) {
          continue;
        }
        value.estimatedInputTokens ??= 0;
        value.estimatedOutputTokens ??= 0;
        if (value.estimatedCostUsd === 0) {
          value.estimatedCostUsd = null;
        }
        value.estimatedCostUsd ??= null;
        if (Array.isArray(value.attempts)) {
          for (const attempt of value.attempts) {
            if (!isRecord(attempt)) {
              continue;
            }
            attempt.id ??= randomUUID();
            attempt.inputTokens ??= 0;
            attempt.outputTokens ??= 0;
            attempt.estimatedInputTokens ??= 0;
            attempt.estimatedOutputTokens ??= 0;
          }
        }
      }
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
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(
    dateParts.map(({ type, value }) => [type, value]),
  );
  return `${date.year}-${date.month}-${date.day}`;
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

function emptyModelUsage(modelId: string): ModelUsage {
  return {
    modelId,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: null,
    rateLimitResponses: 0,
    requestLatenciesMs: [],
    attempts: [],
  };
}

function getModelUsage(
  modelId: string,
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

export function getDailyUsage(modelId: string): ModelUsage {
  return getModelUsage(modelId, false) ?? emptyModelUsage(modelId);
}

export function recordApiAttemptStart(
  modelId: string,
  estimatedTokens: number,
): ApiAttemptHandle {
  const attempt = { id: randomUUID(), at: Date.now() };
  const usage = getModelUsage(modelId);
  if (!usage) {
    throw new Error('Could not initialize AI usage tracking.');
  }
  usage.requests += 1;
  usage.attempts.push({
    ...attempt,
    estimatedTokens,
    latencyMs: null,
    rateLimited: false,
    inputTokens: 0,
    outputTokens: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
  });
  usage.attempts = usage.attempts.slice(-2_000);
  persistDatabase();
  return attempt;
}

export function recordApiAttemptEnd(
  modelId: string,
  attemptHandle: ApiAttemptHandle,
  latencyMs: number,
  usageTokens: {
    inputTokens: number;
    outputTokens: number;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
  },
  rateLimited: boolean,
): void {
  const usage = getModelUsage(modelId);
  if (!usage) {
    throw new Error('Could not update AI usage tracking.');
  }
  const attempt = [...usage.attempts]
    .reverse()
    .find((item) => item.id === attemptHandle.id);
  if (!attempt) {
    throw new Error('AI usage attempt was not found.');
  }
  attempt.latencyMs = latencyMs;
  attempt.rateLimited = rateLimited;
  if (rateLimited) {
    usage.rateLimitResponses += 1;
  }
  attempt.inputTokens = usageTokens.inputTokens;
  attempt.outputTokens = usageTokens.outputTokens;
  attempt.estimatedInputTokens = usageTokens.estimatedInputTokens ?? 0;
  attempt.estimatedOutputTokens = usageTokens.estimatedOutputTokens ?? 0;
  usage.requestLatenciesMs.push(latencyMs);
  usage.requestLatenciesMs = usage.requestLatenciesMs.slice(-1_000);
  usage.inputTokens += usageTokens.inputTokens;
  usage.outputTokens += usageTokens.outputTokens;
  usage.estimatedInputTokens += attempt.estimatedInputTokens;
  usage.estimatedOutputTokens += attempt.estimatedOutputTokens;
  persistDatabase();
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
