import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accounting = vi.hoisted(() => {
  let nextAttemptId = 0;
  return {
    recordApiAttemptEnd: vi.fn(),
    waitForProviderCapacity: vi.fn(async () => ({
      id: String(++nextAttemptId),
      at: Date.now(),
    })),
    withProviderConcurrency: vi.fn(
      async (_provider: string, operation: () => Promise<unknown>) =>
        operation(),
    ),
    resetAttemptIds: () => {
      nextAttemptId = 0;
    },
  };
});

vi.mock('../../src/ai/usage.js', () => ({
  recordApiAttemptEnd: accounting.recordApiAttemptEnd,
}));
vi.mock('../../src/ai/rateLimiter.js', () => ({
  waitForProviderCapacity: accounting.waitForProviderCapacity,
  withProviderConcurrency: accounting.withProviderConcurrency,
}));

import {
  AI_MODELS,
  AI_PROVIDERS,
  aiRuntimeConfig,
  type AiModelId,
} from '../../src/ai/config.js';
import {
  checkModelConnection,
  generateProviderCompletion,
} from '../../src/ai/providerClient.js';

const responseText =
  '{"assessment":"no_issue_detected","explanation":"The supplied name is clear."}';
const modelIds = Object.keys(AI_MODELS) as AiModelId[];
const previousKeys = new Map(
  [...new Set(Object.values(AI_PROVIDERS).map(({ keyEnv }) => keyEnv))].map(
    (key) => [key, process.env[key]],
  ),
);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [key, value] of previousKeys) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  accounting.recordApiAttemptEnd.mockClear();
  accounting.waitForProviderCapacity.mockClear();
  accounting.withProviderConcurrency.mockClear();
  accounting.resetAttemptIds();
});

describe('free model provider clients', () => {
  it('checks the selected model and validates a structured model response', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: '{"assessment":"no_issue_detected","explanation":"connection test"}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkModelConnection('gemini-3.8-flash')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${AI_PROVIDERS.gemini.endpoint}/models/gemini-3.8-flash:generateContent`,
    );
    const body = JSON.parse(String(options.body)) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: {
        maxOutputTokens: number;
        responseMimeType: string;
        responseJsonSchema: Record<string, unknown>;
      };
    };
    expect(body.contents[0]?.parts[0]?.text).toContain('"assessment"');
    expect(body.generationConfig.maxOutputTokens).toBe(
      aiRuntimeConfig.maxOutputTokens,
    );
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toEqual({
      type: 'object',
      properties: {
        assessment: {
          type: 'string',
          enum: [
            'potential_issue',
            'no_issue_detected',
            'insufficient_context',
          ],
        },
        explanation: { type: 'string' },
      },
      required: ['assessment', 'explanation'],
    });
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });

  it('returns false and logs the selected provider error when the check fails', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 403 })),
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(checkModelConnection('gemini-3.8-flash')).resolves.toBe(false);

    expect(errorLog).toHaveBeenCalledWith(
      '[ai] gemini/gemini-3.8-flash connection check failed:',
      expect.objectContaining({
        statusCode: 403,
        message: 'Provider request failed with HTTP 403.',
      }),
    );
  });

  it('returns false when HTTP succeeds but the model response is empty', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(checkModelConnection('gemini-3.8-flash')).resolves.toBe(false);
  });

  it('logs only redacted Gemini response diagnostics for the form-label rule', async () => {
    const previousDiagnostics = process.env.RAC_AI_RESPONSE_DIAGNOSTICS;
    process.env.RAC_AI_RESPONSE_DIAGNOSTICS = '1';
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    const privateText = 'Private user supplied label text';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                role: 'model',
                parts: [
                  {
                    text: JSON.stringify({
                      assessment: 'no_issue_detected',
                      explanation: privateText,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    try {
      await generateProviderCompletion(
        'gemini-3.8-flash',
        'FORM-LABEL-RELEVANCE: inspect the supplied label.',
      );

      expect(infoLog).toHaveBeenCalledOnce();
      const diagnostic = String(infoLog.mock.calls[0]?.[0]);
      expect(diagnostic).toContain('"finishReason":"STOP"');
      expect(diagnostic).toContain('"textLength"');
      expect(diagnostic).toContain('"originalLength"');
      expect(diagnostic).not.toContain(privateText);
      expect(diagnostic).not.toContain('test-key-not-sent-to-network');
    } finally {
      if (previousDiagnostics === undefined) {
        delete process.env.RAC_AI_RESPONSE_DIAGNOSTICS;
      } else {
        process.env.RAC_AI_RESPONSE_DIAGNOSTICS = previousDiagnostics;
      }
    }
  });

  it('checks the requested OpenRouter model instead of Gemini', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-not-sent-to-network';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"assessment":"no_issue_detected","explanation":"connection test"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkModelConnection('google/gemma-4-31b-it:free'),
    ).resolves.toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AI_PROVIDERS.openrouter.endpoint}/chat/completions`);
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });

  it('returns false without making a request when the Gemini key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(checkModelConnection()).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(modelIds)(
    'does not make a network request without the provider key for %s',
    async (modelId) => {
      const provider = AI_PROVIDERS[AI_MODELS[modelId].provider];
      delete process.env[provider.keyEnv];
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        generateProviderCompletion(modelId, 'test prompt'),
      ).rejects.toThrow(`Missing ${provider.keyEnv}`);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(modelIds)(
    'uses the zero-paid-usage API request for %s',
    async (modelId) => {
      const model = AI_MODELS[modelId];
      const provider = AI_PROVIDERS[model.provider];
      process.env[provider.keyEnv] = 'test-key-not-sent-to-network';
      const data =
        provider.api === 'gemini'
          ? {
              candidates: [
                { content: { parts: [{ text: responseText }] } },
              ],
              usageMetadata: {
                promptTokenCount: 17,
                candidatesTokenCount: 11,
              },
            }
          : {
              choices: [{ message: { content: responseText } }],
              usage: { prompt_tokens: 17, completion_tokens: 11 },
            };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await generateProviderCompletion(
        modelId,
        'Use only the supplied evidence.',
      );

      expect(result).toMatchObject({
        text: responseText,
        inputTokens: 17,
        outputTokens: 11,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(options.signal).toBeUndefined();
      expect(url).toBe(
        provider.api === 'gemini'
          ? `${provider.endpoint}/models/${modelId}:generateContent`
          : `${provider.endpoint}/chat/completions`,
      );
      const requestBody = JSON.parse(String(options.body)) as Record<
        string,
        unknown
      >;
      if (provider.api === 'gemini') {
        expect(url).toContain(modelId);
        expect(
          (requestBody.generationConfig as Record<string, unknown>)
            .maxOutputTokens,
        ).toBe(aiRuntimeConfig.maxOutputTokens);
      } else {
        expect(requestBody.model).toBe(modelId);
        expect(requestBody.max_tokens).toBe(aiRuntimeConfig.maxOutputTokens);
      }
      expect(JSON.stringify(requestBody)).not.toContain(
        'test-key-not-sent-to-network',
      );
      expect(JSON.stringify(options.headers)).toContain(
        'test-key-not-sent-to-network',
      );
      if (provider.api === 'openai-compatible') {
        expect(requestBody.provider).toEqual({ allow_fallbacks: false });
        expect(requestBody).not.toHaveProperty('models');
      }
      expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
    },
  );

  it.each([429, 503])(
    'retries HTTP %s responses with jittered exponential backoff',
    async (statusCode) => {
      const modelId = 'gemini-3.8-flash';
      const provider = AI_PROVIDERS[AI_MODELS[modelId].provider];
      process.env[provider.keyEnv] = 'test-key-not-sent-to-network';
      const successData = {
        candidates: [{ content: { parts: [{ text: responseText }] } }],
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: statusCode }))
        .mockResolvedValueOnce(new Response('{}', { status: statusCode }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(successData), { status: 200 }),
        );
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      vi.stubGlobal('fetch', fetchMock);
      vi.useFakeTimers();

      const completion = generateProviderCompletion(modelId, 'test prompt');
      await vi.runAllTimersAsync();
      await expect(completion).resolves.toMatchObject({ text: responseText });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('1500ms'),
      );
      expect(warn).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('2500ms'),
      );
      expect(accounting.recordApiAttemptEnd).toHaveBeenCalledTimes(3);
    },
  );

  it('honors Retry-After and records each HTTP attempt separately', async () => {
    const modelId = 'gemini-3.8-flash';
    const provider = AI_PROVIDERS[AI_MODELS[modelId].provider];
    process.env[provider.keyEnv] = 'test-key-not-sent-to-network';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 503,
          headers: { 'retry-after': '2' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: responseText }] } }],
          }),
          { status: 200 },
        ),
      );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const completion = generateProviderCompletion(modelId, 'test prompt');
    await vi.runAllTimersAsync();
    await expect(completion).resolves.toMatchObject({ text: responseText });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2000ms'));
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledTimes(2);
  });

  it('throws after configured retries for persistent HTTP 503 responses', async () => {
    const modelId = 'gemini-3.8-flash';
    const provider = AI_PROVIDERS[AI_MODELS[modelId].provider];
    process.env[provider.keyEnv] = 'test-key-not-sent-to-network';
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 503 })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const completion = expect(
      generateProviderCompletion(modelId, 'test prompt'),
    ).rejects.toThrow('HTTP 503');
    await vi.runAllTimersAsync();
    await completion;
    expect(fetchMock).toHaveBeenCalledTimes(aiRuntimeConfig.maxRetries + 1);
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledTimes(
      aiRuntimeConfig.maxRetries + 1,
    );
  });

  it('reports provider quota exhaustion only when the API response says so', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded for the current project.',
          },
        }),
        { status: 429 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateProviderCompletion('gemini-3.8-flash', 'test prompt'),
    ).rejects.toMatchObject({
      statusCode: 429,
      providerQuotaExceeded: true,
      message: 'Provider reported quota exhaustion: Quota exceeded for the current project.',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });

  it('rejects Gemini responses with no candidates', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      ),
    );

    await expect(
      generateProviderCompletion('gemini-3.8-flash', 'test prompt'),
    ).rejects.toThrow('Gemini returned no completion content.');
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });

  it('rejects Gemini candidates that finish before completing the response', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ text: '{"assessment":"potential_issue"' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      generateProviderCompletion('gemini-3.8-flash', 'test prompt'),
    ).rejects.toThrow('incomplete completion (finish reason: MAX_TOKENS)');
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });

  it('returns malformed Gemini JSON text for strict assessment validation', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-sent-to-network';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"assessment":' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      generateProviderCompletion('gemini-3.8-flash', 'test prompt'),
    ).resolves.toMatchObject({ text: '{"assessment":' });
    expect(accounting.recordApiAttemptEnd).toHaveBeenCalledOnce();
  });
});
