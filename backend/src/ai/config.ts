import '../env.js';

export type AiProviderId = 'gemini' | 'openrouter';

export const AI_PROVIDERS = {
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    localRpmCap: 5,
    localTpmCap: 20_000,
    api: 'gemini',
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/v1',
    localRpmCap: 20,
    localTpmCap: 20_000,
    api: 'openai-compatible',
  },
} as const;

export type AiModelId =
  | 'gemini-3.8-flash'
  | 'gemini-3.6-flash'
  | 'recursive/flint-v1.0:free'
  | 'google/gemma-4-31b-it:free'
  | 'nvidia/nemotron-3.5-super-vl:free'
  | 'cohere/north-mini-code:free';

export interface AiModelConfig {
  provider: AiProviderId;
  modelId: AiModelId;
  name: string;
  contextTokens: number;
  jsonOutput: 'schema' | 'object' | 'prompt';
}

export const AI_MODELS: Record<AiModelId, AiModelConfig> = {
  'gemini-3.8-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    contextTokens: 1_048_576,
    jsonOutput: 'schema',
  },
  'gemini-3.6-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    contextTokens: 1_048_576,
    jsonOutput: 'schema',
  },
  'recursive/flint-v1.0:free': {
    provider: 'openrouter',
    modelId: 'recursive/flint-v1.0:free',
    name: 'Recursive Flint',
    contextTokens: 262_144,
    jsonOutput: 'object',
  },
  'google/gemma-4-31b-it:free': {
    provider: 'openrouter',
    modelId: 'google/gemma-4-31b-it:free',
    name: 'Google Gemma 4 31B IT',
    contextTokens: 262_144,
    jsonOutput: 'object',
  },
  'nvidia/nemotron-3.5-super-vl:free': {
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA Nemotron 3.5 Super VL',
    contextTokens: 1_000_000,
    jsonOutput: 'object',
  },
  'cohere/north-mini-code:free': {
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    contextTokens: 256_000,
    jsonOutput: 'prompt',
  },
};

const modelIds = Object.keys(AI_MODELS) as AiModelId[];
const configuredModelId = process.env.RAC_AI_MODEL?.trim();
if (configuredModelId && !modelIds.includes(configuredModelId as AiModelId)) {
  throw new Error(
    `Unsupported RAC_AI_MODEL "${configuredModelId}". Choose one of: ${modelIds.join(', ')}.`,
  );
}
export const selectedModelId: AiModelId =
  configuredModelId && modelIds.includes(configuredModelId as AiModelId)
    ? (configuredModelId as AiModelId)
    : 'gemini-3.8-flash';
export const selectedModel = AI_MODELS[selectedModelId];
export const selectedProvider = selectedModel.provider;
export const remoteAiEnabled = process.env.RAC_AI_ENABLED === '1';

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer AI setting, received "${value}".`);
  }
  return parsed;
}

export const aiRuntimeConfig = {
  concurrency: Math.min(10, positiveInteger(process.env.RAC_AI_CONCURRENCY, 2)),
  requestsPerMinute: positiveInteger(
    process.env.RAC_AI_REQUESTS_PER_MINUTE,
    5,
  ),
  tokensPerMinute: positiveInteger(
    process.env.RAC_AI_TOKENS_PER_MINUTE,
    20_000,
  ),
  maxOutputTokens: Math.min(
    512,
    positiveInteger(process.env.RAC_AI_MAX_OUTPUT_TOKENS, 512),
  ),
  maxRetries: Math.min(4, positiveInteger(process.env.RAC_AI_MAX_RETRIES, 2)),
  cacheTtlMs: positiveInteger(
    process.env.RAC_AI_CACHE_TTL_MS,
    12 * 60 * 60 * 1000,
  ),
};

export function getProviderApiKey(provider: AiProviderId): string | undefined {
  const key = process.env[AI_PROVIDERS[provider].keyEnv]?.trim();
  return key || undefined;
}

export function isProviderConfigured(provider: AiProviderId): boolean {
  return getProviderApiKey(provider) !== undefined;
}
