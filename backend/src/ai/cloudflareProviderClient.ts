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

const CLOUDFLARE_SUPPORTED_MODEL_IDS = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/google/gemma-4-26b-a4b-it',
] as const satisfies readonly CandidateModelId[];
const NEMOTRON_DEPRECATION_DATE = Date.UTC(2026, 10, 20);

interface CloudflareClientOptions {
  fetcher?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCloudflareSupportedModel(
  modelId: CandidateModelId,
): modelId is (typeof CLOUDFLARE_SUPPORTED_MODEL_IDS)[number] {
  return CLOUDFLARE_SUPPORTED_MODEL_IDS.some(
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
    providerId: 'cloudflare-workers-ai',
    kind,
    retryable: options.retryable ?? false,
    statusCode: options.statusCode ?? null,
    providerCode: options.providerCode ?? null,
    retryAfterMs: options.retryAfterMs ?? null,
    providerRequestId: options.providerRequestId ?? null,
  });
}

function getErrorDetails(
  value: unknown,
  secret: string,
): { code: string | null } {
  const asSafeCode = (code: unknown): string | null => {
    if (typeof code !== 'string' && typeof code !== 'number') {
      return null;
    }
    const text = String(code);
    return !text.includes(secret) && /^[a-zA-Z0-9_.-]{1,80}$/.test(text)
      ? text
      : null;
  };
  if (!isRecord(value)) {
    return { code: null };
  }
  if (isRecord(value.error)) {
    return {
      code:
        asSafeCode(value.error.code) ?? asSafeCode(value.error.type),
    };
  }
  if (Array.isArray(value.errors) && isRecord(value.errors[0])) {
    return {
      code: asSafeCode(value.errors[0].code),
    };
  }
  return { code: null };
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
  const usage = isRecord(value) && isRecord(value.result)
    ? value.result.usage
    : isRecord(value) && isRecord(value.usage)
      ? value.usage
      : undefined;
  if (usage === undefined || usage === null) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      source: 'unknown',
    };
  }
  if (!isRecord(usage)) {
    throw requestError(
      'malformed_response',
      'Cloudflare returned malformed usage data.',
    );
  }

  const fields = [
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
  for (const [sourceKey, targetKey] of fields) {
    const count = usage[sourceKey];
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
        'Cloudflare returned malformed usage data.',
      );
    }
    parsed[targetKey] = count;
    hasUsage = true;
  }
  return { ...parsed, source: hasUsage ? 'provider' : 'unknown' };
}

function parseCompletion(
  value: unknown,
  modelId: EligibleModelId,
  responseRequestId: string | null,
  apiToken: string,
): ProviderCompletion {
  if (
    !isRecord(value) ||
    !isRecord(value.result) ||
    !Array.isArray(value.result.choices) ||
    value.result.choices.length === 0
  ) {
    throw requestError(
      'malformed_response',
      'Cloudflare returned a malformed or empty completion.',
      { providerRequestId: responseRequestId },
    );
  }
  const choice = value.result.choices[0];
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
      'Cloudflare returned a malformed completion.',
      { providerRequestId: responseRequestId },
    );
  }
  const text = choice.message.content ?? '';
  if (text.trim().length === 0) {
    throw requestError(
      'malformed_response',
      'Cloudflare returned an empty completion.',
      { providerRequestId: responseRequestId },
    );
  }

  const finishReason = choice.finish_reason;
  const resultId = safeProviderRequestId(value.result.id, apiToken);
  const providerRequestId =
    safeProviderRequestId(value.id, apiToken) ??
    resultId ??
    responseRequestId;
  const common = {
    providerId: 'cloudflare-workers-ai' as const,
    modelId,
    providerRequestId,
    finishReason,
    usage: parseUsage(value),
  };
  if (finishReason === 'stop') {
    try {
      JSON.parse(text);
    } catch {
      throw requestError(
        'malformed_response',
        'Cloudflare returned invalid JSON for a JSON Schema request.',
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

function safeProviderRequestId(value: unknown, secret: string): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes(secret) &&
    /^[a-zA-Z0-9._:-]+$/.test(value)
    ? value
    : null;
}

function getProviderRequestId(
  value: unknown,
  response: Response,
  secret: string,
): string | null {
  const bodyRequestId = isRecord(value)
    ? safeProviderRequestId(value.id, secret)
    : null;
  const resultRequestId =
    isRecord(value) && isRecord(value.result)
      ? safeProviderRequestId(value.result.id, secret)
      : null;
  if (bodyRequestId !== null || resultRequestId !== null) {
    return bodyRequestId ?? resultRequestId;
  }
  return (
    safeProviderRequestId(response.headers.get('cf-ray'), secret) ??
    safeProviderRequestId(response.headers.get('x-request-id'), secret) ??
    safeProviderRequestId(response.headers.get('request-id'), secret)
  );
}

function classifyHttpError(
  statusCode: number,
  code: string | null,
  responseRequestId: string | null,
  retryAfterMs: number | null,
): ProviderRequestError {
  const errorOptions = {
    statusCode,
    providerCode: code,
    providerRequestId: responseRequestId,
  };
  if (code === '3036') {
    return requestError(
      'quota_exhausted',
      'Cloudflare Workers AI daily free allocation is exhausted.',
      errorOptions,
    );
  }
  if (code === '3030') {
    return requestError(
      'unavailable',
      'Cloudflare Workers AI capacity is temporarily unavailable.',
      { ...errorOptions, retryable: true, retryAfterMs },
    );
  }
  if (code === '8007') {
    return requestError(
      'unavailable',
      'Cloudflare Workers AI reported a transient internal error.',
      { ...errorOptions, retryable: true, retryAfterMs },
    );
  }
  if (code === '3040') {
    return requestError(
      'unavailable',
      'Cloudflare Workers AI capacity is temporarily unavailable.',
      { ...errorOptions, retryable: true, retryAfterMs },
    );
  }
  if (code === '5035') {
    return requestError(
      'billing_required',
      'Cloudflare requires a paid billing route for this model; the request was stopped.',
      errorOptions,
    );
  }
  if (code === '5028' || statusCode === 410) {
    return requestError(
      'model_deprecated',
      'Cloudflare reports that this model is deprecated.',
      errorOptions,
    );
  }
  if (code === '3007' || statusCode === 408) {
    return requestError(
      'timeout',
      'Cloudflare Workers AI timed out the request.',
      { ...errorOptions, retryable: true },
    );
  }
  if (code === '3008') {
    return requestError(
      'cancelled',
      'Cloudflare Workers AI aborted the request.',
      errorOptions,
    );
  }
  if (statusCode === 429) {
    return requestError(
      'rate_limited',
      'Cloudflare Workers AI rate limit was reached.',
      { ...errorOptions, retryable: true, retryAfterMs },
    );
  }
  if (statusCode === 401 || statusCode === 403) {
    return requestError(
      'authentication',
      'Cloudflare rejected the credentials or account permissions.',
      errorOptions,
    );
  }
  if ([400, 404, 413, 422].includes(statusCode)) {
    return requestError(
      'invalid_request',
      'Cloudflare Workers AI rejected the request.',
      errorOptions,
    );
  }
  if (statusCode >= 500) {
    return requestError(
      'unavailable',
      'Cloudflare Workers AI is temporarily unavailable.',
      { ...errorOptions, retryable: true, retryAfterMs },
    );
  }
  return requestError(
    'unknown',
    'Cloudflare Workers AI returned an unsuccessful response.',
    errorOptions,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw requestError(
      'malformed_response',
      'Cloudflare returned a non-JSON or malformed response.',
      { statusCode: response.status },
    );
  }
}

export function createCloudflareProviderAdapter(
  options: CloudflareClientOptions = {},
): ProviderAdapter {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const environment = options.environment ?? process.env;

  return {
    providerId: 'cloudflare-workers-ai',
    async complete(request) {
      const modelId: CandidateModelId = request.modelId;
      if (!isCloudflareSupportedModel(modelId)) {
        throw requestError(
          'invalid_request',
          'This Cloudflare model is not enabled in the provider adapter.',
        );
      }
      if (
        modelId === '@cf/nvidia/nemotron-3-120b-a12b' &&
        Date.now() >= NEMOTRON_DEPRECATION_DATE
      ) {
        throw requestError(
          'model_deprecated',
          'Cloudflare scheduled this Nemotron model for deprecation on 2026-11-20.',
          { statusCode: 410, providerCode: '5028' },
        );
      }
      const candidate = MODEL_CANDIDATES[modelId];
      if (
        candidate.documentedCapabilities.strictJsonSchemaParameter !==
          'documented' ||
        candidate.documentedCapabilities.apiParameters.responseFormat !==
          'documented'
      ) {
        throw requestError(
          'invalid_request',
          'JSON Schema request parameters are not documented for this model.',
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
          'The Cloudflare request is incomplete or exceeds configured limits.',
        );
      }

      let requestBody: string;
      try {
        requestBody = JSON.stringify({
          model: request.modelId,
          input: {
            messages: request.messages,
            chat_template_kwargs: { enable_thinking: false },
            response_format: {
              type: 'json_schema',
              json_schema: {
                ...request.responseSchema.schema,
                strict: true,
              },
            },
            temperature: 0.3,
            max_tokens: request.maxOutputTokens,
          },
        });
      } catch {
        throw requestError(
          'invalid_request',
          'The Cloudflare request could not be serialized.',
        );
      }

      const credentials = getProviderCredentials(
        'cloudflare-workers-ai',
        environment,
      );
      if (
        credentials.status !== 'configured' ||
        !('cloudflareAccountId' in credentials) ||
        !('cloudflareApiToken' in credentials)
      ) {
        throw requestError(
          'authentication',
          'Cloudflare Workers AI credentials are not configured.',
        );
      }

      const endpoint = AI_PROVIDERS['cloudflare-workers-ai'].endpoint.replace(
        '{account_id}',
        encodeURIComponent(credentials.cloudflareAccountId),
      );
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
            'The Cloudflare request was cancelled.',
          );
        }
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credentials.cloudflareApiToken}`,
            'content-type': 'application/json',
          },
          body: requestBody,
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          if (response.ok) {
            throw requestError(
              'malformed_response',
              'Cloudflare returned a non-JSON or malformed response.',
              { statusCode: response.status },
            );
          }
        }

        const providerRequestId = getProviderRequestId(
          body,
          response,
          credentials.cloudflareApiToken,
        );
        if (!response.ok) {
          const error = getErrorDetails(body, credentials.cloudflareApiToken);
          throw classifyHttpError(
            response.status,
            error.code,
            providerRequestId,
            getRetryAfterMs(response.headers.get('retry-after')),
          );
        }
        if (isRecord(body) && body.success === false) {
          const error = getErrorDetails(body, credentials.cloudflareApiToken);
          throw classifyHttpError(
            response.status,
            error.code,
            providerRequestId,
            getRetryAfterMs(response.headers.get('retry-after')),
          );
        }

        return parseCompletion(
          body,
          request.modelId,
          providerRequestId,
          credentials.cloudflareApiToken,
        );
      } catch (error) {
        if (error instanceof ProviderRequestError) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw requestError(
            timeoutExpired ? 'timeout' : 'cancelled',
            timeoutExpired
              ? 'The Cloudflare request timed out.'
              : 'The Cloudflare request was cancelled.',
            { retryable: timeoutExpired },
          );
        }
        throw requestError(
          'transport',
          'The Cloudflare request failed before a response was received.',
          { retryable: true },
        );
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
