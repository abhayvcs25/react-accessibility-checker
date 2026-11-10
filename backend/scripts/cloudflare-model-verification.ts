import '../src/env.js';
import {
  AI_PROVIDERS,
  getProviderCredentials,
  type CandidateModelId,
} from '../src/ai/config.js';

const MODEL_IDS = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/google/gemma-4-26b-a4b-it',
] as const satisfies readonly CandidateModelId[];
const MIN_REQUEST_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_STRUCTURED_OUTPUT_TOKENS = 512;
const MAX_GREETING_OUTPUT_TOKENS = 64;
const MAX_ATTEMPTS = 3;

export type CloudflareProbeModelId = (typeof MODEL_IDS)[number];

export type CloudflareProbePhase = 'greeting' | 'strict-json';

export interface CloudflareProbeResult {
  modelId: CandidateModelId;
  ok: boolean;
  attempts: number;
  httpStatus: number | null;
  requestId: string | null;
  attemptHistory: Array<{
    attempt: number;
    httpStatus: number | null;
    requestId: string | null;
    errorCode?: string;
    finishReason?: string | null;
    usage?: {
      inputTokens: number | null;
      outputTokens: number | null;
    };
  }>;
  errorCode?: string;
  finishReason?: string | null;
  output?: string | Record<string, unknown>;
  validation?: 'passed' | 'failed';
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

interface CloudflareProbeOptions {
  accountPreflight: {
    workersFreeConfirmed: boolean;
    noPaidPathConfirmed: boolean;
    remainingNeurons: number;
    connectivityConfirmed?: boolean;
  };
  environment?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  models?: readonly CloudflareProbeModelId[];
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRequestId(value: unknown, secret: string): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes(secret) &&
    /^[a-zA-Z0-9._:-]+$/.test(value)
    ? value
    : null;
}

function safeErrorCode(value: unknown, secret: string): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const code = String(value);
  return !code.includes(secret) && /^[a-zA-Z0-9_.-]{1,80}$/.test(code)
    ? code
    : undefined;
}

function errorCode(body: unknown, secret: string): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (isRecord(body.error)) {
    return safeErrorCode(body.error.code, secret) ??
      safeErrorCode(body.error.type, secret);
  }
  if (Array.isArray(body.errors) && isRecord(body.errors[0])) {
    return safeErrorCode(body.errors[0].code, secret);
  }
  return undefined;
}

function requestId(
  body: unknown,
  response: Response,
  secret: string,
): string | null {
  const resultId = isRecord(body) && isRecord(body.result)
    ? safeRequestId(body.result.id, secret)
    : null;
  const bodyId = isRecord(body) ? safeRequestId(body.id, secret) : null;
  return bodyId ??
    resultId ??
    safeRequestId(response.headers.get('cf-ray'), secret) ??
    safeRequestId(response.headers.get('x-request-id'), secret) ??
    safeRequestId(response.headers.get('request-id'), secret);
}

function createRequestBody(
  modelId: CandidateModelId,
  phase: CloudflareProbePhase,
): Record<string, unknown> {
  const messages = phase === 'greeting'
    ? [
        {
          role: 'system',
          content: 'Reply with a short, friendly greeting. Do not include code.',
        },
        { role: 'user', content: 'Please say hello.' },
      ]
    : [
        {
          role: 'system',
          content: 'Return only a friendly greeting matching the supplied JSON Schema.',
        },
        { role: 'user', content: 'Give a short greeting.' },
      ];
  const input: Record<string, unknown> = {
    messages,
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.3,
    max_tokens:
      phase === 'greeting'
        ? MAX_GREETING_OUTPUT_TOKENS
        : MAX_STRUCTURED_OUTPUT_TOKENS,
  };
  if (phase === 'strict-json') {
    input.response_format = {
      type: 'json_schema',
      json_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          greeting: { type: 'string' },
        },
        required: ['greeting'],
        strict: true,
      },
    };
  }
  return { model: modelId, input };
}

function parseUsage(body: unknown): CloudflareProbeResult['usage'] | undefined {
  const usage = isRecord(body) && isRecord(body.result) &&
      isRecord(body.result.usage)
    ? body.result.usage
    : isRecord(body) && isRecord(body.usage)
      ? body.usage
      : undefined;
  if (!usage) {
    return undefined;
  }
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  return {
    inputTokens:
      typeof inputTokens === 'number' && Number.isSafeInteger(inputTokens)
        ? inputTokens
        : null,
    outputTokens:
      typeof outputTokens === 'number' && Number.isSafeInteger(outputTokens)
        ? outputTokens
        : null,
  };
}

function parseOutput(
  body: unknown,
  phase: CloudflareProbePhase,
): {
  output: string | Record<string, unknown>;
  finishReason: string | null;
  schemaValid: boolean;
} | null {
  const result = isRecord(body) && isRecord(body.result)
    ? body.result
    : undefined;
  if (
    !result ||
    !Array.isArray(result.choices) ||
    !isRecord(result.choices[0]) ||
    !isRecord(result.choices[0].message) ||
    typeof result.choices[0].message.content !== 'string'
  ) {
    return null;
  }
  const content = result.choices[0].message.content;
  const finishReason =
    typeof result.choices[0].finish_reason === 'string'
      ? result.choices[0].finish_reason
      : null;
  if (phase === 'greeting') {
    return {
      output: content.slice(0, 2_000),
      finishReason,
      schemaValid: true,
    };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      isRecord(parsed) &&
      Object.keys(parsed).length === 1 &&
      typeof parsed.greeting === 'string'
    ) {
      return {
        output: { greeting: parsed.greeting },
        finishReason,
        schemaValid: true,
      };
    }
  } catch {
    return {
      output: content.slice(0, 2_000),
      finishReason,
      schemaValid: false,
    };
  }
  return {
    output: content.slice(0, 2_000),
    finishReason,
    schemaValid: false,
  };
}

function responseRequestId(
  body: unknown,
  response: Response,
  secret: string,
): string | null {
  return requestId(body, response, secret);
}

export async function runCloudflareModelVerification(
  phase: CloudflareProbePhase,
  options: CloudflareProbeOptions = {},
): Promise<CloudflareProbeResult[]> {
  if (
    !options.accountPreflight.workersFreeConfirmed ||
    !options.accountPreflight.noPaidPathConfirmed ||
    !Number.isSafeInteger(options.accountPreflight.remainingNeurons) ||
    options.accountPreflight.remainingNeurons <= 0
  ) {
    throw new Error(
      'A current Workers Free, no-paid-path, positive-Neuron preflight is required.',
    );
  }
  if (
    phase === 'strict-json' &&
    !options.accountPreflight.connectivityConfirmed
  ) {
    throw new Error(
      'The strict-json phase requires confirmation that all greeting probes returned HTTP 200.',
    );
  }
  const environment = options.environment ?? process.env;
  const credentials = getProviderCredentials(
    'cloudflare-workers-ai',
    environment,
  );
  if (
    credentials.status !== 'configured' ||
    !('cloudflareAccountId' in credentials) ||
    !('cloudflareApiToken' in credentials)
  ) {
    throw new Error(
      credentials.status === 'missing_credentials'
        ? `Cloudflare credentials are missing: ${credentials.missing.join(', ')}.`
        : 'Configured credentials are not for Cloudflare Workers AI.',
    );
  }

  const endpoint = AI_PROVIDERS['cloudflare-workers-ai'].endpoint.replace(
    '{account_id}',
    encodeURIComponent(credentials.cloudflareAccountId),
  );
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const results: CloudflareProbeResult[] = [];
  const models = options.models ?? MODEL_IDS;
  let previousRequestStartedAt: number | undefined;

  for (const modelId of models) {
    if (
      modelId === '@cf/nvidia/nemotron-3-120b-a12b' &&
      now() >= Date.UTC(2026, 10, 20)
    ) {
      results.push({
        modelId,
        ok: false,
        attempts: 0,
        httpStatus: null,
        requestId: null,
        attemptHistory: [],
        errorCode: 'model_deprecated',
      });
      continue;
    }
    const attemptHistory: CloudflareProbeResult['attemptHistory'] = [];
    let modelResult: CloudflareProbeResult | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (previousRequestStartedAt !== undefined) {
        const delay =
          previousRequestStartedAt + MIN_REQUEST_INTERVAL_MS - now();
        if (delay > 0) {
          await sleep(delay);
        }
      }
      previousRequestStartedAt = now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credentials.cloudflareApiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(createRequestBody(modelId, phase)),
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timeout);
        modelResult = {
          modelId,
          ok: false,
          attempts: attempt,
          httpStatus: null,
          requestId: null,
          attemptHistory: [
            ...attemptHistory,
            {
              attempt,
              httpStatus: null,
              requestId: null,
              errorCode: controller.signal.aborted ? 'timeout' : 'transport_error',
            },
          ],
          errorCode: controller.signal.aborted ? 'timeout' : 'transport_error',
        };
        break;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        clearTimeout(timeout);
        const id = responseRequestId(
          null,
          response,
          credentials.cloudflareApiToken,
        );
        modelResult = {
          modelId,
          ok: false,
          attempts: attempt,
          httpStatus: response.status,
          requestId: id,
          attemptHistory: [
            ...attemptHistory,
            {
              attempt,
              httpStatus: response.status,
              requestId: id,
              errorCode: controller.signal.aborted
                ? 'timeout'
                : 'malformed_response',
            },
          ],
          errorCode: controller.signal.aborted ? 'timeout' : 'malformed_response',
        };
        break;
      }
      clearTimeout(timeout);

      const id = responseRequestId(body, response, credentials.cloudflareApiToken);
      const usage = parseUsage(body);
      if (!response.ok || (isRecord(body) && body.success === false)) {
        const code = errorCode(body, credentials.cloudflareApiToken);
        const resultCode = code ?? 'provider_error';
        attemptHistory.push({
          attempt,
          httpStatus: response.status,
          requestId: id,
          errorCode: resultCode,
          ...(usage ? { usage } : {}),
        });
        modelResult = {
          modelId,
          ok: false,
          attempts: attempt,
          httpStatus: response.status,
          requestId: id,
          attemptHistory: [...attemptHistory],
          errorCode: resultCode,
          ...(usage ? { usage } : {}),
        };
        if (code === '3036' || code === '5035') {
          results.push(modelResult);
          return results;
        }
        const retryable =
          response.status === 429 ||
          response.status >= 500 ||
          code === '3030' ||
          code === '8007';
        if (!retryable || attempt === MAX_ATTEMPTS) {
          break;
        }
        continue;
      }

      const parsed = parseOutput(body, phase);
      const complete =
        parsed !== null &&
        parsed.finishReason === 'stop' &&
        (phase !== 'strict-json' || parsed.schemaValid);
      attemptHistory.push({
        attempt,
        httpStatus: response.status,
        requestId: id,
        ...(parsed ? { finishReason: parsed.finishReason } : {}),
        ...(usage ? { usage } : {}),
        ...(!complete
          ? {
              errorCode: parsed
                ? 'incomplete_completion'
                : 'invalid_completion',
            }
          : {}),
      });
      modelResult = {
        modelId,
        ok: complete,
        attempts: attempt,
        httpStatus: response.status,
        requestId: id,
        attemptHistory: [...attemptHistory],
        ...(parsed ? { output: parsed.output } : {}),
        ...(parsed ? { finishReason: parsed.finishReason } : {}),
        ...(!complete
          ? {
              errorCode: parsed
                ? 'incomplete_completion'
                : 'invalid_completion',
              ...(phase === 'strict-json'
                ? { validation: 'failed' as const }
                : {}),
            }
          : {
              ...(phase === 'strict-json'
                ? { validation: 'passed' as const }
                : {}),
            }),
        ...(usage ? { usage } : {}),
      };
      break;
    }
    if (modelResult) {
      results.push(modelResult);
    }
  }

  return results;
}

function parseCliArguments(args: readonly string[]): {
  phase: CloudflareProbePhase;
  remainingNeurons: number;
} {
  const [phaseArgument, ...flags] = args;
  if (phaseArgument !== 'greeting' && phaseArgument !== 'strict-json') {
    throw new Error('Choose a phase: greeting or strict-json.');
  }
  if (
    !flags.includes('--confirm-zero-paid-path') ||
    !flags.includes('--confirm-workers-free')
  ) {
    throw new Error(
      'Confirm in the current Cloudflare dashboard that the account is Workers Free and no paid path is enabled.',
    );
  }
  if (
    phaseArgument === 'strict-json' &&
    !flags.includes('--confirm-http-200-connectivity')
  ) {
    throw new Error(
      'The strict-json phase requires confirmation that all greeting probes returned HTTP 200.',
    );
  }
  const remainingFlag = flags.find((flag) =>
    flag.startsWith('--remaining-neurons='),
  );
  const remainingNeurons = Number(remainingFlag?.split('=')[1]);
  if (!Number.isSafeInteger(remainingNeurons) || remainingNeurons <= 0) {
    throw new Error(
      'Provide the current positive remaining Neuron balance as --remaining-neurons=<count>.',
    );
  }
  return { phase: phaseArgument, remainingNeurons };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { phase, remainingNeurons } = parseCliArguments(args);
  const models = parseModelArgument(args);
  const results = await runCloudflareModelVerification(phase, {
    accountPreflight: {
      workersFreeConfirmed: true,
      noPaidPathConfirmed: true,
      remainingNeurons,
      connectivityConfirmed:
        phase === 'strict-json' &&
        process.argv.includes('--confirm-http-200-connectivity'),
    },
    models,
  });
  console.log(JSON.stringify({
    phase,
    confirmedRemainingNeurons: remainingNeurons,
    minimumStartIntervalMs: MIN_REQUEST_INTERVAL_MS,
    requestedModels: models,
    maxOutputTokens:
      phase === 'greeting'
        ? MAX_GREETING_OUTPUT_TOKENS
        : MAX_STRUCTURED_OUTPUT_TOKENS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxAttempts: MAX_ATTEMPTS,
    results,
  }, null, 2));
  if (
    results.length !== models.length ||
    results.some((result) => !result.ok)
  ) {
    process.exitCode = 1;
  }
}

function parseModelArgument(args: readonly string[]): CloudflareProbeModelId[] {
  const modelFlag = args.find((argument) => argument.startsWith('--model='));
  if (!modelFlag) {
    return [...MODEL_IDS];
  }
  const modelId = modelFlag.slice('--model='.length);
  const selectedModel = MODEL_IDS.find((candidate) => candidate === modelId);
  if (!selectedModel) {
    throw new Error('The selected model is not one of the supported Cloudflare candidates.');
  }
  return [selectedModel];
}

if (process.argv[1]?.endsWith('cloudflare-model-verification.ts')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Verification failed.';
    console.error(message);
    process.exitCode = 1;
  });
}
