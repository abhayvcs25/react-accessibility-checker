import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeRateLimiter, analyzeSourceRateLimiter, projectIntakeRateLimiter, clearRateLimitStore } from '../../src/middleware/rateLimit.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

describe('Rate limiting middleware', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    // Apply rate limiters to test routes
    app.post('/api/analyze', analyzeRateLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.post('/api/analyze-source', analyzeSourceRateLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.post('/api/project-intake', projectIntakeRateLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });

    app.use(errorHandler);

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clearRateLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function post(url: string, body = {}) {
    return fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  describe('analyzeRateLimiter', () => {
    it('allows requests under the limit', async () => {
      const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
    });

    it('returns 429 when limit exceeded', async () => {
      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
        expect(response.status).toBe(200);
      }

      // 11th request should be rate limited
      const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBeDefined();
      const body = await response.json();
      expect(body.code).toBe('rate_limited');
    });

    it('resets after window expires', async () => {
      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
        expect(response.status).toBe(200);
      }

      // Advance time past the 60 second window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
    });
  });

  describe('analyzeSourceRateLimiter', () => {
    it('has independent limit from analyze', async () => {
      // Exhaust analyze limit
      for (let i = 0; i < 10; i++) {
        await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
      }

      // analyze-source should still work
      const response = await post('/api/analyze-source', { source: '<button>Save</button>', filename: 'Button.tsx' });
      expect(response.status).toBe(200);
    });

    it('returns 429 when its own limit exceeded', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await post('/api/analyze-source', { source: '<button>Save</button>', filename: 'Button.tsx' });
        expect(response.status).toBe(200);
      }

      const response = await post('/api/analyze-source', { source: '<button>Save</button>', filename: 'Button.tsx' });
      expect(response.status).toBe(429);
    });
  });

  describe('projectIntakeRateLimiter', () => {
    it('has lower limit (2 per minute)', async () => {
      const formData = new FormData();
      formData.append('files', new Blob(['<button>Save</button>']), 'Button.tsx');

      // First 2 requests should succeed
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${baseUrl}/api/project-intake`, {
          method: 'POST',
          body: formData,
        });
        expect(response.status).toBe(200);
      }

      // 3rd request should be rate limited
      const response = await fetch(`${baseUrl}/api/project-intake`, {
        method: 'POST',
        body: formData,
      });
      expect(response.status).toBe(429);
    });
  });

  describe('rate limit headers', () => {
    it('includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', async () => {
      const response = await post('/api/analyze', { html: '<main></main>', filename: 'page.html' });
      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
    });
  });
});