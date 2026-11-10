import '../env.js';

export type AiProviderId = 'groq' | 'cloudflare-workers-ai';

export const AI_PROVIDERS = {
  groq: {
    id: 'groq',
    credentialEnv: ['GROQ_API_KEY'],
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    endpointKind: 'openai-compatible',
    publishedLimits: {
      requestsPerMinute: 30,
      requestsPerDay: 1_000,
      tokensPerMinute: 8_000,
      tokensPerDay: 200_000,
      scope: 'developer-plan-only-not-free-entitlement',
    },
    accountVerification: {
      status: 'verified',
      source: 'operator_reported_dashboard',
      plan: 'free',
      developerPlanActive: false,
      allowedModelIds: [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
      ],
      paymentMethod: false,
      purchasedCredits: false,
      autoRecharge: false,
      projectLimitsConfigured: false,
      developerUpgradesAvailable: false,
      verificationDate: '2026-11-10',
    },
  },
  'cloudflare-workers-ai': {
    id: 'cloudflare-workers-ai',
    credentialEnv: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    endpoint:
      'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
    endpointKind: 'native-ai-run',
    publishedLimits: {
      requestsPerMinute: 300,
      requestsPerDay: null,
      tokensPerMinute: null,
      tokensPerDay: null,
      sharedFreeNeuronsPerDay: 10_000,
      freeAllocationResetsAtUtc: '00:00',
      paidOverageUsdPerThousandNeurons: 0.011,
      freeAllocationExhaustionBehavior: 'provider_rejects_requests',
      applicationFreeAllocationGuard:
        'scheduler_estimate_and_ledger_reservation_not_integrated',
      scope: 'task-level-default-and-conditional-free-allocation',
    },
    accountVerification: {
      status: 'verified',
      source: 'operator_reported_dashboard',
      plan: 'workers_free',
      workersPaidActive: false,
      paymentMethodOnFile: false,
      aiGatewayConfigured: false,
      aiGatewayCreditsAdded: false,
      freeNeuronsConsumedAtVerification: 0,
      verificationDate: '2026-11-10',
    },
  },
} as const;

export type CandidateModelId =
  | 'openai/gpt-oss-120b'
  | 'openai/gpt-oss-20b'
  | 'qwen/qwen3.8-27b'
  | '@cf/zai-org/glm-4.7-flash'
  | '@cf/nvidia/nemotron-3-120b-a12b'
  | '@cf/google/gemma-4-26b-a4b-it';

const eligibleModelIdBrand: unique symbol = Symbol('eligible-model-id');
export type EligibleModelId = CandidateModelId & {
  readonly [eligibleModelIdBrand]: true;
};

export type ModelEligibility =
  | 'eligible'
  | 'disabled_by_operator'
  | 'blocked_unverified'
  | 'quota_paused'
  | 'unavailable';

export type VerificationStatus =
  | 'unverified'
  | 'partially_verified'
  | 'verified';

export type AccountEligibility =
  | 'zero_cost_eligible'
  | 'paid_only'
  | 'unverified'
  | 'unknown'
  | null;

export type StructuredOutputCapability =
  | 'strict_json_schema'
  | 'unverified'
  | 'unknown'
  | null;

export type DocumentationStatus =
  | 'documented'
  | 'provisional'
  | 'unconfirmed';

export type OutputLimitEvidence =
  | 'provider_documented'
  | 'operator_reported_documentation'
  | 'unconfirmed';

export interface ModelPublishedPricing {
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
  inputNeuronsPerMillionTokens: number | null;
  outputNeuronsPerMillionTokens: number | null;
}

export interface ModelCapabilityEvidence {
  apiParameters: {
    maxTokens: DocumentationStatus;
    maxCompletionTokens: DocumentationStatus;
    responseFormat: DocumentationStatus;
  };
  jsonMode: DocumentationStatus;
  jsonSchemaParameter: DocumentationStatus;
  jsonSchemaModelSupport: DocumentationStatus;
  strictJsonSchemaParameter: DocumentationStatus;
  strictJsonSchemaModelSupport: DocumentationStatus;
  functionCalling: DocumentationStatus;
  reasoning: DocumentationStatus;
  vision: DocumentationStatus;
  batch: DocumentationStatus;
  zeroDataRetention: DocumentationStatus;
}

export interface ModelCandidate {
  providerId: AiProviderId;
  modelId: CandidateModelId;
  verificationStatus: VerificationStatus;
  verificationDate: string;
  accountVerificationStatus: VerificationStatus;
  runtimeVerificationStatus: VerificationStatus;
  accountEligibility: AccountEligibility;
  eligibility: ModelEligibility;
  operatorEnabled: boolean;
  contextTokens: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  outputLimitEvidence: OutputLimitEvidence;
  applicationMaxOutputTokens: number;
  publishedPricing: ModelPublishedPricing;
  documentedCapabilities: ModelCapabilityEvidence;
  requiredStructuredOutput: 'strict_json_schema';
  structuredOutput: StructuredOutputCapability;
  eligibilityReason: string;
  accountLimits: {
    requestsPerMinute: number | null;
    requestsPerDay: number | null;
    tokensPerMinute: number | null;
    tokensPerDay: number | null;
  };
}

const operatorReportedGroqLimits = {
  requestsPerMinute: 30,
  requestsPerDay: 1_000,
  tokensPerMinute: 8_000,
  tokensPerDay: 200_000,
} as const;

const blockedCloudflareLimits = {
  requestsPerMinute: null,
  requestsPerDay: null,
  tokensPerMinute: null,
  tokensPerDay: null,
} as const;

const unconfirmedCapabilities: ModelCapabilityEvidence = {
  apiParameters: {
    maxTokens: 'unconfirmed',
    maxCompletionTokens: 'unconfirmed',
    responseFormat: 'unconfirmed',
  },
  jsonMode: 'unconfirmed',
  jsonSchemaParameter: 'unconfirmed',
  jsonSchemaModelSupport: 'unconfirmed',
  strictJsonSchemaParameter: 'unconfirmed',
  strictJsonSchemaModelSupport: 'unconfirmed',
  functionCalling: 'unconfirmed',
  reasoning: 'unconfirmed',
  vision: 'unconfirmed',
  batch: 'unconfirmed',
  zeroDataRetention: 'unconfirmed',
};

const documentedCloudflareCapabilities: ModelCapabilityEvidence = {
  apiParameters: {
    maxTokens: 'documented',
    maxCompletionTokens: 'documented',
    responseFormat: 'documented',
  },
  jsonMode: 'provisional',
  jsonSchemaParameter: 'documented',
  jsonSchemaModelSupport: 'provisional',
  strictJsonSchemaParameter: 'documented',
  strictJsonSchemaModelSupport: 'provisional',
  functionCalling: 'documented',
  reasoning: 'documented',
  vision: 'unconfirmed',
  batch: 'unconfirmed',
  zeroDataRetention: 'documented',
};

const cloudflareBasePricing = {
  inputNeuronsPerMillionTokens: null,
  outputNeuronsPerMillionTokens: null,
} as const;

const documentedGroqStrictSchemaCapabilities: ModelCapabilityEvidence = {
  ...unconfirmedCapabilities,
  apiParameters: {
    ...unconfirmedCapabilities.apiParameters,
    responseFormat: 'documented',
  },
  jsonSchemaParameter: 'documented',
  jsonSchemaModelSupport: 'documented',
  strictJsonSchemaParameter: 'documented',
  strictJsonSchemaModelSupport: 'documented',
};

const unresolvedGroqQwenCapabilities: ModelCapabilityEvidence = {
  ...documentedGroqStrictSchemaCapabilities,
  strictJsonSchemaModelSupport: 'provisional',
};

export const MODEL_CANDIDATES: Record<CandidateModelId, ModelCandidate> = {
  'openai/gpt-oss-120b': {
    providerId: 'groq',
    modelId: 'openai/gpt-oss-120b',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 131_072,
    maxInputTokens: null,
    maxOutputTokens: 65_536,
    outputLimitEvidence: 'provider_documented',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.15,
      outputUsdPerMillionTokens: 0.6,
      ...cloudflareBasePricing,
    },
    documentedCapabilities: documentedGroqStrictSchemaCapabilities,
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified.',
    accountLimits: operatorReportedGroqLimits,
  },
  'openai/gpt-oss-20b': {
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 131_072,
    maxInputTokens: null,
    maxOutputTokens: 65_536,
    outputLimitEvidence: 'provider_documented',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.075,
      outputUsdPerMillionTokens: 0.3,
      ...cloudflareBasePricing,
    },
    documentedCapabilities: documentedGroqStrictSchemaCapabilities,
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified.',
    accountLimits: operatorReportedGroqLimits,
  },
  'qwen/qwen3.8-27b': {
    providerId: 'groq',
    modelId: 'qwen/qwen3.8-27b',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 131_072,
    maxInputTokens: null,
    maxOutputTokens: 16_384,
    outputLimitEvidence: 'provider_documented',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.8,
      outputUsdPerMillionTokens: 4,
      ...cloudflareBasePricing,
    },
    documentedCapabilities: unresolvedGroqQwenCapabilities,
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified and Groq documentation conflicts.',
    accountLimits: operatorReportedGroqLimits,
  },
  '@cf/zai-org/glm-4.7-flash': {
    providerId: 'cloudflare-workers-ai',
    modelId: '@cf/zai-org/glm-4.7-flash',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 131_072,
    maxInputTokens: null,
    maxOutputTokens: 4_096,
    outputLimitEvidence: 'operator_reported_documentation',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.0605,
      outputUsdPerMillionTokens: 0.4,
      inputNeuronsPerMillionTokens: 5_500,
      outputNeuronsPerMillionTokens: 36_400,
    },
    documentedCapabilities: {
      ...documentedCloudflareCapabilities,
      vision: 'unconfirmed',
      batch: 'unconfirmed',
    },
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported Workers Free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified.',
    accountLimits: blockedCloudflareLimits,
  },
  '@cf/nvidia/nemotron-3-120b-a12b': {
    providerId: 'cloudflare-workers-ai',
    modelId: '@cf/nvidia/nemotron-3-120b-a12b',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 256_000,
    maxInputTokens: null,
    maxOutputTokens: 16_384,
    outputLimitEvidence: 'operator_reported_documentation',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.5,
      outputUsdPerMillionTokens: 1.5,
      inputNeuronsPerMillionTokens: 45_455,
      outputNeuronsPerMillionTokens: 136_364,
    },
    documentedCapabilities: {
      ...documentedCloudflareCapabilities,
      vision: 'unconfirmed',
      batch: 'unconfirmed',
    },
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported Workers Free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified.',
    accountLimits: blockedCloudflareLimits,
  },
  '@cf/google/gemma-4-26b-a4b-it': {
    providerId: 'cloudflare-workers-ai',
    modelId: '@cf/google/gemma-4-26b-a4b-it',
    verificationStatus: 'partially_verified',
    verificationDate: '2026-11-10',
    accountVerificationStatus: 'verified',
    runtimeVerificationStatus: 'partially_verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: 256_000,
    maxInputTokens: null,
    maxOutputTokens: 8_192,
    outputLimitEvidence: 'operator_reported_documentation',
    applicationMaxOutputTokens: 2_048,
    publishedPricing: {
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.3,
      inputNeuronsPerMillionTokens: 9_091,
      outputNeuronsPerMillionTokens: 27_273,
    },
    documentedCapabilities: {
      ...documentedCloudflareCapabilities,
      vision: 'documented',
      batch: 'documented',
    },
    requiredStructuredOutput: 'strict_json_schema',
    structuredOutput: 'strict_json_schema',
    eligibilityReason:
      'Operator-approved for live assessment evaluation based on reported Workers Free/no-paid-path account status and a successful strict-schema extraction; accessibility assessment accuracy remains unverified.',
    accountLimits: blockedCloudflareLimits,
  },
};

export type EligibleModelCandidate = Omit<
  ModelCandidate,
  | 'modelId'
  | 'eligibility'
  | 'operatorEnabled'
  | 'verificationStatus'
  | 'accountVerificationStatus'
  | 'runtimeVerificationStatus'
  | 'accountEligibility'
  | 'outputLimitEvidence'
  | 'applicationMaxOutputTokens'
  | 'maxOutputTokens'
  | 'structuredOutput'
> & {
  modelId: EligibleModelId;
  eligibility: 'eligible';
  operatorEnabled: true;
  verificationStatus: 'partially_verified' | 'verified';
  accountVerificationStatus: 'verified';
  runtimeVerificationStatus: 'partially_verified' | 'verified';
  accountEligibility: 'zero_cost_eligible';
  applicationMaxOutputTokens: number;
  outputLimitEvidence: Exclude<OutputLimitEvidence, 'unconfirmed'>;
  maxOutputTokens: number;
  requiredStructuredOutput: 'strict_json_schema';
  structuredOutput: 'strict_json_schema';
};

export class ModelNotEligibleError extends Error {
  constructor(
    readonly modelId: CandidateModelId,
    readonly reason: string,
  ) {
    super(`Model ${modelId} is not eligible: ${reason}`);
    this.name = 'ModelNotEligibleError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isKnownAccountLimit(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  );
}

function isCandidateModelId(value: string): value is CandidateModelId {
  return Object.hasOwn(MODEL_CANDIDATES, value);
}

export function isCandidateEligible(
  candidate: unknown,
): candidate is EligibleModelCandidate {
  if (!isRecord(candidate)) {
    return false;
  }

  const modelId = candidate.modelId;
  const accountLimits = candidate.accountLimits;
  if (
    typeof modelId !== 'string' ||
    !isCandidateModelId(modelId) ||
    !isRecord(accountLimits) ||
    !isKnownAccountLimit(accountLimits.requestsPerMinute) ||
    !isKnownAccountLimit(accountLimits.requestsPerDay) ||
    !isKnownAccountLimit(accountLimits.tokensPerMinute) ||
    !isKnownAccountLimit(accountLimits.tokensPerDay) ||
    typeof candidate.providerId !== 'string' ||
    candidate.providerId !== MODEL_CANDIDATES[modelId].providerId ||
    typeof candidate.verificationDate !== 'string' ||
    candidate.verificationDate.length === 0 ||
    typeof candidate.contextTokens !== 'number' ||
    !Number.isFinite(candidate.contextTokens) ||
    candidate.contextTokens <= 0 ||
    !isRecord(candidate.documentedCapabilities) ||
    !isRecord(candidate.documentedCapabilities.apiParameters) ||
    candidate.documentedCapabilities.strictJsonSchemaParameter !==
      'documented' ||
    (candidate.documentedCapabilities.strictJsonSchemaModelSupport !==
      'documented' &&
      candidate.documentedCapabilities.strictJsonSchemaModelSupport !==
        'provisional') ||
    candidate.documentedCapabilities.apiParameters.responseFormat !==
      'documented' ||
    typeof candidate.eligibilityReason !== 'string' ||
    candidate.eligibilityReason.length === 0
  ) {
    return false;
  }

  if (
    (candidate.verificationStatus !== 'verified' &&
      candidate.verificationStatus !== 'partially_verified') ||
    candidate.accountVerificationStatus !== 'verified' ||
    (candidate.runtimeVerificationStatus !== 'verified' &&
      candidate.runtimeVerificationStatus !== 'partially_verified') ||
    candidate.accountEligibility !== 'zero_cost_eligible' ||
    candidate.eligibility !== 'eligible' ||
    candidate.operatorEnabled !== true ||
    typeof candidate.maxOutputTokens !== 'number' ||
    !Number.isFinite(candidate.maxOutputTokens) ||
    candidate.maxOutputTokens <= 0 ||
    (candidate.outputLimitEvidence !== 'provider_documented' &&
      candidate.outputLimitEvidence !== 'operator_reported_documentation') ||
    typeof candidate.applicationMaxOutputTokens !== 'number' ||
    !Number.isFinite(candidate.applicationMaxOutputTokens) ||
    candidate.applicationMaxOutputTokens <= 0 ||
    candidate.applicationMaxOutputTokens > candidate.maxOutputTokens ||
    candidate.requiredStructuredOutput !== 'strict_json_schema' ||
    candidate.structuredOutput !== candidate.requiredStructuredOutput
  ) {
    return false;
  }
  return (
    candidate.providerId === 'groq' ||
    candidate.providerId === 'cloudflare-workers-ai'
  );
}

function asEligibleCandidate(
  candidate: ModelCandidate,
): EligibleModelCandidate | undefined {
  if (!isCandidateEligible(candidate)) {
    return undefined;
  }
  return {
    providerId: candidate.providerId,
    modelId: candidate.modelId as EligibleModelId,
    verificationStatus: candidate.verificationStatus,
    verificationDate: candidate.verificationDate,
    accountVerificationStatus: candidate.accountVerificationStatus,
    runtimeVerificationStatus: candidate.runtimeVerificationStatus,
    accountEligibility: candidate.accountEligibility,
    eligibility: 'eligible',
    operatorEnabled: true,
    contextTokens: candidate.contextTokens,
    maxInputTokens: candidate.maxInputTokens,
    applicationMaxOutputTokens: candidate.applicationMaxOutputTokens,
    maxOutputTokens: candidate.maxOutputTokens,
    outputLimitEvidence: candidate.outputLimitEvidence,
    publishedPricing: candidate.publishedPricing,
    documentedCapabilities: candidate.documentedCapabilities,
    requiredStructuredOutput: candidate.requiredStructuredOutput,
    structuredOutput: 'strict_json_schema',
    eligibilityReason: candidate.eligibilityReason,
    accountLimits: candidate.accountLimits,
  };
}

export function getEligibleModels(): EligibleModelCandidate[] {
  return Object.values(MODEL_CANDIDATES).flatMap((candidate) => {
    const eligible = asEligibleCandidate(candidate);
    return eligible ? [eligible] : [];
  });
}

export function requireEligibleModel(
  modelId: CandidateModelId,
): EligibleModelCandidate {
  const candidate = MODEL_CANDIDATES[modelId];
  const eligible = asEligibleCandidate(candidate);
  if (!eligible) {
    throw new ModelNotEligibleError(modelId, candidate.eligibilityReason);
  }
  return eligible;
}

export function isModelEligible(modelId: CandidateModelId): boolean {
  return isCandidateEligible(MODEL_CANDIDATES[modelId]);
}

export type ProviderCredentials =
  | {
      status: 'configured';
      providerId: AiProviderId;
      groqApiKey: string;
    }
  | {
      status: 'configured';
      providerId: AiProviderId;
      cloudflareAccountId: string;
      cloudflareApiToken: string;
    }
  | {
      status: 'missing_credentials';
      providerId: AiProviderId;
      missing: readonly string[];
    };

export function getProviderCredentials(
  providerId: AiProviderId,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  if (providerId === 'groq') {
    const groqApiKey = environment.GROQ_API_KEY?.trim();
    return groqApiKey
      ? { status: 'configured', providerId, groqApiKey }
      : {
          status: 'missing_credentials',
          providerId,
          missing: ['GROQ_API_KEY'],
        };
  }

  const cloudflareAccountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim();
  const cloudflareApiToken = environment.CLOUDFLARE_API_TOKEN?.trim();
  if (!cloudflareAccountId || !cloudflareApiToken) {
    return {
      status: 'missing_credentials',
      providerId,
      missing: [
        ...(cloudflareAccountId ? [] : ['CLOUDFLARE_ACCOUNT_ID']),
        ...(cloudflareApiToken ? [] : ['CLOUDFLARE_API_TOKEN']),
      ],
    };
  }
  return {
    status: 'configured',
    providerId,
    cloudflareAccountId,
    cloudflareApiToken,
  };
}

export interface ProviderCredentialReadiness {
  providerId: AiProviderId;
  configured: boolean;
  missing: readonly string[];
}

export function getProviderCredentialReadiness(
  providerId: AiProviderId,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderCredentialReadiness {
  if (providerId === 'groq') {
    const configured = Boolean(environment.GROQ_API_KEY?.trim());
    return {
      providerId,
      configured,
      missing: configured ? [] : ['GROQ_API_KEY'],
    };
  }

  const missing = [
    ...(environment.CLOUDFLARE_ACCOUNT_ID?.trim()
      ? []
      : ['CLOUDFLARE_ACCOUNT_ID']),
    ...(environment.CLOUDFLARE_API_TOKEN?.trim()
      ? []
      : ['CLOUDFLARE_API_TOKEN']),
  ];
  return {
    providerId,
    configured: missing.length === 0,
    missing,
  };
}

export type ServerOptInState = 'disabled' | 'enabled' | 'invalid';

export function getServerOptInState(
  name: 'RAC_CONTEXTUAL_AI_ENABLED' | 'RAC_AI_LIVE_TEST_ENABLED',
  environment: NodeJS.ProcessEnv = process.env,
): ServerOptInState {
  const value = environment[name]?.trim();
  if (value === undefined || value === '' || value === 'false') {
    return 'disabled';
  }
  return value === 'true' ? 'enabled' : 'invalid';
}

export const AI_APPLICATION_LIMITS = {
  maxConcurrentPerModel: 1,
  maxConcurrentPerProvider: 1,
  maxConcurrentTotal: 1,
  requestsPerMinutePerProvider: null,
  tokensPerMinutePerProvider: null,
} as const;
