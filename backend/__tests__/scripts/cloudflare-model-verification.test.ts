import { describe, expect, it, vi } from 'vitest';
import {
  runCloudflareModelVerification,
} from '../../scripts/cloudflare-model-verification.js';

const credentials = {
  CLOUDFLARE_ACCOUNT_ID: 'test-account',
  CLOUDFLARE_API_TOKEN: 'test-token',
};

describe('Cloudflare model verification probes', () => {
  it('sends greeting requests sequentially with at least five seconds between starts', async () => {
    let clock = 1_000;
    const requestTimes: number[] = [];
    const requestModels: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      requestTimes.push(clock);
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        input: {
          messages: Array<{ role: string; content: string }>;
          chat_template_kwargs: { enable_thinking: boolean };
          temperature: number;
          response_format?: unknown;
          max_tokens: number;
        };
      };
      requestModels.push(request.model);
      expect(request.input.messages).toHaveLength(2);
      expect(request.input.chat_template_kwargs).toEqual({
        enable_thinking: false,
      });
      expect(request.input.temperature).toBe(0.3);
      expect(request.input.response_format).toBeUndefined();
      expect(request.input.max_tokens).toBe(64);
      return new Response(JSON.stringify({
        result: {
          choices: [{
            message: { content: 'Hello!' },
            finish_reason: 'stop',
          }],
        },
      }));
    });
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });

    const results = await runCloudflareModelVerification('greeting', {
      accountPreflight: {
        workersFreeConfirmed: true,
        noPaidPathConfirmed: true,
        remainingNeurons: 10_000,
      },
      environment: credentials,
      fetcher,
      now: () => clock,
      sleep,
    });

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(requestModels).toEqual([
      '@cf/zai-org/glm-4.7-flash',
      '@cf/nvidia/nemotron-3-120b-a12b',
      '@cf/google/gemma-4-26b-a4b-it',
    ]);
    expect(requestTimes).toEqual([1_000, 6_000, 11_000]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 5_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
  });

  it('requests strict JSON Schema and validates the greeting object', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        result: {
          choices: [{
            message: { content: '{"greeting":"Hello!"}' },
            finish_reason: 'stop',
          }],
        },
      }));
    });

    const results = await runCloudflareModelVerification('strict-json', {
      accountPreflight: {
        workersFreeConfirmed: true,
        noPaidPathConfirmed: true,
        remainingNeurons: 10_000,
        connectivityConfirmed: true,
      },
      environment: credentials,
      fetcher,
      now: () => 1_000,
      sleep: async () => undefined,
    });

    expect(requestBody?.input).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.3,
      max_tokens: 512,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['greeting'],
          strict: true,
        },
      },
    });
    expect(results).toHaveLength(3);
    expect(results.every((result) =>
      result.ok &&
      result.validation === 'passed' &&
      result.output?.greeting === 'Hello!',
    )).toBe(true);
  });

  it('stops after the provider reports exhausted free quota', async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ code: 3036 }] }), {
        status: 429,
      }),
    );

    const results = await runCloudflareModelVerification('greeting', {
      accountPreflight: {
        workersFreeConfirmed: true,
        noPaidPathConfirmed: true,
        remainingNeurons: 10_000,
      },
      environment: credentials,
      fetcher,
      now: () => 1_000,
      sleep: async () => undefined,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toEqual([expect.objectContaining({
      ok: false,
      attempts: 1,
      errorCode: '3036',
      attemptHistory: [expect.objectContaining({ errorCode: '3036' })],
    })]);
  });

  it('retries explicit transient errors up to three total attempts with pacing', async () => {
    let clock = 1_000;
    let calls = 0;
    const requestTimes: number[] = [];
    const fetcher: typeof fetch = vi.fn(async () => {
      requestTimes.push(clock);
      calls += 1;
      if (calls < 3) {
        return new Response(JSON.stringify({
          errors: [{ code: '3040' }],
        }), { status: 503 });
      }
      return new Response(JSON.stringify({
        result: {
          choices: [{
            message: { content: '{"greeting":"Hello!"}' },
            finish_reason: 'stop',
          }],
        },
      }));
    });

    const results = await runCloudflareModelVerification('strict-json', {
      accountPreflight: {
        workersFreeConfirmed: true,
        noPaidPathConfirmed: true,
        remainingNeurons: 10_000,
        connectivityConfirmed: true,
      },
      environment: credentials,
      fetcher,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      models: ['@cf/zai-org/glm-4.7-flash'],
    });

    expect(requestTimes).toEqual([1_000, 6_000, 11_000]);
    expect(results).toEqual([expect.objectContaining({
      modelId: '@cf/zai-org/glm-4.7-flash',
      ok: true,
      attempts: 3,
      attemptHistory: [
        expect.objectContaining({ attempt: 1, httpStatus: 503 }),
        expect.objectContaining({ attempt: 2, httpStatus: 503 }),
        expect.objectContaining({ attempt: 3, httpStatus: 200 }),
      ],
    })]);
  });

  it('does not retry a completed but invalid JSON Schema response', async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        result: {
          choices: [{
            message: { content: 'not json' },
            finish_reason: 'stop',
          }],
        },
      })),
    );

    const results = await runCloudflareModelVerification('strict-json', {
      accountPreflight: {
        workersFreeConfirmed: true,
        noPaidPathConfirmed: true,
        remainingNeurons: 10_000,
        connectivityConfirmed: true,
      },
      environment: credentials,
      fetcher,
      models: ['@cf/zai-org/glm-4.7-flash'],
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      ok: false,
      attempts: 1,
      output: 'not json',
      validation: 'failed',
    });
  });

  it('refuses to contact a provider without explicit account preflight', async () => {
    const fetcher: typeof fetch = vi.fn();
    await expect(runCloudflareModelVerification('greeting', {
      accountPreflight: {
        workersFreeConfirmed: false,
        noPaidPathConfirmed: false,
        remainingNeurons: 0,
      },
      environment: credentials,
      fetcher,
    })).rejects.toThrow('current Workers Free');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
