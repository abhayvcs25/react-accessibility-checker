import { Router } from 'express';
import {
  AI_MODELS,
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

type AiConnectionState = 'checking' | 'connected' | 'unavailable' | 'disabled';
let aiConnectionState: AiConnectionState = remoteAiEnabled
  ? 'checking'
  : 'disabled';
let aiConnectionCheckedAt: string | null = null;

export function setAiConnectionState(
  state: AiConnectionState,
  checkedAt: string | null = new Date().toISOString(),
): void {
  aiConnectionState = state;
  aiConnectionCheckedAt = checkedAt;
}

router.get('/api/ai/health', (_req, res) => {
  const connected = aiConnectionState === 'connected';
  res.status(connected ? 200 : 503).json({
    enabled: remoteAiEnabled,
    status: aiConnectionState,
    connected,
    provider: selectedModel.provider,
    modelId: selectedModelId,
    checkedAt: aiConnectionCheckedAt,
  });
});

router.get('/api/ai/usage', (_req, res) => {
  res.status(200).json({
    enabled: remoteAiEnabled,
    activeProvider: selectedModel.provider,
    activeModel: selectedModelId,
    concurrency: aiRuntimeConfig.concurrency,
    requestsPerMinute: aiRuntimeConfig.requestsPerMinute,
    tokensPerMinute: aiRuntimeConfig.tokensPerMinute,
    models: Object.values(AI_MODELS).map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      name: model.name,
      contextTokens: model.contextTokens,
      keyConfigured: isProviderConfigured(model.provider),
    })),
    today: getAiUsageSummary(),
    history: getUsageHistory(),
  });
});

export default router;
