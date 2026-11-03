import { Router } from 'express';
import {
  AI_MODELS,
  AI_PROVIDERS,
  aiRuntimeConfig,
  isProviderConfigured,
  remoteAiEnabled,
  selectedModel,
  selectedModelId,
} from '../ai/config.js';
import {
  getAiUsageSummary,
  getUsageHistory,
} from '../ai/usage.js';
const router = Router();

router.get('/api/ai/usage', (_req, res) => {
  res.status(200).json({
    enabled: remoteAiEnabled,
    activeProvider: selectedModel.provider,
    activeModel: selectedModelId,
    concurrency: aiRuntimeConfig.concurrency,
    requestsPerMinute: aiRuntimeConfig.requestsPerMinute,
    tokensPerMinute: aiRuntimeConfig.tokensPerMinute,
    dailyRequestBudget: aiRuntimeConfig.dailyRequestBudget,
    dailyTokenBudget: aiRuntimeConfig.dailyTokenBudget,
    models: Object.values(AI_MODELS).map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      name: model.name,
      contextTokens: model.contextTokens,
      keyConfigured: isProviderConfigured(model.provider),
      localDailyRequestCap:
        AI_PROVIDERS[model.provider].localDailyRequestCap,
    })),
    today: getAiUsageSummary(),
    history: getUsageHistory(),
  });
});

export default router;
