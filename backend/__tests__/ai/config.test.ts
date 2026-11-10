import { describe, expect, it } from 'vitest';
import {
  AI_APPLICATION_LIMITS,
  AI_PROVIDERS,
  MODEL_CANDIDATES,
  getEligibleModels,
  getProviderCredentials,
  getProviderCredentialReadiness,
  getServerOptInState,
  isCandidateEligible,
  isModelEligible,
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
    runtimeVerificationStatus: 'verified',
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
      status: 'verified',
      source: 'operator_reported_dashboard',
      plan: 'free',
      developerPlanActive: false,
      paymentMethod: false,
      purchasedCredits: false,
      autoRecharge: false,
      projectLimitsConfigured: false,
      developerUpgradesAvailable: false,
      verificationDate: '2026-11-10',
    });
    expect(AI_PROVIDERS['cloudflare-workers-ai']).toMatchObject({
      endpoint:
        'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
      endpointKind: 'native-ai-run',
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
      publishedLimits: {
        sharedFreeNeuronsPerDay: 10_000,
        freeAllocationResetsAtUtc: '00:00',
        paidOverageUsdPerThousandNeurons: 0.011,
        freeAllocationExhaustionBehavior: 'provider_rejects_requests',
        applicationFreeAllocationGuard:
          'scheduler_estimate_and_ledger_reservation_not_integrated',
      },
    });
    for (const modelId of Object.keys(MODEL_CANDIDATES) as CandidateModelId[]) {
      expect(MODEL_CANDIDATES[modelId]).toMatchObject({
        verificationStatus: 'partially_verified',
        runtimeVerificationStatus: 'partially_verified',
      });
    }
  });

  it('preserves verified capabilities and leaves unknown limits explicit', () => {
    expect(MODEL_CANDIDATES['openai/gpt-oss-120b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 65_536,
      outputLimitEvidence: 'provider_documented',
      applicationMaxOutputTokens: 2_048,
      structuredOutput: 'strict_json_schema',
    });
    expect(MODEL_CANDIDATES['openai/gpt-oss-20b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 65_536,
      applicationMaxOutputTokens: 2_048,
      structuredOutput: 'strict_json_schema',
    });
    expect(MODEL_CANDIDATES['qwen/qwen3.8-27b']).toMatchObject({
      contextTokens: 131_072,
      maxOutputTokens: 16_384,
      outputLimitEvidence: 'provider_documented',
      applicationMaxOutputTokens: 2_048,
      requiredStructuredOutput: 'strict_json_schema',
      structuredOutput: 'strict_json_schema',
    });
    expect(MODEL_CANDIDATES['@cf/zai-org/glm-4.7-flash']).toMatchObject({
      contextTokens: 131_072,
      maxInputTokens: null,
      maxOutputTokens: 4_096,
      outputLimitEvidence: 'operator_reported_documentation',
      applicationMaxOutputTokens: 2_048,
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
        jsonMode: 'provisional',
        jsonSchemaParameter: 'documented',
        jsonSchemaModelSupport: 'provisional',
        strictJsonSchemaParameter: 'documented',
        strictJsonSchemaModelSupport: 'provisional',
        functionCalling: 'documented',
        reasoning: 'documented',
        zeroDataRetention: 'documented',
      },
      structuredOutput: 'strict_json_schema',
    });
    expect(
      MODEL_CANDIDATES['@cf/nvidia/nemotron-3-120b-a12b'],
    ).toMatchObject({
      contextTokens: 256_000,
      maxInputTokens: null,
      maxOutputTokens: 16_384,
      outputLimitEvidence: 'operator_reported_documentation',
      applicationMaxOutputTokens: 2_048,
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
      structuredOutput: 'strict_json_schema',
    });
    expect(
      MODEL_CANDIDATES['@cf/google/gemma-4-26b-a4b-it'],
    ).toMatchObject({
      contextTokens: 256_000,
      maxInputTokens: null,
      maxOutputTokens: 8_192,
      outputLimitEvidence: 'operator_reported_documentation',
      applicationMaxOutputTokens: 2_048,
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
      structuredOutput: 'strict_json_schema',
    });
  });

  it('enables all candidates for operator-approved assessment evaluation without marking assessments verified', () => {
    for (const modelId of Object.keys(MODEL_CANDIDATES) as CandidateModelId[]) {
      expect(MODEL_CANDIDATES[modelId]).toMatchObject({
        eligibility: 'eligible',
        verificationStatus: 'partially_verified',
        verificationDate: '2026-11-10',
        runtimeVerificationStatus: 'partially_verified',
        operatorEnabled: true,
      });
      expect(MODEL_CANDIDATES[modelId].accountVerificationStatus).toBe(
        'verified',
      );
      expect(MODEL_CANDIDATES[modelId].eligibilityReason).toContain(
        'accessibility assessment accuracy remains unverified',
      );
      expect(isModelEligible(modelId)).toBe(true);
    }
    for (const modelId of expectedGroqModels) {
      expect(MODEL_CANDIDATES[modelId].accountEligibility).toBe(
        'zero_cost_eligible',
      );
      expect(MODEL_CANDIDATES[modelId].accountVerificationStatus).toBe(
        'verified',
      );
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
    for (const modelId of Object.keys(MODEL_CANDIDATES) as CandidateModelId[]) {
      expect(MODEL_CANDIDATES[modelId].applicationMaxOutputTokens).toBe(2_048);
    }
    expect(getEligibleModels()).toHaveLength(6);
    expect(requireEligibleModel('openai/gpt-oss-120b')).toMatchObject({
      verificationStatus: 'partially_verified',
      runtimeVerificationStatus: 'partially_verified',
      eligibility: 'eligible',
    });
  });

  it('requires explicit operator enablement for partially verified models', () => {
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({
          verificationStatus: 'partially_verified',
          runtimeVerificationStatus: 'partially_verified',
          operatorEnabled: false,
          eligibility: 'disabled_by_operator',
        }),
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
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({
          verificationStatus: 'partially_verified',
          runtimeVerificationStatus: 'partially_verified',
        }),
      ),
    ).toBe(true);
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
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({
          documentedCapabilities: {
            ...MODEL_CANDIDATES['openai/gpt-oss-20b'].documentedCapabilities,
            strictJsonSchemaModelSupport: 'provisional',
          },
        }),
      ),
    ).toBe(true);
    expect(
      isCandidateEligible(
        makeVerifiedCandidate({
          documentedCapabilities: {
            ...MODEL_CANDIDATES['openai/gpt-oss-20b'].documentedCapabilities,
            strictJsonSchemaModelSupport: 'unconfirmed',
          },
        }),
      ),
    ).toBe(false);
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
      jsonMode: 'provisional',
      jsonSchemaParameter: 'documented',
      jsonSchemaModelSupport: 'provisional',
      strictJsonSchemaParameter: 'documented',
      strictJsonSchemaModelSupport: 'provisional',
    });
    expect(
      MODEL_CANDIDATES['qwen/qwen3.8-27b'].documentedCapabilities,
    ).toMatchObject({
      jsonSchemaModelSupport: 'documented',
      strictJsonSchemaModelSupport: 'provisional',
    });
    expect(AI_APPLICATION_LIMITS).toEqual({
      maxConcurrentPerModel: 1,
      maxConcurrentPerProvider: 1,
      maxConcurrentTotal: 1,
      requestsPerMinutePerProvider: null,
      tokensPerMinutePerProvider: null,
    });
  });
});

describe('server-side provider credentials', () => {
  it('reports credential readiness without returning values', () => {
    const readiness = [
      getProviderCredentialReadiness('groq', {}),
      getProviderCredentialReadiness('cloudflare-workers-ai', {
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      }),
      getProviderCredentialReadiness('groq', {
        GROQ_API_KEY: 'test-groq-secret-placeholder',
      }),
      getProviderCredentialReadiness('cloudflare-workers-ai', {
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
        CLOUDFLARE_API_TOKEN: 'test-cloudflare-secret-placeholder',
      }),
    ];

    expect(readiness).toEqual([
      {
        providerId: 'groq',
        configured: false,
        missing: ['GROQ_API_KEY'],
      },
      {
        providerId: 'cloudflare-workers-ai',
        configured: false,
        missing: ['CLOUDFLARE_API_TOKEN'],
      },
      {
        providerId: 'groq',
        configured: true,
        missing: [],
      },
      {
        providerId: 'cloudflare-workers-ai',
        configured: true,
        missing: [],
      },
    ]);
    expect(JSON.stringify(readiness)).not.toContain('test-groq-secret-placeholder');
    expect(JSON.stringify(readiness)).not.toContain(
      'test-cloudflare-secret-placeholder',
    );
    expect(JSON.stringify(readiness)).not.toContain('test-account-id');
  });

  it('keeps server opt-ins default-off and accepts only exact booleans', () => {
    expect(getServerOptInState('RAC_CONTEXTUAL_AI_ENABLED', {})).toBe(
      'disabled',
    );
    expect(getServerOptInState('RAC_AI_LIVE_TEST_ENABLED', {})).toBe(
      'disabled',
    );
    expect(
      getServerOptInState('RAC_AI_LIVE_TEST_ENABLED', {
        RAC_AI_LIVE_TEST_ENABLED: 'true',
      }),
    ).toBe('enabled');
    expect(
      getServerOptInState('RAC_AI_LIVE_TEST_ENABLED', {
        RAC_AI_LIVE_TEST_ENABLED: '1',
      }),
    ).toBe('invalid');
  });

  it('keeps catalog eligibility independent from credential presence', () => {
    expect(getEligibleModels()).toHaveLength(6);
    expect(
      getProviderCredentialReadiness('groq', {
        GROQ_API_KEY: 'test-groq-secret-placeholder',
      }).configured,
    ).toBe(true);
    expect(getEligibleModels()).toHaveLength(6);
  });

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
