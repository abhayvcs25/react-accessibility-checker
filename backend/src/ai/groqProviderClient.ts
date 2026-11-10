import {
  AI_PROVIDERS,
  getProviderCredentials,
  MODEL_CANDIDATES,
  type CandidateModelId,
  type EligibleModelId,
} from './config.js';
import {
  ProviderRequestError,
  type ProviderAdapter,
  type ProviderCompletion,
  type ProviderErrorKind,
  type ProviderRequest,
  type ProviderTokenUsage,
} from './contracts.js';

const GROQ_SUPPORTED_MODEL_IDS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
] as const satisfies readonly CandidateModelId[];

interface GroqClientOptions {
  fetcher?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGroqSupportedModel(
  modelId: CandidateModelId,
): modelId is (typeof GROQ_SUPPORTED_MODEL_IDS)[number] {
  return GROQ_SUPPORTED_MODEL_IDS.some(
    (supportedModelId) => supportedModelId === modelId,
  );
}

function requestError(
  kind: ProviderErrorKind,
  message: string,
  options: {
    retryable?: boolean;
    statusCode?: number | null;
    providerCode?: string | null;
    retryAfterMs?: number | null;
    providerRequestId?: string | null;
  } = {},
): ProviderRequestError {
  return new ProviderRequestError(message, {
    providerId: 'groq',
    kind,
    retryable: options.retryable ?? false,
    statusCode: options.statusCode ?? null,
    providerCode: options.providerCode ?? null,
    retryAfterMs: options.retryAfterMs ?? null,
    providerRequestId: options.providerRequestId ?? null,
  });
}

function safeProviderCode(value: unknown, secret: string): string | null {
  return typeof value === 'string' &&
    !value.includes(secret) &&
    /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
    ? value
    : null;
}

function safeProviderRequestId(value: unknown, secret: string): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes(secret) &&
    /^[a-zA-Z0-9._:-]+$/.test(value)
    ? value
    : null;
}

function getProviderErrorDetails(value: unknown, secret: string): {
  providerCode: string | null;
} {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { providerCode: null };
  }
  return {
    providerCode:
      safeProviderCode(value.error.code, secret) ??
      safeProviderCode(value.error.type, secret),
  };
}

function getRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (value === null) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function parseUsage(value: unknown): ProviderTokenUsage {
  if (value === undefined || value === null) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      source: 'unknown',
    };
  }
  if (!isRecord(value)) {
    throw requestError('invalid_request', 'Groq returned malformed usage data.');
  }

  const tokenFields = [
    ['prompt_tokens', 'inputTokens'],
    ['completion_tokens', 'outputTokens'],
    ['total_tokens', 'totalTokens'],
  ] as const;
  const parsed: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
  let hasUsage = false;
  for (const [sourceKey, targetKey] of tokenFields) {
    const count = value[sourceKey];
    if (count === undefined || count === null) {
      continue;
    }
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw requestError(
        'malformed_response',
        'Groq returned malformed usage data.',
      );
    }
    parsed[targetKey] = count;
    hasUsage = true;
  }
  return { ...parsed, source: hasUsage ? 'provider' : 'unknown' };
}

function parseCompletionBody(
  value: unknown,
  modelId: EligibleModelId,
  responseRequestId: string | null,
  apiKey: string,
): ProviderCompletion {
  if (
    !isRecord(value) ||
    !Array.isArray(value.choices) ||
    value.choices.length === 0
  ) {
    throw requestError(
      'malformed_response',
      'Groq returned a malformed or empty completion.',
      { providerRequestId: responseRequestId },
    );
  }
  const choice = value.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    (typeof choice.message.content !== 'string' &&
      choice.message.content !== null) ||
    (typeof choice.finish_reason !== 'string' &&
      choice.finish_reason !== null)
  ) {
    throw requestError(
      'malformed_response',
      'Groq returned a malformed completion.',
      { providerRequestId: responseRequestId },
    );
  }
  const text = choice.message.content ?? '';
  if (text.trim().length === 0) {
    throw requestError(
      'malformed_response',
      'Groq returned an empty completion.',
      { providerRequestId: responseRequestId },
    );
  }

  const finishReason = choice.finish_reason;
  const providerRequestId =
    safeProviderRequestId(value.id, apiKey) ?? responseRequestId;
  const common = {
    providerId: 'groq' as const,
    modelId,
    providerRequestId,
    finishReason,
    usage: parseUsage(value.usage),
  };

  if (finishReason === 'stop') {
    try {
      JSON.parse(text);
    } catch {
      throw requestError(
        'malformed_response',
        'Groq returned invalid JSON for a strict-schema request.',
        { providerRequestId },
      );
    }
    return { ...common, status: 'complete', text };
  }
  const reason =
    finishReason === 'length'
      ? 'length'
      : finishReason === 'content_filter'
        ? 'content_filter'
        : finishReason === 'tool_calls' || finishReason === 'function_call'
          ? 'tool_call'
          : finishReason === null
            ? 'provider_incomplete'
            : 'unsupported';
  return { ...common, status: 'incomplete', text, reason };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw requestError(
      'malformed_response',
      'Groq returned a non-JSON or malformed response.',
      { statusCode: response.status },
    );
  }
}

function classifyHttpError(
  statusCode: number,
  responseRequestId: string | null,
  body: unknown,
  retryAfterMs: number | null,
  apiKey: string,
): ProviderRequestError {
  const { providerCode } = getProviderErrorDetails(body, apiKey);
  const normalizedCode = providerCode?.toLowerCase();
  const isQuotaError =
    normalizedCode === 'insufficient_quota' ||
    normalizedCode === 'quota_exceeded';

  if (isQuotaError) {
    return requestError(
      'quota_exhausted',
      'Groq rejected the request because the available quota is exhausted.',
      {
        statusCode,
        providerCode,
        providerRequestId: responseRequestId,
      },
    );
  }
  if (statusCode === 429) {
    return requestError('rate_limited', 'Groq rate limit was reached.', {
      retryable: true,
      statusCode,
      providerCode,
      retryAfterMs,
      providerRequestId: responseRequestId,
    });
  }
  if (statusCode === 401 || statusCode === 403) {
    return requestError('authentication', 'Groq rejected the credentials.', {
      statusCode,
      providerCode,
      providerRequestId: responseRequestId,
    });
  }
  if ([400, 404, 413, 422].includes(statusCode)) {
    return requestError('invalid_request', 'Groq rejected the request.', {
      statusCode,
      providerCode,
      providerRequestId: responseRequestId,
    });
  }
  if (statusCode >= 500 || statusCode === 498) {
    return requestError('unavailable', 'Groq is temporarily unavailable.', {
      retryable: true,
      statusCode,
      providerCode,
      providerRequestId: responseRequestId,
    });
  }
  return requestError('unknown', 'Groq returned an unsuccessful response.', {
    statusCode,
    providerCode,
    providerRequestId: responseRequestId,
  });
}

export function createGroqProviderAdapter(
  options: GroqClientOptions = {},
): ProviderAdapter {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const environment = options.environment ?? process.env;

  return {
    providerId: 'groq',
    async complete(request) {
      const modelId: CandidateModelId = request.modelId;
      if (!isGroqSupportedModel(modelId)) {
        throw requestError(
          'invalid_request',
          'This Groq model is not enabled in the provider adapter.',
        );
      }
      const candidate = MODEL_CANDIDATES[modelId];
      if (
        candidate.documentedCapabilities.strictJsonSchemaParameter !==
          'documented' ||
        candidate.structuredOutput !== 'strict_json_schema'
      ) {
        throw requestError(
          'invalid_request',
          'Strict JSON Schema is not verified for this Groq model.',
        );
      }
      if (
        request.responseFormat !== 'strict_json_schema' ||
        !request.responseSchema.name.trim() ||
        !isRecord(request.responseSchema.schema) ||
        !Number.isSafeInteger(request.maxOutputTokens) ||
        request.maxOutputTokens <= 0 ||
        request.maxOutputTokens > candidate.applicationMaxOutputTokens ||
        !Number.isSafeInteger(request.timeoutMs) ||
        request.timeoutMs <= 0 ||
        request.timeoutMs > 2_147_483_647 ||
        request.messages.length === 0 ||
        request.messages.some(
          (message) =>
            typeof message.content !== 'string' ||
            message.content.trim().length === 0,
        )
      ) {
        throw requestError(
          'invalid_request',
          'The Groq request is incomplete or exceeds configured limits.',
        );
      }

      let requestBody: string;
      try {
        requestBody = JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          max_completion_tokens: request.maxOutputTokens,
          reasoning_effort: 'low',
          include_reasoning: false,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.responseSchema.name,
              ...(request.responseSchema.description
                ? { description: request.responseSchema.description }
                : {}),
              schema: request.responseSchema.schema,
              strict: true,
            },
          },
        });
      } catch {
        throw requestError(
          'invalid_request',
          'The Groq request could not be serialized.',
        );
      }

      const credentials = getProviderCredentials('groq', environment);
      if (
        credentials.status !== 'configured' ||
        !('groqApiKey' in credentials)
      ) {
        throw requestError(
          'authentication',
          'Groq credentials are not configured.',
        );
      }

      const controller = new AbortController();
      let timeoutExpired = false;
      const timeout = setTimeout(() => {
        timeoutExpired = true;
        controller.abort();
      }, request.timeoutMs);
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (request.signal?.aborted) {
        controller.abort();
      }

      try {
        if (controller.signal.aborted && !timeoutExpired) {
          throw requestError(
            'cancelled',
            'The Groq request was cancelled.',
          );
        }
        const response = await fetcher(AI_PROVIDERS.groq.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credentials.groqApiKey}`,
            'content-type': 'application/json',
          },
          body: requestBody,
          signal: controller.signal,
        });

        const responseRequestId =
          safeProviderRequestId(
            response.headers.get('x-request-id'),
            credentials.groqApiKey,
          ) ??
          safeProviderRequestId(
            response.headers.get('request-id'),
            credentials.groqApiKey,
          );
        if (!response.ok) {
          let errorBody: unknown = null;
          try {
            errorBody = await response.json();
          } catch {
            errorBody = null;
          }
          throw classifyHttpError(
            response.status,
            responseRequestId,
            errorBody,
            getRetryAfterMs(response.headers.get('retry-after')),
            credentials.groqApiKey,
          );
        }

        const body = await readJson(response);
        return parseCompletionBody(
          body,
          request.modelId,
          responseRequestId,
          credentials.groqApiKey,
        );
      } catch (error) {
        if (error instanceof ProviderRequestError) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw requestError(
            timeoutExpired ? 'timeout' : 'cancelled',
            timeoutExpired
              ? 'The Groq request timed out.'
              : 'The Groq request was cancelled.',
            { retryable: timeoutExpired },
          );
        }
        throw requestError(
          'transport',
          'The Groq request failed before a response was received.',
          { retryable: true },
        );
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
