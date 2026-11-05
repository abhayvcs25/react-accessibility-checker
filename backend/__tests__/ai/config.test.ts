import { describe, expect, it } from 'vitest';
import {
  AI_APPLICATION_LIMITS,
  AI_PROVIDERS,
  MODEL_CANDIDATES,
  getEligibleModels,
  getProviderCredentials,
  isCandidateEligible,
  isModelEligible,
  ModelNotEligibleError,
  requireEligibleModel,
  type CandidateModelId,
  type ModelCandidate,
} from '../../src/ai/config.js';

const expectedGroqModels: CandidateModelId[] = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

const expectedCloudflareModels: CandidateModelId[] = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/google/gemma-4-26b-a4b-it',
];

function makeVerifiedCandidate(
  overrides: Partial<ModelCandidate> = {},
): ModelCandidate {
  return {
    ...MODEL_CANDIDATES['openai/gpt-oss-20b'],
    verificationStatus: 'verified',
    accountVerificationStatus: 'verified',
    accountEligibility: 'zero_cost_eligible',
    eligibility: 'eligible',
    operatorEnabled: true,
    ...overrides,
  };
}

describe('shared model catalog', () => {
  it('maps all exact candidate IDs to their documented providers', () => {
    expect(Object.keys(MODEL_CANDIDATES).sort()).toEqual(
      [...expectedGroqModels, ...expectedCloudflareModels].sort(),
    );
    for (const modelId of expectedGroqModels) {
      expect(MODEL_CANDIDATES[modelId].providerId).toBe('groq');
    }
    for (const modelId of expectedCloudflareModels) {
      expect(MODEL_CANDIDATES[modelId].providerId).toBe(
        'cloudflare-workers-ai',
      );
    }
  });

  it('records distinct documentation and account verification dimensions', () => {
    expect(AI_PROVIDERS.groq.accountVerification).toMatchObject({
      status: 'partially_verified',
      source: 'operator_reported_dashboard',
      plan: 'free',
      developerPlanActive: false,
      paymentMethod: 'unverified',
      purchasedCredits: 'unverified',
      autoRecharge: 'unverified',
    });
    expect(AI_PROVIDERS['cloudflare-workers-ai']).toMatchObject({
      accountVerification: {
        status: 'verified',
        source: 'operator_reported_dashboard',
        plan: 'workers_free',
        workersPaidActive: false,
        paymentMethodOnFile: false,
        aiGatewayConfigured: false,
        aiGatewayCreditsAdded: false,
        freeNeuronsConsumedAtVerification: 0,
      },
      publishedLimits: {
        sharedFreeNeuronsPerDay: 10_000,
        freeAllocationResetsAtUtc: '00:00',
        paidOverageUsdPerThousandNeurons: 0.011,
        freeAllocationExhaustionBehavior: 'provider_rejects_requests',
      },
    });
    for (const modelId of Object.keys(MODEL_CANDIDATES) as CandidateModelId[]) {
      expect(MODEL_CANDIDATES[modelId]).toMatchObject({
        verificationStatus: 'partially_verified',
        runtimeVerificationStatus: 'unverified',
      });
    }
  });

  it('preserves verified capabilities and leaves unknown limits explicit', () => {
    expect(MODEL_CANDIDATES['openai/gpt-oss-120b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 65_536,
      structuredOutput: 'strict_json_schema',
    });
    expect(MODEL_CANDIDATES['openai/gpt-oss-20b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 65_536,
      structuredOutput: 'strict_json_schema',
    });
    expect(MODEL_CANDIDATES['qwen/qwen3.8-27b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 16_384,
      requiredStructuredOutput: 'strict_json_schema',
      structuredOutput: 'unverified',
    });
    expect(MODEL_CANDIDATES['@cf/zai-org/glm-4.7-flash']).toMatchObject({
      contextTokens: 131_072,
      maxInputTokens: null,
      maxOutputTokens: null,
      accountVerificationStatus: 'verified',
      accountEligibility: 'zero_cost_eligible',
      publishedPricing: {
        inputUsdPerMillionTokens: 0.0605,
        outputUsdPerMillionTokens: 0.4,
        inputNeuronsPerMillionTokens: 5_500,
        outputNeuronsPerMillionTokens: 36_400,
      },
      documentedCapabilities: {
        apiParameters: {
          maxTokens: 'documented',
          maxCompletionTokens: 'documented',
          responseFormat: 'documented',
        },
        jsonMode: 'unconfirmed',
        jsonSchemaParameter: 'documented',
        jsonSchemaModelSupport: 'unconfirmed',
        strictJsonSchemaParameter: 'documented',
        strictJsonSchemaModelSupport: 'unconfirmed',
        functionCalling: 'documented',
        reasoning: 'documented',
        zeroDataRetention: 'documented',
      },
      structuredOutput: 'unverified',
    });
    expect(
      MODEL_CANDIDATES['@cf/nvidia/nemotron-3-120b-a12b'],
    ).toMatchObject({
      contextTokens: 256_000,
      maxInputTokens: null,
      maxOutputTokens: null,
      accountVerificationStatus: 'verified',
      accountEligibility: 'zero_cost_eligible',
      publishedPricing: {
        inputUsdPerMillionTokens: 0.5,
        outputUsdPerMillionTokens: 1.5,
        inputNeuronsPerMillionTokens: 45_455,
        outputNeuronsPerMillionTokens: 136_364,
      },
      documentedCapabilities: {
        vision: 'unconfirmed',
        batch: 'unconfirmed',
      },
      structuredOutput: 'unverified',
    });
    expect(
      MODEL_CANDIDATES['@cf/google/gemma-4-26b-a4b-it'],
    ).toMatchObject({
      contextTokens: 256_000,
      maxInputTokens: null,
      maxOutputTokens: null,
      accountVerificationStatus: 'verified',
      accountEligibility: 'zero_cost_eligible',
      publishedPricing: {
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.3,
        inputNeuronsPerMillionTokens: 9_091,
        outputNeuronsPerMillionTokens: 27_273,
      },
      documentedCapabilities: {
        vision: 'documented',
        batch: 'documented',
      },
      structuredOutput: 'unverified',
    });
  });

  it('blocks every candidate until strict zero-cost eligibility is verified', () => {
    for (const modelId of Object.keys(MODEL_CANDIDATES) as CandidateModelId[]) {
      expect(MODEL_CANDIDATES[modelId]).toMatchObject({
        eligibility: 'blocked_unverified',
        verificationStatus: 'partially_verified',
        verificationDate: '2026-11-05',
      });
      expect(MODEL_CANDIDATES[modelId].runtimeVerificationStatus).toBe(
        'unverified',
      );
      expect(MODEL_CANDIDATES[modelId].accountVerificationStatus).not.toBe(
        'unverified',
      );
      expect(MODEL_CANDIDATES[modelId].operatorEnabled).toBe(false);
      expect(isModelEligible(modelId)).toBe(false);
    }
    for (const modelId of expectedGroqModels) {
      expect(MODEL_CANDIDATES[modelId].accountEligibility).toBe('unverified');
      expect(MODEL_CANDIDATES[modelId].accountLimits).toEqual({
        requestsPerMinute: 30,
        requestsPerDay: 1_000,
        tokensPerMinute: 8_000,
        tokensPerDay: 200_000,
      });
    }
    for (const modelId of expectedCloudflareModels) {
      expect(MODEL_CANDIDATES[modelId].accountEligibility).toBe(
        'zero_cost_eligible',
      );
    }
    expect(getEligibleModels()).toEqual([]);
    expect(() => requireEligibleModel('openai/gpt-oss-120b')).toThrow(
      ModelNotEligibleError,
    );
  });

  it('rejects candidates that are not fully verified', () => {
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({ verificationStatus: 'partially_verified' }),
      ),
    ).toBe(false);
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({ verificationStatus: 'unverified' }),
      ),
    ).toBe(false);
    const {
      verificationStatus: _verificationStatus,
      ...missingVerificationStatus
    } = makeVerifiedCandidate();
    expect(isCandidateEligible(missingVerificationStatus)).toBe(false);
  });

  it('requires explicit zero-cost account eligibility', () => {
    expect(
      isCandidateEligible(makeVerifiedCandidate({ accountEligibility: 'unknown' })),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ accountEligibility: 'unverified' })),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ accountEligibility: 'paid_only' })),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ accountEligibility: null })),
    ).toBe(false);
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({
          accountVerificationStatus: 'partially_verified',
        }),
      ),
    ).toBe(false);
    const { accountEligibility: _accountEligibility, ...missingAccountStatus } =
      makeVerifiedCandidate();
    expect(isCandidateEligible(missingAccountStatus)).toBe(false);
  });

  it('requires a documented positive numeric output limit', () => {
    expect(
      isCandidateEligible(makeVerifiedCandidate({ maxOutputTokens: null })),
    ).toBe(false);
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({ maxOutputTokens: Number.NaN }),
      ),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ maxOutputTokens: 0 })),
    ).toBe(false);
    const { maxOutputTokens: _maxOutputTokens, ...missingOutputLimit } =
      makeVerifiedCandidate();
    expect(isCandidateEligible(missingOutputLimit)).toBe(false);
  });

  it('requires the structured-output capability configured for the model', () => {
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({ structuredOutput: 'unverified' }),
      ),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ structuredOutput: null })),
    ).toBe(false);
    const {
      structuredOutput: _structuredOutput,
      ...missingStructuredOutput
    } = makeVerifiedCandidate();
    expect(isCandidateEligible(missingStructuredOutput)).toBe(false);
    const {
      requiredStructuredOutput: _requiredStructuredOutput,
      ...missingRequiredOutput
    } = makeVerifiedCandidate();
    expect(isCandidateEligible(missingRequiredOutput)).toBe(false);
  });

  it('rejects candidates with missing identity or verification metadata', () => {
    const candidate = makeVerifiedCandidate();
    const { modelId: _modelId, ...missingModelId } = candidate;
    const { providerId: _providerId, ...missingProviderId } = candidate;
    const { contextTokens: _contextTokens, ...missingContext } = candidate;
    const { accountLimits: _accountLimits, ...missingAccountLimits } = candidate;

    expect(isCandidateEligible(missingModelId)).toBe(false);
    expect(isCandidateEligible(missingProviderId)).toBe(false);
    expect(isCandidateEligible(missingContext)).toBe(false);
    expect(isCandidateEligible(missingAccountLimits)).toBe(false);
  });

  it('only accepts an eligible, operator-enabled, fully verified candidate', () => {
    expect(isCandidateEligible(makeVerifiedCandidate())).toBe(true);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ eligibility: 'blocked_unverified' })),
    ).toBe(false);
    expect(
      isCandidateEligible(makeVerifiedCandidate({ operatorEnabled: false })),
    ).toBe(false);
  });

  it('distinguishes published provider caps from unknown account caps', () => {
    expect(AI_PROVIDERS.groq.publishedLimits).toMatchObject({
      requestsPerMinute: 30,
      requestsPerDay: 1_000,
      tokensPerMinute: 8_000,
      tokensPerDay: 200_000,
      scope: 'developer-plan-only-not-free-entitlement',
    });
    expect(AI_PROVIDERS['cloudflare-workers-ai'].publishedLimits).toMatchObject({
      requestsPerMinute: 300,
      sharedFreeNeuronsPerDay: 10_000,
      scope: 'task-level-default-and-conditional-free-allocation',
    });
    expect(MODEL_CANDIDATES['openai/gpt-oss-120b'].accountLimits).toEqual({
      requestsPerMinute: 30,
      requestsPerDay: 1_000,
      tokensPerMinute: 8_000,
      tokensPerDay: 200_000,
    });
    expect(
      Object.values(MODEL_CANDIDATES)
        .filter(({ providerId }) => providerId === 'cloudflare-workers-ai')
        .every(
          ({ accountLimits }) =>
            accountLimits.requestsPerMinute === null &&
            accountLimits.requestsPerDay === null &&
            accountLimits.tokensPerMinute === null &&
            accountLimits.tokensPerDay === null,
        ),
    ).toBe(true);
    expect(
      MODEL_CANDIDATES['@cf/zai-org/glm-4.7-flash'].documentedCapabilities,
    ).toMatchObject({
      apiParameters: {
        maxTokens: 'documented',
        maxCompletionTokens: 'documented',
        responseFormat: 'documented',
      },
      jsonMode: 'unconfirmed',
      jsonSchemaParameter: 'documented',
      jsonSchemaModelSupport: 'unconfirmed',
      strictJsonSchemaParameter: 'documented',
      strictJsonSchemaModelSupport: 'unconfirmed',
    });
    expect(
      MODEL_CANDIDATES['qwen/qwen3.8-27b'].documentedCapabilities,
    ).toMatchObject({
      jsonSchemaModelSupport: 'documented',
      strictJsonSchemaModelSupport: 'unconfirmed',
    });
    expect(AI_APPLICATION_LIMITS).toEqual({
      maxConcurrentPerModel: 1,
      maxConcurrentPerProvider: 3,
      maxConcurrentTotal: 6,
      requestsPerMinutePerProvider: null,
      tokensPerMinutePerProvider: null,
    });
  });
});

describe('server-side provider credentials', () => {
  it('reports missing Groq credentials without returning a secret value', () => {
    expect(getProviderCredentials('groq', {})).toEqual({
      status: 'missing_credentials',
      providerId: 'groq',
      missing: ['GROQ_API_KEY'],
    });
  });

  it('requires both Cloudflare account credentials', () => {
    expect(
      getProviderCredentials('cloudflare-workers-ai', {
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      }),
    ).toEqual({
      status: 'missing_credentials',
      providerId: 'cloudflare-workers-ai',
      missing: ['CLOUDFLARE_API_TOKEN'],
    });
  });

  it('reads trimmed credentials only through the backend resolver', () => {
    expect(
      getProviderCredentials('groq', {
        GROQ_API_KEY: ' test-only-placeholder ',
      }),
    ).toEqual({
      status: 'configured',
      providerId: 'groq',
      groqApiKey: 'test-only-placeholder',
    });
    expect(
      getProviderCredentials('cloudflare-workers-ai', {
        CLOUDFLARE_ACCOUNT_ID: ' account-placeholder ',
        CLOUDFLARE_API_TOKEN: ' token-placeholder ',
      }),
    ).toEqual({
      status: 'configured',
      providerId: 'cloudflare-workers-ai',
      cloudflareAccountId: 'account-placeholder',
      cloudflareApiToken: 'token-placeholder',
    });
  });

  it('does not embed credentials in provider metadata', () => {
    expect(JSON.stringify(AI_PROVIDERS)).not.toContain('test-only-placeholder');
    expect(JSON.stringify(AI_PROVIDERS)).toContain('GROQ_API_KEY');
    expect(JSON.stringify(AI_PROVIDERS)).toContain('CLOUDFLARE_API_TOKEN');
  });
});
