import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDERS,
  MODEL_CANDIDATES,
  requireEligibleModel,
  type CandidateModelId,
  type ModelCandidate,
} from '../../src/ai/config.js';
import {
  ProviderRequestError,
  type ProviderRequest,
} from '../../src/ai/contracts.js';
import { createGroqProviderAdapter } from '../../src/ai/groqProviderClient.js';

const apiKey = 'test-groq-secret';
const schema = {
  type: 'object',
  properties: { passed: { type: 'boolean' } },
  required: ['passed'],
  additionalProperties: false,
};
const savedCandidates = new Map<CandidateModelId, ModelCandidate>();

function eligibleModelId(modelId: CandidateModelId) {
  const candidate = MODEL_CANDIDATES[modelId];
  if (!savedCandidates.has(modelId)) {
    savedCandidates.set(modelId, candidate);
  }
  MODEL_CANDIDATES[modelId] = {
    ...candidate,
    verificationStatus: 'verified',
    runtimeVerificationStatus: 'verified',
    eligibility: 'eligible',
    operatorEnabled: true,
  };
  return requireEligibleModel(modelId).modelId;
}

function makeRequest(modelId: CandidateModelId): ProviderRequest {
  return {
    modelId: eligibleModelId(modelId),
    messages: [
      { role: 'system', content: 'Return the requested JSON result.' },
      { role: 'user', content: 'Check the supplied content.' },
    ],
    maxOutputTokens: 2_048,
    timeoutMs: 1_000,
    responseFormat: 'strict_json_schema',
    responseSchema: {
      name: 'accessibility_result',
      description: 'Structured accessibility assessment.',
      schema,
    },
  };
}

function createFetch(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

function jsonResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: options.headers,
  });
}

function completion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'chatcmpl-test-123',
    choices: [
      {
        finish_reason: 'stop',
        message: { content: '{"passed":true}' },
      },
    ],
    usage: {
      prompt_tokens: 18,
      completion_tokens: 4,
      total_tokens: 22,
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const [modelId, candidate] of savedCandidates) {
    MODEL_CANDIDATES[modelId] = candidate;
  }
  savedCandidates.clear();
  vi.restoreAllMocks();
});

describe('Groq provider adapter', () => {
  it.each([
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ] as const)('builds a strict-schema request for %s', async (modelId) => {
    const fetcher = createFetch(
      jsonResponse(completion(), {
        headers: { 'x-request-id': 'req-groq-456' },
      }),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    const result = await adapter.complete(makeRequest(modelId));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(AI_PROVIDERS.groq.endpoint);
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${apiKey}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: modelId,
      messages: [
        { role: 'system', content: 'Return the requested JSON result.' },
        { role: 'user', content: 'Check the supplied content.' },
      ],
      max_completion_tokens: 2_048,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'accessibility_result',
          description: 'Structured accessibility assessment.',
          schema,
          strict: true,
        },
      },
    });
    expect(result).toEqual({
      providerId: 'groq',
      modelId,
      providerRequestId: 'chatcmpl-test-123',
      finishReason: 'stop',
      usage: {
        inputTokens: 18,
        outputTokens: 4,
        totalTokens: 22,
        source: 'provider',
      },
      status: 'complete',
      text: '{"passed":true}',
    });
  });

  it('does not expose an API key embedded in provider request IDs', async () => {
    const fetcher = createFetch(
      jsonResponse(
        completion({ id: `chatcmpl-${apiKey}-123` }),
        { headers: { 'x-request-id': `req-${apiKey}-456` } },
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    const result = await adapter.complete(
      makeRequest('openai/gpt-oss-20b'),
    );

    expect(result.providerRequestId).toBeNull();
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it('does not make a request when credentials are missing', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: {},
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: { kind: 'authentication' },
      message: 'Groq credentials are not configured.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes an incomplete length-limited response', async () => {
    const fetcher = createFetch(
      jsonResponse(
        completion({
          choices: [
            {
              finish_reason: 'length',
              message: { content: '{"passed":' },
            },
          ],
        }),
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).resolves.toMatchObject({
      status: 'incomplete',
      reason: 'length',
      finishReason: 'length',
    });
  });

  it.each([
    ['content_filter', 'content_filter'],
    ['tool_calls', 'tool_call'],
  ] as const)(
    'normalizes the %s finish reason as incomplete',
    async (finishReason, reason) => {
      const fetcher = createFetch(
        jsonResponse(
          completion({
            choices: [
              {
                finish_reason: finishReason,
                message: { content: '{"passed":false}' },
              },
            ],
          }),
        ),
      );
      const adapter = createGroqProviderAdapter({
        fetcher,
        environment: { GROQ_API_KEY: apiKey },
      });

      await expect(
        adapter.complete(makeRequest('openai/gpt-oss-20b')),
      ).resolves.toMatchObject({
        status: 'incomplete',
        reason,
        finishReason,
      });
    },
  );

  it.each([
    ['missing choices', { choices: [] }],
    [
      'empty content',
      { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
    ],
  ])('rejects %s instead of returning a success', async (_label, body) => {
    const fetcher = createFetch(jsonResponse(body));
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
    });
  });

  it('rejects a non-JSON success envelope', async () => {
    const fetcher = createFetch(
      new Response('not-json', { status: 200 }),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request', statusCode: 200 },
    });
  });

  it('distinguishes rate limits and normalizes Retry-After', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { error: { type: 'rate_limit_exceeded' } },
        { status: 429, headers: { 'retry-after': '3' } },
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'rate_limited',
        retryable: true,
        statusCode: 429,
        retryAfterMs: 3_000,
        providerCode: 'rate_limit_exceeded',
      },
    });
  });

  it('distinguishes explicit quota exhaustion', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { error: { code: 'insufficient_quota' } },
        { status: 429 },
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: { kind: 'quota_exhausted', statusCode: 429 },
    });
  });

  it('rejects unsupported Qwen requests without making a request', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });
    const request = makeRequest('openai/gpt-oss-20b');
    Object.assign(request, { modelId: 'qwen/qwen3.8-27b' });

    await expect(adapter.complete(request)).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
      message: 'This Groq model is not enabled in the provider adapter.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('redacts provider error text and never exposes the API key', async () => {
    const fetcher = createFetch(
      jsonResponse(
        {
          error: {
            code: apiKey,
            type: 'authentication_error',
            message: `Rejected credential ${apiKey}`,
          },
        },
        {
          status: 401,
          headers: { 'x-request-id': 'req-auth-789' },
        },
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    let caught: unknown;
    try {
      await adapter.complete(makeRequest('openai/gpt-oss-20b'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderRequestError);
    expect((caught as Error).message).not.toContain(apiKey);
    expect(JSON.stringify((caught as ProviderRequestError).metadata)).not.toContain(
      apiKey,
    );
    expect((caught as ProviderRequestError).metadata).toMatchObject({
      kind: 'authentication',
      statusCode: 401,
      providerRequestId: 'req-auth-789',
      providerCode: 'authentication_error',
    });
  });

  it('does not return invalid JSON as a complete strict-schema result', async () => {
    const fetcher = createFetch(
      jsonResponse(
        completion({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: 'not-json' },
            },
          ],
        }),
      ),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete(makeRequest('openai/gpt-oss-20b')),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
      message: 'Groq returned invalid JSON for a strict-schema request.',
    });
  });

  it('classifies timeout without exposing transport errors', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete({
        ...makeRequest('openai/gpt-oss-20b'),
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      message: 'The Groq request timed out.',
      metadata: { kind: 'timeout', retryable: true },
    });
  });

  it('classifies caller cancellation without making a request', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const controller = new AbortController();
    controller.abort();
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await expect(
      adapter.complete({
        ...makeRequest('openai/gpt-oss-20b'),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      metadata: { kind: 'cancelled', retryable: false },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses only the injected transport, so tests cannot reach the network', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const adapter = createGroqProviderAdapter({
      fetcher,
      environment: { GROQ_API_KEY: apiKey },
    });

    await adapter.complete(makeRequest('openai/gpt-oss-20b'));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      AI_PROVIDERS.groq.endpoint,
    ]);
  });
});
