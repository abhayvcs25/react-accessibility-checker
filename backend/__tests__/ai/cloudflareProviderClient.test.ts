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
import { createCloudflareProviderAdapter } from '../../src/ai/cloudflareProviderClient.js';

const apiToken = 'test-cloudflare-secret';
const accountId = 'test-account-id';
const modelIds = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/google/gemma-4-26b-a4b-it',
] as const satisfies readonly CandidateModelId[];
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
    structuredOutput: 'strict_json_schema',
    documentedCapabilities: {
      ...candidate.documentedCapabilities,
      strictJsonSchemaModelSupport: 'documented',
    },
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
    id: 'cf-chatcmpl-test-123',
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

function createAdapter(fetcher: typeof fetch, environment = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN: apiToken,
}) {
  return createCloudflareProviderAdapter({ fetcher, environment });
}

afterEach(() => {
  for (const [modelId, candidate] of savedCandidates) {
    MODEL_CANDIDATES[modelId] = candidate;
  }
  savedCandidates.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Cloudflare Workers AI provider adapter', () => {
  it.each(modelIds)(
    'routes a strict-schema request to the exact model %s',
    async (modelId) => {
      const fetcher = createFetch(
        jsonResponse(completion(), {
          headers: { 'cf-ray': 'cf-test-456' },
        }),
      );
      const adapter = createAdapter(fetcher);

      const result = await adapter.complete(makeRequest(modelId));

      const expectedEndpoint =
        AI_PROVIDERS['cloudflare-workers-ai'].endpoint.replace(
          '{account_id}',
          accountId,
        );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(expectedEndpoint);
      const init = fetcher.mock.calls[0][1];
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${apiToken}`,
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
        stream: false,
        options: { rejectIfBusy: true },
      });
      expect(result).toEqual({
        providerId: 'cloudflare-workers-ai',
        modelId,
        providerRequestId: 'cf-chatcmpl-test-123',
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
    },
  );

  it('does not expose an API token embedded in provider request IDs', async () => {
    const fetcher = createFetch(
      jsonResponse(
        completion({ id: `cf-chatcmpl-${apiToken}-123` }),
        { headers: { 'cf-ray': `ray-${apiToken}-456` } },
      ),
    );

    const result = await createAdapter(fetcher).complete(
      makeRequest(modelIds[0]),
    );

    expect(result.providerRequestId).toBeNull();
    expect(JSON.stringify(result)).not.toContain(apiToken);
  });

  it('uses the next safe request-ID header when a prior header contains the token', async () => {
    const fetcher = createFetch(
      jsonResponse(completion({ id: apiToken }), {
        headers: {
          'cf-ray': `ray-${apiToken}`,
          'x-request-id': 'cf-safe-request-id',
        },
      }),
    );

    const result = await createAdapter(fetcher).complete(
      makeRequest(modelIds[0]),
    );

    expect(result.providerRequestId).toBe('cf-safe-request-id');
    expect(JSON.stringify(result)).not.toContain(apiToken);
  });

  it('does not request the network when credentials are missing', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const adapter = createCloudflareProviderAdapter({
      fetcher,
      environment: { CLOUDFLARE_ACCOUNT_ID: accountId },
    });

    await expect(
      adapter.complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: { kind: 'authentication' },
      message: 'Cloudflare Workers AI credentials are not configured.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unsupported provider models without making a request', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    const adapter = createAdapter(fetcher);
    const request = makeRequest(modelIds[0]);
    Object.assign(request, { modelId: 'openai/gpt-oss-20b' });

    await expect(adapter.complete(request)).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
      message: 'This Cloudflare model is not enabled in the provider adapter.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses Nemotron requests on or after the documented deprecation date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'));
    const fetcher = createFetch(jsonResponse(completion()));

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[1])),
    ).rejects.toMatchObject({
      message:
        'Cloudflare scheduled this Nemotron model for deprecation on 2026-11-20.',
      metadata: {
        kind: 'model_deprecated',
        statusCode: 410,
        providerCode: '5028',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces the configured application output cap', async () => {
    const fetcher = createFetch(jsonResponse(completion()));

    await expect(
      createAdapter(fetcher).complete({
        ...makeRequest(modelIds[0]),
        maxOutputTokens: 2_049,
      }),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
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

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).resolves.toMatchObject({
      status: 'incomplete',
      reason: 'length',
      finishReason: 'length',
    });
  });

  it.each([
    ['missing choices', { choices: [] }],
    [
      'empty content',
      { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
    ],
  ])('rejects %s instead of returning a success', async (_label, body) => {
    const fetcher = createFetch(jsonResponse(body));

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
    });
  });

  it('rejects malformed JSON and invalid strict-schema JSON', async () => {
    const fetcher = createFetch(new Response('not-json', { status: 200 }));
    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request', statusCode: 200 },
    });

    const invalidJsonFetcher = createFetch(
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
    await expect(
      createAdapter(invalidJsonFetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: { kind: 'invalid_request' },
      message: 'Cloudflare returned invalid JSON for a JSON Schema request.',
    });
  });

  it('classifies free-allocation exhaustion as terminal quota failure', async () => {
    const fetcher = createFetch(
      jsonResponse(
        {
          success: false,
          errors: [
            {
              code: 3036,
              message: 'test token should not be surfaced',
            },
          ],
        },
        { status: 429 },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'quota_exhausted',
        retryable: false,
        statusCode: 429,
        providerCode: '3036',
      },
    });
  });

  it('classifies busy-capacity rejection as transient', async () => {
    const fetcher = createFetch(
      jsonResponse(
        {
          success: false,
          errors: [{ code: 3040, message: 'capacity unavailable' }],
        },
        { status: 429, headers: { 'retry-after': '2' } },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'unavailable',
        retryable: true,
        statusCode: 429,
        providerCode: '3040',
        retryAfterMs: 2_000,
      },
    });
  });

  it('classifies an untyped 429 as a rate limit', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { errors: [{ code: 'rate_limited' }] },
        { status: 429 },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'rate_limited',
        retryable: true,
        statusCode: 429,
        providerCode: 'rate_limited',
      },
    });
  });

  it('normalizes Cloudflare request-timeout errors', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { errors: [{ code: 3007, message: 'request timeout' }] },
        { status: 408 },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'timeout',
        retryable: true,
        statusCode: 408,
        providerCode: '3007',
      },
    });
  });

  it('stops rather than switching to paid billing when required', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { errors: [{ code: 5035, message: 'Paid plan required.' }] },
        { status: 403 },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[0])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'billing_required',
        retryable: false,
        statusCode: 403,
        providerCode: '5035',
      },
      message:
        'Cloudflare requires a paid billing route for this model; the request was stopped.',
    });
  });

  it('distinguishes a deprecated model from other permanent failures', async () => {
    const fetcher = createFetch(
      jsonResponse(
        { errors: [{ code: 5028, message: 'Model deprecated.' }] },
        { status: 410 },
      ),
    );

    await expect(
      createAdapter(fetcher).complete(makeRequest(modelIds[1])),
    ).rejects.toMatchObject({
      metadata: {
        kind: 'model_deprecated',
        retryable: false,
        statusCode: 410,
        providerCode: '5028',
      },
    });
  });

  it('redacts provider error text and token-valued error codes', async () => {
    const fetcher = createFetch(
      jsonResponse(
        {
          id: apiToken,
          error: {
            code: apiToken,
            message: `Rejected credential ${apiToken}`,
          },
        },
        { status: 401, headers: { 'cf-ray': 'cf-auth-789' } },
      ),
    );
    let caught: unknown;
    try {
      await createAdapter(fetcher).complete(makeRequest(modelIds[0]));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderRequestError);
    expect((caught as Error).message).not.toContain(apiToken);
    expect(JSON.stringify((caught as ProviderRequestError).metadata)).not.toContain(
      apiToken,
    );
    expect((caught as ProviderRequestError).metadata).toMatchObject({
      kind: 'authentication',
      statusCode: 401,
      providerCode: null,
      providerRequestId: 'cf-auth-789',
    });
  });

  it('classifies caller timeout and cancellation separately', async () => {
    const timeoutFetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    await expect(
      createAdapter(timeoutFetcher).complete({
        ...makeRequest(modelIds[0]),
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      message: 'The Cloudflare request timed out.',
      metadata: { kind: 'timeout', retryable: true },
    });

    const cancelledFetcher = createFetch(jsonResponse(completion()));
    const controller = new AbortController();
    controller.abort();
    await expect(
      createAdapter(cancelledFetcher).complete({
        ...makeRequest(modelIds[0]),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      metadata: { kind: 'cancelled', retryable: false },
    });
    expect(cancelledFetcher).not.toHaveBeenCalled();
  });

  it('uses only the injected transport and cannot reach an external network', async () => {
    const fetcher = createFetch(jsonResponse(completion()));
    await createAdapter(fetcher).complete(makeRequest(modelIds[2]));

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      AI_PROVIDERS['cloudflare-workers-ai'].endpoint.replace(
        '{account_id}',
        accountId,
      ),
    ]);
  });
});
