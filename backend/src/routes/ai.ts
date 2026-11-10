import { Router } from 'express';
import {
  getProviderCredentialReadiness,
  getServerOptInState,
  MODEL_CANDIDATES,
} from '../ai/config.js';
import { getAiUsageSummary, getUsageHistory } from '../ai/usage.js';

const router = Router();

router.get('/api/ai/readiness', (_req, res) => {
  const providers = (['groq', 'cloudflare-workers-ai'] as const).map(
    (providerId) => getProviderCredentialReadiness(providerId),
  );
  const models = Object.values(MODEL_CANDIDATES).map((candidate) => ({
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    eligibility: candidate.eligibility,
    verificationStatus: candidate.verificationStatus,
    runtimeVerificationStatus: candidate.runtimeVerificationStatus,
    operatorEnabled: candidate.operatorEnabled,
    eligibilityReason: candidate.eligibilityReason,
  }));
  const contextualAiOptIn = getServerOptInState('RAC_CONTEXTUAL_AI_ENABLED');
  const liveTestOptIn = getServerOptInState('RAC_AI_LIVE_TEST_ENABLED');

  res.status(200).json({
    providers,
    models,
    contextualAiOptIn,
    liveTestOptIn,
    liveTestAvailable: false,
    providerConnectivityChecked: false,
  });
});

router.get('/api/ai/health', (_req, res) => {
  res.status(503).json({
    enabled: false,
    status: 'migration_pending',
    connected: false,
    provider: null,
    modelId: null,
    checkedAt: null,
  });
});

router.get('/api/ai/usage', (_req, res) => {
  res.status(200).json({
    enabled: false,
    activeProvider: null,
    activeModel: null,
    concurrency: 0,
    requestsPerMinute: 0,
    tokensPerMinute: 0,
    models: [],
    migrationPending: true,
    today: getAiUsageSummary(),
    history: getUsageHistory(),
  });
});

export default router;
