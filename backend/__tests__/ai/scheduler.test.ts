import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_CANDIDATES,
  type AiProviderId,
  type CandidateModelId,
  type EligibleModelCandidate,
  type ModelCandidate,
} from '../../src/ai/config.js';
import {
  BatchLedger,
  type CreateBatchInput,
} from '../../src/ai/batchLedger.js';
import {
  ProviderRequestError,
  type ProviderAdapter,
  type ProviderCompletion,
  type ProviderRequest,
} from '../../src/ai/contracts.js';
import {
  AssessmentPreparationError,
  BoundedAssessmentScheduler,
  type SchedulerOptions,
  type ScheduledAssessment,
} from '../../src/ai/scheduler.js';
import { MAX_ASSESSMENT_RESPONSE_BYTES } from '../../src/ai/assessmentValidation.js';

let temporaryDirectory: string;
let ledger: BatchLedger;
const originalCandidates = structuredClone(MODEL_CANDIDATES);

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function batchInput(projectId: string): CreateBatchInput {
  return {
    projectId,
    sourceKind: 'uploaded-html',
    contentHash: hash(`${projectId}-content`),
    extractionVersion: 'extractor-v1',
    ruleRegistryVersion: 'rules-v1',
    promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1',
    plannedJobCount: 0,
  };
}

function enableModel(modelId: CandidateModelId): ModelCandidate {
  const candidate = MODEL_CANDIDATES[modelId];
  candidate.verificationStatus = 'verified';
  candidate.accountVerificationStatus = 'verified';
  candidate.runtimeVerificationStatus = 'verified';
  candidate.accountEligibility = 'zero_cost_eligible';
  candidate.eligibility = 'eligible';
  candidate.operatorEnabled = true;
  candidate.structuredOutput = 'strict_json_schema';
  candidate.documentedCapabilities.apiParameters.responseFormat = 'documented';
  candidate.documentedCapabilities.strictJsonSchemaParameter = 'documented';
  candidate.documentedCapabilities.strictJsonSchemaModelSupport = 'documented';
  candidate.maxOutputTokens ??= 4_096;
  candidate.outputLimitEvidence = 'provider_documented';
  candidate.eligibilityReason = 'Enabled by scheduler test fixture.';
  return candidate;
}

function makeAssessment(
  targetId: string,
  note = '',
): ScheduledAssessment {
  return {
    prepare(model: EligibleModelCandidate) {
      const request: ProviderRequest = {
        modelId: model.modelId,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              targetId,
              ruleId: 'color-contrast',
              providerId: model.providerId,
              modelId: model.modelId,
              note,
            }),
          },
        ],
        maxOutputTokens: model.applicationMaxOutputTokens,
        timeoutMs: 5_000,
        responseFormat: 'strict_json_schema',
        responseSchema: {
          name: 'accessibility_assessment',
          schema: { type: 'object' },
        },
      };
      return {
        job: {
          providerId: model.providerId,
          modelId: model.modelId,
          componentId: targetId,
          ruleIds: ['color-contrast'],
          contextHash: hash(`${targetId}-context`),
          evidenceRefIds: ['evidence-1'],
          promptVersion: 'prompt-v1',
          schemaVersion: 'schema-v1',
          modelConfigHash: hash(model.modelId),
        },
        sentEvidenceRefIds: ['evidence-1'],
        estimatedInputTokens: 100,
        request,
      };
    },
  };
}

function createCompletion(request: ProviderRequest): ProviderCompletion {
  const input = JSON.parse(request.messages[0]?.content ?? '{}') as {
    targetId: string;
    ruleId: string;
    providerId: AiProviderId;
    modelId: ProviderRequest['modelId'];
  };
  return {
    status: 'complete',
    providerId: input.providerId,
    modelId: input.modelId,
    providerRequestId: 'mock-request-id',
    finishReason: 'stop',
    usage: {
      inputTokens: 100,
      outputTokens: 80,
      totalTokens: 180,
      source: 'provider',
    },
    text: JSON.stringify({
      targetId: input.targetId,
      ruleId: input.ruleId,
      status: 'potential_issue',
      explanation: 'A mock accessibility observation.',
      evidenceRefs: ['evidence-1'],
      confidence: 0.8,
      providerId: input.providerId,
      modelId: input.modelId,
    }),
  };
}

function adapter(
  providerId: AiProviderId,
  complete: (request: ProviderRequest) => Promise<ProviderCompletion> | ProviderCompletion =
    createCompletion,
): ProviderAdapter {
  return {
    providerId,
    complete: vi.fn(complete),
  };
}

function scheduler(
  adapters: Partial<Record<AiProviderId, ProviderAdapter>>,
  extra: Partial<SchedulerOptions> = {},
): BoundedAssessmentScheduler {
  return new BoundedAssessmentScheduler({
    ledger,
    adapters,
    ...extra,
  });
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'rac-ai-scheduler-'));
  ledger = new BatchLedger({ filePath: join(temporaryDirectory, 'ledger.sqlite') });
});

afterEach(() => {
  ledger.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const modelId of Object.keys(originalCandidates) as CandidateModelId[]) {
    Object.assign(MODEL_CANDIDATES[modelId], structuredClone(originalCandidates[modelId]));
  }
});

describe('bounded AI assessment scheduler', () => {
  it('keeps all currently blocked models fail-closed and makes no provider calls', async () => {
    const groq = adapter('groq');
    const cloudflare = adapter('cloudflare-workers-ai');
    const prepare = vi.fn(() => {
      throw new Error('Blocked models must not be prepared.');
    });

    const result = await scheduler({
      groq,
      'cloudflare-workers-ai': cloudflare,
    }).run([
      {
        batch: batchInput('blocked-project'),
        assessments: [{ prepare }],
      },
    ]);

    expect(result.blockedModels).toHaveLength(6);
    expect(result.jobs).toHaveLength(0);
    expect(result.batches[0]?.plannedJobCount).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(groq.complete).not.toHaveBeenCalled();
    expect(cloudflare.complete).not.toHaveBeenCalled();
  });

  it('bounds total/provider/model concurrency and fairly interleaves batches', async () => {
    const modelIds: CandidateModelId[] = [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/nvidia/nemotron-3-120b-a12b',
      '@cf/google/gemma-4-26b-a4b-it',
    ];
    modelIds.forEach(enableModel);
    let activeTotal = 0;
    let maximumTotal = 0;
    const activeProviders = new Map<AiProviderId, number>();
    const maximumProviders = new Map<AiProviderId, number>();
    const activeModels = new Map<string, number>();
    const maximumModels = new Map<string, number>();
    const firstStarted: string[] = [];
    const trackedCompletion = async (
      providerId: AiProviderId,
      request: ProviderRequest,
    ) => {
      activeTotal += 1;
      maximumTotal = Math.max(maximumTotal, activeTotal);
      const providerActive = (activeProviders.get(providerId) ?? 0) + 1;
      activeProviders.set(providerId, providerActive);
      maximumProviders.set(
        providerId,
        Math.max(maximumProviders.get(providerId) ?? 0, providerActive),
      );
      const modelActive = (activeModels.get(request.modelId) ?? 0) + 1;
      activeModels.set(request.modelId, modelActive);
      maximumModels.set(
        request.modelId,
        Math.max(maximumModels.get(request.modelId) ?? 0, modelActive),
      );
      const payload = JSON.parse(request.messages[0]?.content ?? '{}') as {
        targetId: string;
      };
      firstStarted.push(payload.targetId.split('-')[0] ?? '');
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeTotal -= 1;
      activeProviders.set(providerId, providerActive - 1);
      activeModels.set(request.modelId, modelActive - 1);
      return createCompletion(request);
    };
    const groq = adapter('groq', (request) => trackedCompletion('groq', request));
    const cloudflare = adapter(
      'cloudflare-workers-ai',
      (request) => trackedCompletion('cloudflare-workers-ai', request),
    );
    const result = await scheduler(
      { groq, 'cloudflare-workers-ai': cloudflare },
      { limits: { maxConcurrentPerModel: 1 } },
    ).run(
      Array.from({ length: 6 }, (_, index) => {
        const batchNumber = index + 1;
        return {
          batch: batchInput(`batch-${batchNumber}`),
          assessments: [makeAssessment(`project${batchNumber}-component`)],
        };
      }),
    );

    expect(maximumTotal).toBe(6);
    expect(maximumProviders.get('groq')).toBe(3);
    expect(maximumProviders.get('cloudflare-workers-ai')).toBe(3);
    expect(Math.max(...maximumModels.values())).toBe(1);
    expect(new Set(firstStarted.slice(0, 2))).toEqual(
      new Set(['project1', 'project2']),
    );
    expect(result.jobs).toHaveLength(36);
    expect(result.jobs.every((job) => job.status === 'succeeded')).toBe(true);
    expect(result.jobs.every((job) => job.result !== null)).toBe(true);
  });

  it('reuses successful idempotent jobs without making a duplicate provider call', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const groq = adapter('groq');
    const scheduled = scheduler({ groq });
    const input = {
      batch: batchInput('deduplicated-project'),
      assessments: [makeAssessment('component-one')],
    };

    const first = await scheduled.run([input]);
    const second = await scheduled.run([input]);

    expect(groq.complete).toHaveBeenCalledTimes(1);
    expect(first.jobs[0]?.status).toBe('succeeded');
    expect(second.jobs[0]?.status).toBe('succeeded');
    expect(second.jobs[0]?.result).toMatchObject({
      targetId: 'component-one',
      providerId: 'groq',
    });
  });

  it('creates a new idempotent job when the prepared request payload changes', async () => {
    enableModel('openai/gpt-oss-20b');
    const groq = adapter('groq');
    const scheduled = scheduler({ groq });
    const batch = batchInput('changed-request-project');

    const first = await scheduled.run([
      { batch, assessments: [makeAssessment('same-component', 'first prompt')] },
    ]);
    const second = await scheduled.run([
      { batch, assessments: [makeAssessment('same-component', 'changed prompt')] },
    ]);

    expect(first.jobs[0]?.jobId).not.toBe(second.jobs[0]?.jobId);
    expect(groq.complete).toHaveBeenCalledTimes(2);
  });

  it('paces requests at the verified per-model RPM limit', async () => {
    const modelId = 'openai/gpt-oss-20b';
    const candidate = enableModel(modelId);
    candidate.accountLimits = {
      ...candidate.accountLimits,
      requestsPerMinute: 1,
    };
    let clock = Date.now();
    const requestTimes: number[] = [];
    const groq = adapter('groq', (request) => {
      requestTimes.push(clock);
      const completion = createCompletion(request);
      return {
        ...completion,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          source: 'unknown',
        },
      };
    });
    await scheduler(
      { groq },
      {
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      },
    ).run([
      {
        batch: batchInput('paced-project'),
        assessments: [makeAssessment('component-one')],
      },
    ]);
    const secondLedger = new BatchLedger({ filePath: ledger.filePath });
    try {
      const secondAdapter = adapter('groq', (request) => {
        requestTimes.push(clock);
        return createCompletion(request);
      });
      await new BoundedAssessmentScheduler({
        ledger: secondLedger,
        adapters: { groq: secondAdapter },
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      }).run([
        {
          batch: batchInput('paced-project-second'),
          assessments: [makeAssessment('component-two')],
        },
      ]);
    } finally {
      secondLedger.close();
    }

    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('reserves estimated tokens against the verified TPM limit', async () => {
    const modelId = 'openai/gpt-oss-20b';
    const candidate = enableModel(modelId);
    candidate.accountLimits = {
      ...candidate.accountLimits,
      requestsPerMinute: 30,
      tokensPerMinute: 3_000,
    };
    let clock = Date.now();
    const requestTimes: number[] = [];
    const groq = adapter('groq', (request) => {
      requestTimes.push(clock);
      const completion = createCompletion(request);
      return {
        ...completion,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          source: 'unknown',
        },
      };
    });
    const result = await scheduler(
      { groq },
      {
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      },
    ).run([
      {
        batch: batchInput('token-paced-project'),
        assessments: [
          makeAssessment('component-one'),
          makeAssessment('component-two'),
        ],
      },
    ]);

    expect(result.jobs).toHaveLength(2);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('reserves the shared Cloudflare daily Neuron budget before concurrent dispatch', async () => {
    const firstModel = '@cf/zai-org/glm-4.7-flash';
    const secondModel = '@cf/google/gemma-4-26b-a4b-it';
    for (const modelId of [firstModel, secondModel] as const) {
      const candidate = enableModel(modelId);
      candidate.publishedPricing.outputNeuronsPerMillionTokens = 4_000_000;
    }
    let clock = Date.UTC(2026, 0, 1, 23, 59, 0);
    const requestTimes: number[] = [];
    const cloudflare = adapter('cloudflare-workers-ai', (request) => {
      requestTimes.push(clock);
      const completion = createCompletion(request);
      return {
        ...completion,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          source: 'unknown',
        },
      };
    });
    const result = await scheduler(
      { 'cloudflare-workers-ai': cloudflare },
      {
        limits: { maxConcurrentPerProvider: 2, maxConcurrentPerModel: 1 },
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      },
    ).run([
      {
        batch: batchInput('neuron-budget-project'),
        assessments: [makeAssessment('cloudflare-component')],
      },
    ]);

    expect(result.jobs).toHaveLength(2);
    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1]).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 2));
  });

  it('records a bounded transient retry and respects Retry-After', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const retryDelay = vi.fn(async () => undefined);
    let calls = 0;
    const groq = adapter('groq', (request) => {
      calls += 1;
      if (calls === 1) {
        throw new ProviderRequestError('rate limited', {
          providerId: 'groq',
          kind: 'rate_limited',
          retryable: true,
          statusCode: 429,
          providerCode: null,
          retryAfterMs: 0,
          providerRequestId: null,
        });
      }
      return createCompletion(request);
    });
    const result = await scheduler(
      { groq },
      { sleep: retryDelay },
    ).run([
      {
        batch: batchInput('retry-project'),
        assessments: [makeAssessment('retry-component')],
      },
    ]);
    const job = result.jobs[0];

    expect(job?.status).toBe('succeeded');
    expect(calls).toBe(2);
    expect(retryDelay).toHaveBeenCalledWith(0, undefined);
    expect(ledger.getAttempts(job!.jobId)).toHaveLength(2);
    expect(ledger.getAttempts(job!.jobId).map((attempt) => attempt.status)).toEqual([
      'retryable_failed',
      'succeeded',
    ]);
    expect(ledger.getAttempts(job!.jobId)[0]).toMatchObject({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 2_048,
    });
  });

  it('does not retry or blindly resend an uncertain provider outcome', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const groq = adapter('groq', () => {
      throw new ProviderRequestError('timeout', {
        providerId: 'groq',
        kind: 'timeout',
        retryable: true,
        statusCode: null,
        providerCode: null,
        retryAfterMs: null,
        providerRequestId: null,
      });
    });
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('uncertain-project'),
        assessments: [makeAssessment('uncertain-component')],
      },
    ]);
    const job = result.jobs[0];

    expect(job?.status).toBe('unknown_outcome');
    expect(groq.complete).toHaveBeenCalledTimes(1);
    expect(ledger.getAttempts(job!.jobId)).toHaveLength(1);
    expect(ledger.getAttempts(job!.jobId)[0]?.status).toBe('unknown_outcome');
  });

  it('aborts provider work at the configured request timeout and records uncertainty', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const base = makeAssessment('timeout-component');
    const assessment: ScheduledAssessment = {
      prepare(model) {
        const prepared = base.prepare(model);
        return {
          ...prepared,
          request: { ...prepared.request, timeoutMs: 1 },
        };
      },
    };
    let sawAbort = false;
    const groq = adapter(
      'groq',
      (request) =>
        new Promise<ProviderCompletion>((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true;
              reject(
                new ProviderRequestError('timeout', {
                  providerId: 'groq',
                  kind: 'timeout',
                  retryable: true,
                  statusCode: null,
                  providerCode: null,
                  retryAfterMs: null,
                  providerRequestId: null,
                }),
              );
            },
            { once: true },
          );
        }),
    );
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('request-timeout-project'),
        assessments: [assessment],
      },
    ]);

    expect(sawAbort).toBe(true);
    expect(result.jobs[0]?.status).toBe('unknown_outcome');
  });

  it('keeps cancelled queued work undispatched', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const groq = adapter('groq');
    const controller = new AbortController();
    controller.abort(new Error('test cancellation'));
    const result = await scheduler({ groq }).run(
      [
        {
          batch: batchInput('cancelled-project'),
          assessments: [makeAssessment('cancelled-component')],
        },
      ],
      controller.signal,
    );

    expect(groq.complete).not.toHaveBeenCalled();
    expect(result.jobs[0]).toMatchObject({
      status: 'queued',
      detail: 'cancelled_before_dispatch',
    });
    expect(ledger.getAttempts(result.jobs[0]!.jobId)).toHaveLength(0);
  });

  it('records schema/evidence validation failures instead of persisting success', async () => {
    const modelId = 'openai/gpt-oss-20b';
    enableModel(modelId);
    const groq = adapter('groq', (request) => {
      const completion = createCompletion(request);
      const invalid = JSON.parse(completion.text) as Record<string, unknown>;
      invalid.evidenceRefs = ['unpermitted-evidence'];
      return { ...completion, text: JSON.stringify(invalid) };
    });
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('validation-project'),
        assessments: [makeAssessment('validation-component')],
      },
    ]);
    const job = result.jobs[0];

    expect(job?.status).toBe('invalid_response');
    expect(job?.result).toBeNull();
    expect(job?.errorClass).toBe('semantic_invalid');
    expect(ledger.getAssessmentResult(job!.jobId)).toBeUndefined();
  });

  it.each([
    ['malformed_json', 'not-json'],
    ['output_too_large', ' '.repeat(MAX_ASSESSMENT_RESPONSE_BYTES + 1)],
  ])('persists %s as a distinct invalid-response outcome', async (failure, text) => {
    enableModel('openai/gpt-oss-20b');
    const groq = adapter('groq', (request) => ({
      ...createCompletion(request),
      text,
    }));
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput(`validation-${failure}`),
        assessments: [makeAssessment(`target-${failure}`)],
      },
    ]);

    expect(result.jobs[0]).toMatchObject({
      status: 'invalid_response',
      errorClass: failure,
    });
    expect(ledger.getAssessmentResult(result.jobs[0]!.jobId)).toBeUndefined();
  });

  it('classifies incomplete and unsupported finish reasons without parsing them as success', async () => {
    enableModel('openai/gpt-oss-20b');
    const groq = adapter('groq', (request) => ({
      ...createCompletion(request),
      status: 'incomplete',
      reason: 'unsupported',
      finishReason: 'future_finish_state',
    }));
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('unsupported-finish-project'),
        assessments: [makeAssessment('unsupported-target')],
      },
    ]);

    expect(result.jobs[0]).toMatchObject({
      status: 'invalid_response',
      errorClass: 'unsupported_finish_reason',
    });
  });

  it('keeps malformed provider envelopes distinct from invalid assessment JSON', async () => {
    enableModel('openai/gpt-oss-20b');
    const groq = adapter('groq', () => {
      throw new ProviderRequestError('malformed provider response', {
        providerId: 'groq',
        kind: 'malformed_response',
        retryable: false,
        statusCode: 200,
        providerCode: null,
        retryAfterMs: null,
        providerRequestId: null,
      });
    });
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('malformed-envelope-project'),
        assessments: [makeAssessment('malformed-envelope-target')],
      },
    ]);

    expect(result.jobs[0]).toMatchObject({
      status: 'invalid_response',
      errorClass: 'malformed_response',
      detail: 'malformed_provider_response',
    });
  });

  it('rejects prepared evidence references that differ from the dispatched context', async () => {
    enableModel('openai/gpt-oss-20b');
    const base = makeAssessment('evidence-mismatch-target');
    const assessment: ScheduledAssessment = {
      prepare(model) {
        return {
          ...base.prepare(model),
          sentEvidenceRefIds: [],
        };
      },
    };
    const groq = adapter('groq');
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('evidence-mismatch-project'),
        assessments: [assessment],
      },
    ]);

    expect(result.preflightIssues[0]?.detail).toContain('exactly match');
    expect(result.batches[0]?.plannedJobCount).toBe(0);
    expect(groq.complete).not.toHaveBeenCalled();
  });

  it('rejects over-context requests before creating jobs or calling providers', async () => {
    const modelId = 'openai/gpt-oss-20b';
    const candidate = enableModel(modelId);
    const prepare = makeAssessment('too-large').prepare;
    const groq = adapter('groq');
    const oversized: ScheduledAssessment = {
      prepare(model) {
        const prepared = prepare(model);
        return {
          ...prepared,
          estimatedInputTokens: candidate.contextTokens,
        };
      },
    };
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('oversized-project'),
        assessments: [oversized],
      },
    ]);

    expect(result.preflightIssues[0]?.detail).toContain('context/input limit');
    expect(result.batches[0]?.plannedJobCount).toBe(0);
    expect(result.jobs).toHaveLength(0);
    expect(groq.complete).not.toHaveBeenCalled();
  });

  it('isolates a model-specific preparation failure from other eligible models', async () => {
    enableModel('openai/gpt-oss-20b');
    enableModel('openai/gpt-oss-120b');
    const groq = adapter('groq');
    const base = makeAssessment('preparation-component');
    const assessment: ScheduledAssessment = {
      prepare(model) {
        if (model.modelId === 'openai/gpt-oss-120b') {
          throw new AssessmentPreparationError();
        }
        return base.prepare(model);
      },
    };
    const result = await scheduler({ groq }).run([
      {
        batch: batchInput('preparation-project'),
        assessments: [assessment],
      },
    ]);

    expect(result.preflightIssues).toHaveLength(1);
    expect(result.preflightIssues[0]?.detail).toContain('could not be prepared');
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.status).toBe('succeeded');
    expect(groq.complete).toHaveBeenCalledTimes(1);
  });

  it('isolates a provider quota failure and continues eligible work on the other provider', async () => {
    const groqModel = 'openai/gpt-oss-20b';
    const otherGroqModel = 'openai/gpt-oss-120b';
    const cloudflareModel = '@cf/zai-org/glm-4.7-flash';
    enableModel(groqModel);
    enableModel(otherGroqModel);
    enableModel(cloudflareModel);
    const groq = adapter('groq', () => {
      throw new ProviderRequestError('quota exhausted', {
        providerId: 'groq',
        kind: 'quota_exhausted',
        retryable: false,
        statusCode: 429,
        providerCode: 'quota_exhausted',
        retryAfterMs: null,
        providerRequestId: null,
      });
    });
    const cloudflare = adapter('cloudflare-workers-ai');
    const result = await scheduler(
      {
        groq,
        'cloudflare-workers-ai': cloudflare,
      },
      { limits: { maxConcurrentPerProvider: 1 } },
    ).run([
      {
        batch: batchInput('isolation-project'),
        assessments: [makeAssessment('isolation-component')],
      },
    ]);

    expect(result.jobs.find((job) => job.modelId === groqModel || job.modelId === otherGroqModel)?.status).toBe('blocked');
    expect(result.jobs.find((job) => job.modelId === groqModel || job.modelId === otherGroqModel)?.detail).toBe('provider_quota_exhausted');
    expect(result.jobs.filter((job) => job.providerId === 'groq').some((job) =>
      job.status === 'queued' && job.detail === 'provider_paused',
    )).toBe(true);
    expect(result.jobs.find((job) => job.modelId === cloudflareModel)?.status).toBe('succeeded');
    expect(groq.complete).toHaveBeenCalledTimes(1);
    expect(cloudflare.complete).toHaveBeenCalledTimes(1);
  });
});
