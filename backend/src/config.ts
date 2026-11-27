import './env.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const AI_MODELS_CONFIG_PATH = join(__dirname, '..', 'config', 'ai-models.json');

export const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

/**
 * Maximum allowed size for the JSON request body.
 * This limits the HTML content plus the filename and JSON overhead.
 * 5 MB should accommodate even large HTML documents.
 */
export const MAX_BODY_SIZE = '5mb';

/**
 * Maximum time in milliseconds to wait for the IBM accessibility
 * checker to complete a scan before responding with a 504 timeout.
 */
export const ANALYSIS_TIMEOUT_MS = 60_000;

/**
 * CORS allowed origins. Comma-separated list.
 * Default: http://localhost:5173 (Vite dev server)
 * Example: http://localhost:5173,http://localhost:3000
 */
export const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/**
 * Rate limiting configuration.
 * All values are per IP address.
 */
export const RATE_LIMITS = {
  /** Max requests per minute for /api/analyze */
  analyze: parseInt(process.env['RATE_LIMIT_ANALYZE'] ?? '10', 10),
  /** Max requests per minute for /api/analyze-source */
  analyzeSource: parseInt(process.env['RATE_LIMIT_ANALYZE_SOURCE'] ?? '10', 10),
  /** Max requests per minute for /api/project-intake */
  projectIntake: parseInt(process.env['RATE_LIMIT_PROJECT_INTAKE'] ?? '2', 10),
} as const;

/**
 * AI Models configuration loaded from JSON file.
 * Set RAC_AI_MODELS_CONFIG_PATH to override the default location.
 */
export function loadAIModelsConfig(): AIModelsConfig {
  const configPath = process.env['RAC_AI_MODELS_CONFIG_PATH'] ?? AI_MODELS_CONFIG_PATH;
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as AIModelsConfig;
  } catch (error) {
    console.error(`Failed to load AI models config from ${configPath}:`, error);
    throw error;
  }
}

export interface AIModelsConfig {
  version: number;
  updated: string;
  providers: Record<string, AIProviderConfig>;
  models: Record<string, AIModelConfig>;
}

export interface AIProviderConfig {
  id: string;
  credentialEnv: string[];
  endpoint: string;
  endpointKind: string;
  publishedLimits: Record<string, number | string | null>;
  accountVerification: AIAccountVerification;
}

export interface AIAccountVerification {
  status: string;
  source: string;
  plan: string;
  [key: string]: unknown;
}

export interface AIModelConfig {
  providerId: string;
  modelId: string;
  verificationStatus: string;
  verificationDate: string;
  accountVerificationStatus: string;
  runtimeVerificationStatus: string;
  accountEligibility: string;
  eligibility: string;
  operatorEnabled: boolean;
  contextTokens: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  outputLimitEvidence: string;
  applicationMaxOutputTokens: number;
  publishedPricing: AIModelPricing;
  documentedCapabilities: AIModelCapabilities;
  requiredStructuredOutput: string;
  structuredOutput: string;
  eligibilityReason: string;
  accountLimits: AIAccountLimits;
}

export interface AIModelPricing {
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
  inputNeuronsPerMillionTokens: number | null;
  outputNeuronsPerMillionTokens: number | null;
}

export interface AIModelCapabilities {
  apiParameters: {
    maxTokens: string;
    maxCompletionTokens: string;
    responseFormat: string;
  };
  jsonMode: string;
  jsonSchemaParameter: string;
  jsonSchemaModelSupport: string;
  strictJsonSchemaParameter: string;
  strictJsonSchemaModelSupport: string;
  functionCalling: string;
  reasoning: string;
  vision: string;
  batch: string;
  zeroDataRetention: string;
}

export interface AIAccountLimits {
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  tokensPerMinute: number | null;
  tokensPerDay: number | null;
}
