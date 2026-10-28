import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_SIZE } from '../../src/config.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import analyzeRouter from '../../src/routes/analyze.js';

const { analyzeHtml } = vi.hoisted(() => ({
  analyzeHtml: vi.fn(),
}));

vi.mock('../../src/services/checker.js', () => ({ analyzeHtml }));

const responseBody = {
  filename: 'page.html',
  analyzedAt: '2026-10-28T00:00:00.000Z',
  summary: {
    total: 0,
    violations: 0,
    potentialViolations: 0,
    recommendations: 0,
    potentialRecommendations: 0,
    manual: 0,
  },
  issues: [],
};

describe('POST /api/analyze', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: MAX_BODY_SIZE }));
    app.use(analyzeRouter);
    app.use(errorHandler);

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

  beforeEach(() => {
    analyzeHtml.mockReset();
    analyzeHtml.mockResolvedValue(responseBody);
  });

  async function post(body: string, contentType = 'application/json') {
    return fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
  }

  it('returns the analysis response and trims the filename', async () => {
    const response = await post(
      JSON.stringify({ html: '<main></main>', filename: ' page.HTML  ' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(responseBody);
    expect(analyzeHtml).toHaveBeenCalledWith('<main></main>', 'page.HTML');
  });

  it('returns 415 for unsupported content types', async () => {
    const response = await post(
      '{"html":"<main></main>","filename":"page.html"}',
      'text/plain',
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: 'Content-Type must be application/json',
    });
    expect(analyzeHtml).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object body', 'null'],
    ['non-string HTML', '{"html":12,"filename":"page.html"}'],
    ['empty HTML', '{"html":"","filename":"page.html"}'],
    ['non-string filename', '{"html":"<main></main>","filename":12}'],
    ['invalid filename extension', '{"html":"<main></main>","filename":"page.txt"}'],
  ])('returns 400 for a %s', async (_description, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
    expect(analyzeHtml).not.toHaveBeenCalled();
  });

  it('preserves the malformed JSON 400 response', async () => {
    const response = await post('{"html":');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid JSON in request body',
    });
  });

  it('preserves the oversized JSON 413 response', async () => {
    const oversizedBody = JSON.stringify({
      html: 'a'.repeat(5 * 1024 * 1024),
      filename: 'page.html',
    });
    const response = await post(oversizedBody);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
  });

  it('forwards service failures without exposing internal details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    analyzeHtml.mockRejectedValue(new Error('private service detail'));

    try {
      const response = await post(
        JSON.stringify({ html: '<main></main>', filename: 'page.html' }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'Internal server error',
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
