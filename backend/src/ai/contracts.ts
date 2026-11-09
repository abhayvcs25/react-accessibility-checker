import type {
  AiProviderId,
  EligibleModelId,
} from './config.js';

export type ProviderMessageRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
}

interface ProviderRequestBase {
  modelId: EligibleModelId;
  messages: readonly ProviderMessage[];
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type ProviderRequest = ProviderRequestBase &
  (
    | {
        responseFormat: 'strict_json_schema';
        responseSchema: {
          name: string;
          description?: string;
          schema: Record<string, unknown>;
        };
      }
    | {
        responseFormat: 'json' | 'text';
        responseSchema?: never;
      }
  );

export interface ProviderTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  source: 'provider' | 'unknown';
}

interface ProviderCompletionBase {
  providerId: AiProviderId;
  modelId: EligibleModelId;
  providerRequestId: string | null;
  finishReason: string | null;
  usage: ProviderTokenUsage;
}

export type ProviderCompletion =
  | (ProviderCompletionBase & {
      status: 'complete';
      text: string;
    })
  | (ProviderCompletionBase & {
      status: 'incomplete';
      text: string;
      reason:
        | 'length'
        | 'content_filter'
        | 'tool_call'
        | 'provider_incomplete'
        | 'unknown';
    });

export type ProviderErrorKind =
  | 'timeout'
  | 'cancelled'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'billing_required'
  | 'model_deprecated'
  | 'unavailable'
  | 'authentication'
  | 'invalid_request'
  | 'transport'
  | 'unknown';

export interface ProviderErrorMetadata {
  providerId: AiProviderId;
  kind: ProviderErrorKind;
  retryable: boolean;
  statusCode: number | null;
  providerCode: string | null;
  retryAfterMs: number | null;
  providerRequestId: string | null;
}

export class ProviderRequestError extends Error {
  readonly metadata: ProviderErrorMetadata;

  constructor(message: string, metadata: ProviderErrorMetadata) {
    super(message);
    this.name = 'ProviderRequestError';
    this.metadata = metadata;
  }
}

export interface ProviderAdapter {
  readonly providerId: AiProviderId;
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
}
