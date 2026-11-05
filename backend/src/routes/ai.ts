import { Router } from 'express';
import { getAiUsageSummary, getUsageHistory } from '../ai/usage.js';

const router = Router();

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
