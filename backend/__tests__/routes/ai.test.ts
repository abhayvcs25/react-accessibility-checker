import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import aiRouter from '../../src/routes/ai.js';

vi.mock('../../src/ai/usage.js', () => ({
  getAiUsageSummary: () => ({ date: '2026-11-05', providers: {} }),
  getUsageHistory: () => [],
}));

describe('AI status routes during provider migration', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(aiRouter);
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('reports the provider path as pending without exposing a model', async () => {
    const previousGroqKey = process.env.GROQ_API_KEY;
    const previousCloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.GROQ_API_KEY = 'test-groq-secret-placeholder';
    process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-secret-placeholder';
    try {
      const response = await fetch(`${baseUrl}/api/ai/health`);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain('test-groq-secret-placeholder');
      expect(body).not.toContain('test-cloudflare-secret-placeholder');
      expect(JSON.parse(body)).toEqual({
        enabled: false,
        status: 'migration_pending',
        connected: false,
        provider: null,
        modelId: null,
        checkedAt: null,
      });
    } finally {
      if (previousGroqKey === undefined) {
        delete process.env.GROQ_API_KEY;
      } else {
        process.env.GROQ_API_KEY = previousGroqKey;
      }
      if (previousCloudflareToken === undefined) {
        delete process.env.CLOUDFLARE_API_TOKEN;
      } else {
        process.env.CLOUDFLARE_API_TOKEN = previousCloudflareToken;
      }
    }
  });

  it('reports only credential presence and does not probe providers', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test-groq-secret-placeholder');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-cloudflare-secret-placeholder');
    vi.stubEnv('RAC_CONTEXTUAL_AI_ENABLED', '');
    vi.stubEnv('RAC_AI_LIVE_TEST_ENABLED', '');

    try {
      const response = await fetch(`${baseUrl}/api/ai/readiness`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain('test-groq-secret-placeholder');
      expect(body).not.toContain('test-cloudflare-secret-placeholder');
      expect(body).not.toContain('test-account-id');
      expect(JSON.parse(body)).toMatchObject({
        providers: [
          { providerId: 'groq', configured: true, missing: [] },
          {
            providerId: 'cloudflare-workers-ai',
            configured: true,
            missing: [],
          },
        ],
        contextualAiOptIn: 'disabled',
        liveTestOptIn: 'disabled',
        liveTestAvailable: false,
        providerConnectivityChecked: false,
      });
      expect(JSON.parse(body).models).toHaveLength(6);
      expect(
        JSON.parse(body).models.every(
          (model: { eligibility: string; operatorEnabled: boolean }) =>
            model.eligibility === 'blocked_unverified' &&
            !model.operatorEnabled,
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps historical usage readable without claiming an active provider', async () => {
    const response = await fetch(`${baseUrl}/api/ai/usage`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      activeProvider: null,
      activeModel: null,
      concurrency: 0,
      requestsPerMinute: 0,
      tokensPerMinute: 0,
      models: [],
      migrationPending: true,
      today: { date: '2026-11-05', providers: {} },
      history: [],
    });
  });
});
