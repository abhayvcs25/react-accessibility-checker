import { createHash } from 'node:crypto';
import {
  AI_PROVIDERS,
  getEligibleModels,
  MODEL_CANDIDATES,
  type AiProviderId,
  type CandidateModelId,
  type EligibleModelCandidate,
  type ModelEligibility,
  type ModelCandidate,
} from './config.js';
import {
  BatchLedger,
  type BatchRecord,
  type CreateBatchInput,
  type CreateJobInput,
  type JobRecord,
  type JsonValue,
} from './batchLedger.js';
import {
  AssessmentValidationError,
  parseAssessmentResponse,
} from './assessmentValidation.js';
import {
  ProviderRequestError,
  type ProviderAdapter,
  type ProviderCompletion,
  type ProviderErrorKind,
  type ProviderRequest,
} from './contracts.js';

const DEFAULT_MAX_CONCURRENT_TOTAL = 6;
const DEFAULT_MAX_CONCURRENT_PER_PROVIDER = 3;
const DEFAULT_MAX_CONCURRENT_PER_MODEL = 1;
const DEFAULT_MAX_QUEUE_SIZE = 300;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 30_000;
const MAX_PROVIDER_TIMEOUT_MS = 120_000;

export interface PreparedAssessment {
  job: Omit<CreateJobInput, 'batchId' | 'requestPayloadHash'>;
  sentEvidenceRefIds: readonly string[];
  estimatedInputTokens: number;
  request: ProviderRequest;
}

export interface ScheduledAssessment {
  prepare(model: EligibleModelCandidate): PreparedAssessment;
}

export interface SchedulerBatchInput {
  batch: CreateBatchInput;
  assessments: readonly ScheduledAssessment[];
}

export interface SchedulerOptions {
  ledger: BatchLedger;
  adapters: Partial<Record<AiProviderId, ProviderAdapter>>;
  limits?: {
    maxConcurrentTotal?: number;
    maxConcurrentPerProvider?: number;
    maxConcurrentPerModel?: number;
    maxQueueSize?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
  };
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class AssessmentPreparationError extends Error {
  constructor() {
    super('The assessment request could not be prepared for this model.');
    this.name = 'AssessmentPreparationError';
  }
}

export interface SchedulerJobOutcome {
  batchId: string;
  jobId: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  status: JobRecord['status'];
  errorClass: string | null;
  result: JsonValue | null;
  detail?: string;
}

export interface SchedulerPreflightIssue {
  batchId: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  detail: string;
}

export interface SchedulerRunResult {
  batches: BatchRecord[];
  jobs: SchedulerJobOutcome[];
  blockedModels: Array<{
    providerId: AiProviderId;
    modelId: CandidateModelId;
    eligibility: ModelEligibility;
    reason: string;
  }>;
  preflightIssues: SchedulerPreflightIssue[];
}

interface SchedulerTask {
  batchId: string;
  model: EligibleModelCandidate;
  job: JobRecord;
  estimatedInputTokens: number;
  request: ProviderRequest;
}

interface BudgetReservation {
  providerId: AiProviderId;
  modelId: CandidateModelId;
  timestamp: number;
  requestCount: number;
  tokenCount: number;
  neuronCount: number;
  inputNeuronRate: number;
  outputNeuronRate: number;
}

class BudgetReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetReservationError';
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateBound(name: string, value: number, maximum: number): void {
  if (!isPositiveInteger(value) || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}.`);
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Scheduling was cancelled.'));
  }
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new Error('Scheduling was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function makeErrorClass(kind: ProviderErrorKind): string {
  return `provider_${kind}`;
}

function getAttemptStatus(
  kind: ProviderErrorKind,
): Exclude<JobRecord['status'], 'queued' | 'in_progress' | 'succeeded'> {
  if (kind === 'timeout' || kind === 'cancelled' || kind === 'transport' || kind === 'unknown') {
    return 'unknown_outcome';
  }
  if (kind === 'quota_exhausted' || kind === 'billing_required' || kind === 'model_deprecated') {
    return 'blocked';
  }
  return 'permanent_failed';
}

function isRetryableTransient(error: ProviderRequestError): boolean {
  return (
    error.metadata.retryable &&
    (error.metadata.kind === 'rate_limited' ||
      error.metadata.kind === 'unavailable')
  );
}

function retryDelay(
  attemptNumber: number,
  retryAfterMs: number | null,
  baseMs: number,
  maxMs: number,
  random: () => number,
): number {
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }
  const exponential = Math.min(maxMs, baseMs * 2 ** (attemptNumber - 1));
  return Math.round(exponential * (0.5 + random() * 0.5));
}

function areSameReferenceSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (
    left.some((reference) => typeof reference !== 'string' || reference.trim().length === 0) ||
    right.some((reference) => typeof reference !== 'string' || reference.trim().length === 0)
  ) {
    return false;
  }
  const sortedLeft = [...new Set(left)].sort();
  const sortedRight = [...new Set(right)].sort();
  return (
    sortedLeft.length === left.length &&
    sortedRight.length === right.length &&
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((reference, index) => reference === sortedRight[index])
  );
}

function canonicalSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Provider request payload must contain plain JSON data.');
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Provider request payload must contain plain JSON data.');
}

function requestPayloadHash(request: ProviderRequest): string {
  const identity = {
    modelId: request.modelId,
    messages: request.messages,
    maxOutputTokens: request.maxOutputTokens,
    responseFormat: request.responseFormat,
    responseSchema:
      request.responseFormat === 'strict_json_schema'
        ? request.responseSchema
        : null,
  };
  return createHash('sha256').update(canonicalSerialize(identity), 'utf8').digest('hex');
}

class BudgetController {
  private readonly reservations: BudgetReservation[] = [];

  constructor(
    private readonly now: () => number,
    private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
    history: ReturnType<BatchLedger['getBudgetHistory']>,
  ) {
    for (const attempt of history) {
      const model = MODEL_CANDIDATES[attempt.modelId];
      const inputTokens =
        attempt.inputTokens ?? attempt.estimatedInputTokens ?? 0;
      const outputTokens =
        attempt.outputTokens ?? attempt.estimatedOutputTokens ?? 0;
      const inputRate = model.publishedPricing.inputNeuronsPerMillionTokens;
      const outputRate = model.publishedPricing.outputNeuronsPerMillionTokens;
      const neuronCount =
        model.providerId === 'cloudflare-workers-ai' &&
        (inputRate === null || outputRate === null)
          ? AI_PROVIDERS['cloudflare-workers-ai'].publishedLimits.sharedFreeNeuronsPerDay
          : Math.ceil(
              (inputTokens * (inputRate ?? 0) +
                outputTokens * (outputRate ?? 0)) /
                1_000_000,
            );
      this.reservations.push({
        providerId: attempt.providerId,
        modelId: attempt.modelId,
        timestamp: attempt.requestStartedAt,
        requestCount: 1,
        tokenCount: inputTokens + outputTokens,
        neuronCount,
        inputNeuronRate: inputRate ?? 0,
        outputNeuronRate: outputRate ?? 0,
      });
    }
  }

  private modelReservations(
    model: EligibleModelCandidate,
    since: number,
  ): BudgetReservation[] {
    return this.reservations.filter(
      (reservation) =>
        reservation.providerId === model.providerId &&
        reservation.modelId === model.modelId &&
        reservation.timestamp > since,
    );
  }

  private waitForWindow(
    recent: readonly BudgetReservation[],
    now: number,
    limit: number | null,
    windowMs: number,
    amount: number,
    field: string,
  ): number {
    if (limit === null) {
      return 0;
    }
    if (limit <= 0 || amount > limit) {
      throw new BudgetReservationError(
        `The configured ${field} limit cannot accommodate this request.`,
      );
    }
    const ordered = [...recent].sort((left, right) => left.timestamp - right.timestamp);
    const requestLimit = field.toLowerCase().includes('request');
    const measuredAmount = (reservation: BudgetReservation) =>
      requestLimit ? reservation.requestCount : reservation.tokenCount;
    const current = ordered.reduce(
      (total, reservation) => total + measuredAmount(reservation),
      0,
    );
    if (current + amount <= limit) {
      return 0;
    }
    let remaining = current;
    for (const reservation of ordered) {
      remaining -= measuredAmount(reservation);
      if (remaining + amount <= limit) {
        return Math.max(1, reservation.timestamp + windowMs - now);
      }
    }
    return Math.max(1, (ordered[0]?.timestamp ?? now) + windowMs - now);
  }

  private getNeuronEstimate(
    model: Pick<ModelCandidate, 'providerId' | 'publishedPricing'>,
    inputTokens: number,
    outputTokens: number,
  ): number {
    if (model.providerId !== 'cloudflare-workers-ai') {
      return 0;
    }
    const inputRate = model.publishedPricing.inputNeuronsPerMillionTokens;
    const outputRate = model.publishedPricing.outputNeuronsPerMillionTokens;
    if (inputRate === null || outputRate === null) {
      throw new BudgetReservationError(
        'Cloudflare Neuron pricing is unconfirmed for this model.',
      );
    }
    return Math.ceil(
      (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
    );
  }

  async reserve(
    model: EligibleModelCandidate,
    inputTokens: number,
    outputTokens: number,
    signal?: AbortSignal,
  ): Promise<BudgetReservation> {
    const tokenCount = inputTokens + outputTokens;
    const neuronCount = this.getNeuronEstimate(model, inputTokens, outputTokens);
    const cloudflareNeuronLimit =
      AI_PROVIDERS['cloudflare-workers-ai'].publishedLimits.sharedFreeNeuronsPerDay;
    if (neuronCount > cloudflareNeuronLimit) {
      throw new BudgetReservationError(
        'The estimated request exceeds the shared Cloudflare Free Neuron allocation.',
      );
    }

    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Scheduling was cancelled.');
      }
      const currentTime = this.now();
      const retentionThreshold = currentTime - 24 * 60 * 60 * 1_000;
      while (
        this.reservations.length > 0 &&
        (this.reservations[0]?.timestamp ?? currentTime) <= retentionThreshold
      ) {
        this.reservations.shift();
      }
      const oneMinuteAgo = currentTime - 60_000;
      const oneDayAgo = currentTime - 24 * 60 * 60 * 1_000;
      const modelMinute = this.modelReservations(model, oneMinuteAgo);
      const modelDay = this.modelReservations(model, oneDayAgo);
      const providerMinute =
        model.providerId === 'cloudflare-workers-ai'
          ? this.reservations.filter(
              (reservation) =>
                reservation.providerId === model.providerId &&
                reservation.timestamp > oneMinuteAgo,
            )
          : modelMinute;

      const limits = model.accountLimits;
      const waits = [
        this.waitForWindow(
          modelMinute,
          currentTime,
          limits.requestsPerMinute,
          60_000,
          1,
          'requestsPerMinute',
        ),
        this.waitForWindow(
          modelDay,
          currentTime,
          limits.requestsPerDay,
          24 * 60 * 60 * 1_000,
          1,
          'requestsPerDay',
        ),
        this.waitForWindow(
          modelMinute,
          currentTime,
          limits.tokensPerMinute,
          60_000,
          tokenCount,
          'tokensPerMinute',
        ),
        this.waitForWindow(
          modelDay,
          currentTime,
          limits.tokensPerDay,
          24 * 60 * 60 * 1_000,
          tokenCount,
          'tokensPerDay',
        ),
      ];
      if (model.providerId === 'cloudflare-workers-ai') {
        const requestLimit =
          AI_PROVIDERS['cloudflare-workers-ai'].publishedLimits.requestsPerMinute;
        waits.push(
          this.waitForWindow(
            providerMinute,
            currentTime,
            requestLimit,
            60_000,
            1,
            'providerRequestsPerMinute',
          ),
        );
        const utcDayStart =
          Date.UTC(
            new Date(currentTime).getUTCFullYear(),
            new Date(currentTime).getUTCMonth(),
            new Date(currentTime).getUTCDate(),
          );
        const neuronsToday = this.reservations
          .filter(
            (reservation) =>
              reservation.providerId === model.providerId &&
              reservation.timestamp >= utcDayStart,
          )
          .reduce((sum, reservation) => sum + reservation.neuronCount, 0);
        if (neuronsToday + neuronCount > cloudflareNeuronLimit) {
          const nextUtcDay = utcDayStart + 24 * 60 * 60 * 1_000;
          waits.push(Math.max(1, nextUtcDay - currentTime));
        }
      }

      const waitMs = Math.max(...waits);
      if (waitMs > 0) {
        await this.sleep(waitMs, signal);
        continue;
      }
      const reservation: BudgetReservation = {
        providerId: model.providerId,
        modelId: model.modelId,
        timestamp: currentTime,
        requestCount: 1,
        tokenCount,
        neuronCount,
        inputNeuronRate:
          model.providerId === 'cloudflare-workers-ai'
            ? model.publishedPricing.inputNeuronsPerMillionTokens ?? 0
            : 0,
        outputNeuronRate:
          model.providerId === 'cloudflare-workers-ai'
            ? model.publishedPricing.outputNeuronsPerMillionTokens ?? 0
            : 0,
      };
      this.reservations.push(reservation);
      return reservation;
    }
  }

  settle(
    reservation: BudgetReservation,
    inputTokens: number | null,
    outputTokens: number | null,
  ): void {
    if (inputTokens === null || outputTokens === null) {
      return;
    }
    reservation.tokenCount = inputTokens + outputTokens;
    reservation.neuronCount = Math.ceil(
      (inputTokens * reservation.inputNeuronRate +
        outputTokens * reservation.outputNeuronRate) /
        1_000_000,
    );
  }
}

const budgetControllers = new WeakMap<BatchLedger, BudgetController>();
const activeLedgerRuns = new WeakMap<BatchLedger, Promise<void>>();

function roundRobin<T>(queues: T[][]): T[] {
  const result: T[] = [];
  let hasItems = true;
  while (hasItems) {
    hasItems = false;
    for (const queue of queues) {
      const item = queue.shift();
      if (item !== undefined) {
        result.push(item);
        hasItems = true;
      }
    }
  }
  return result;
}

function toOutcome(
  batchId: string,
  job: JobRecord,
  detail?: string,
): SchedulerJobOutcome {
  return {
    batchId,
    jobId: job.jobId,
    providerId: job.providerId,
    modelId: job.modelId,
    status: job.status,
    errorClass: job.errorClass,
    result: null,
    ...(detail ? { detail } : {}),
  };
}

export class BoundedAssessmentScheduler {
  private readonly maxConcurrentTotal: number;
  private readonly maxConcurrentPerProvider: number;
  private readonly maxConcurrentPerModel: number;
  private readonly maxQueueSize: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly budget: BudgetController;

  constructor(private readonly options: SchedulerOptions) {
    const limits = options.limits ?? {};
    this.maxConcurrentTotal =
      limits.maxConcurrentTotal ?? DEFAULT_MAX_CONCURRENT_TOTAL;
    this.maxConcurrentPerProvider =
      limits.maxConcurrentPerProvider ?? DEFAULT_MAX_CONCURRENT_PER_PROVIDER;
    this.maxConcurrentPerModel =
      limits.maxConcurrentPerModel ?? DEFAULT_MAX_CONCURRENT_PER_MODEL;
    this.maxQueueSize = limits.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.maxAttempts = limits.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseMs = limits.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = limits.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    validateBound('maxConcurrentTotal', this.maxConcurrentTotal, 64);
    validateBound('maxConcurrentPerProvider', this.maxConcurrentPerProvider, 32);
    validateBound('maxConcurrentPerModel', this.maxConcurrentPerModel, 16);
    validateBound('maxQueueSize', this.maxQueueSize, 5_000);
    validateBound('maxAttempts', this.maxAttempts, 10);
    if (
      !Number.isSafeInteger(this.retryBaseMs) ||
      this.retryBaseMs < 0 ||
      !Number.isSafeInteger(this.retryMaxMs) ||
      this.retryMaxMs < this.retryBaseMs
    ) {
      throw new RangeError('Retry delays must be non-negative integer milliseconds.');
    }
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    const sharedBudget = budgetControllers.get(options.ledger);
    if (sharedBudget) {
      this.budget = sharedBudget;
    } else {
      const budget = new BudgetController(
        this.now,
        this.sleep,
        options.ledger.getBudgetHistory(
          Math.max(0, this.now() - 24 * 60 * 60 * 1_000),
        ),
      );
      budgetControllers.set(options.ledger, budget);
      this.budget = budget;
    }
    for (const providerId of ['groq', 'cloudflare-workers-ai'] as const) {
      const adapter = options.adapters[providerId];
      if (adapter && adapter.providerId !== providerId) {
        throw new TypeError(`The ${providerId} adapter is registered under the wrong provider.`);
      }
    }
  }

  async run(
    batches: readonly SchedulerBatchInput[],
    signal?: AbortSignal,
  ): Promise<SchedulerRunResult> {
    const previousRun = activeLedgerRuns.get(this.options.ledger) ?? Promise.resolve();
    let unlock!: () => void;
    const currentRun = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    activeLedgerRuns.set(this.options.ledger, currentRun);
    await previousRun;
    try {
      return await this.runExclusive(batches, signal);
    } finally {
      unlock();
      if (activeLedgerRuns.get(this.options.ledger) === currentRun) {
        activeLedgerRuns.delete(this.options.ledger);
      }
    }
  }

  private async runExclusive(
    batches: readonly SchedulerBatchInput[],
    signal?: AbortSignal,
  ): Promise<SchedulerRunResult> {
    const eligibleModels = getEligibleModels();
    const eligibleIds = new Set<string>(
      eligibleModels.map((model) => model.modelId),
    );
    const blockedModels = Object.values(MODEL_CANDIDATES)
      .filter((candidate) => !eligibleIds.has(candidate.modelId))
      .map((candidate) => ({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        eligibility:
          candidate.eligibility === 'eligible'
            ? 'blocked_unverified' as const
            : candidate.eligibility,
        reason:
          candidate.eligibilityReason ||
          'The model does not satisfy every fail-closed eligibility requirement.',
      }));
    const plannedMaximum = batches.reduce(
      (total, batch) =>
        total + batch.assessments.length * eligibleModels.length,
      0,
    );
    const requestedAssessmentCount = batches.reduce(
      (total, batch) => total + batch.assessments.length,
      0,
    );
    if (
      plannedMaximum > this.maxQueueSize ||
      requestedAssessmentCount > this.maxQueueSize ||
      batches.length > this.maxQueueSize
    ) {
      throw new RangeError(
        `The scheduler queue exceeds its configured maximum of ${this.maxQueueSize} jobs.`,
      );
    }

    const batchRecords: BatchRecord[] = [];
    const jobOutcomes: SchedulerJobOutcome[] = [];
    const preflightIssues: SchedulerPreflightIssue[] = [];
    const queues: SchedulerTask[][] = [];

    for (const batchInput of batches) {
      const issueStart = preflightIssues.length;
      const prepared: Array<{
        model: EligibleModelCandidate;
        prepared: PreparedAssessment;
        requestPayloadHash: string;
      }> = [];
      for (const assessment of batchInput.assessments) {
        for (const model of eligibleModels) {
          const adapter = this.options.adapters[model.providerId];
          if (!adapter) {
            preflightIssues.push({
              batchId: '',
              providerId: model.providerId,
              modelId: model.modelId,
              detail: 'No provider adapter is configured.',
            });
            continue;
          }
          let item: PreparedAssessment;
          try {
            item = assessment.prepare(model);
          } catch (error) {
            if (!(error instanceof AssessmentPreparationError)) {
              throw error;
            }
            preflightIssues.push({
              batchId: '',
              providerId: model.providerId,
              modelId: model.modelId,
              detail: error.message,
            });
            continue;
          }
          const issue = this.validatePrepared(model, item);
          if (issue) {
            preflightIssues.push({
              batchId: '',
              providerId: model.providerId,
              modelId: model.modelId,
              detail: issue,
            });
            continue;
          }
          let payloadHash: string;
          try {
            payloadHash = requestPayloadHash(item.request);
          } catch (error) {
            if (!(error instanceof TypeError)) {
              throw error;
            }
            preflightIssues.push({
              batchId: '',
              providerId: model.providerId,
              modelId: model.modelId,
              detail: 'The prepared request contains non-JSON data.',
            });
            continue;
          }
          prepared.push({
            model,
            prepared: item,
            requestPayloadHash: payloadHash,
          });
        }
      }
      const batch = this.options.ledger.createBatch({
        ...batchInput.batch,
        plannedJobCount: prepared.length,
      });
      for (let index = issueStart; index < preflightIssues.length; index += 1) {
        const issue = preflightIssues[index];
        if (issue) {
          issue.batchId = batch.batchId;
        }
      }
      batchRecords.push(batch);
      const tasks: SchedulerTask[] = [];
      for (const item of prepared) {
        const created = this.options.ledger.createJob({
          ...item.prepared.job,
          batchId: batch.batchId,
          requestPayloadHash: item.requestPayloadHash,
        });
        if (created.job.providerId !== item.model.providerId ||
            created.job.modelId !== item.model.modelId) {
          throw new Error('Ledger idempotency resolved to an unexpected model job.');
        }
        if (created.job.status === 'queued') {
          tasks.push({
            batchId: batch.batchId,
            model: item.model,
            job: created.job,
            estimatedInputTokens: item.prepared.estimatedInputTokens,
            request: item.prepared.request,
          });
        } else {
          const result = created.job.status === 'succeeded'
            ? this.options.ledger.getAssessmentResult(created.job.jobId)?.normalizedResult ?? null
            : null;
          jobOutcomes.push({
            ...toOutcome(batch.batchId, created.job),
            result,
          });
        }
      }
      queues.push(tasks);
    }

    const tasks = roundRobin(queues);
    jobOutcomes.push(...await this.dispatch(tasks, signal));

    return {
      batches: batchRecords.map((batch) =>
        this.options.ledger.getBatch(batch.batchId) ?? batch,
      ),
      jobs: jobOutcomes,
      blockedModels,
      preflightIssues,
    };
  }

  private validatePrepared(
    model: EligibleModelCandidate,
    prepared: PreparedAssessment,
  ): string | null {
    if (prepared.job.ruleIds.length !== 1) {
      return 'Each assessment job must target exactly one rule.';
    }
    if (!areSameReferenceSet(prepared.sentEvidenceRefIds, prepared.job.evidenceRefIds)) {
      return 'The job evidence references must exactly match the dispatched context.';
    }
    if (
      !Number.isSafeInteger(prepared.estimatedInputTokens) ||
      prepared.estimatedInputTokens <= 0
    ) {
      return 'A positive integer input-token estimate is required.';
    }
    if (
      prepared.estimatedInputTokens > model.contextTokens ||
      (model.maxInputTokens !== null &&
        prepared.estimatedInputTokens > model.maxInputTokens) ||
      prepared.estimatedInputTokens + prepared.request.maxOutputTokens >
        model.contextTokens
    ) {
      return 'The prepared request exceeds the verified model context/input limit.';
    }
    if (
      prepared.job.providerId !== model.providerId ||
      prepared.job.modelId !== model.modelId ||
      prepared.request.modelId !== model.modelId
    ) {
      throw new TypeError('Prepared job and request must match the eligible model.');
    }
    if (
      prepared.request.responseFormat !== model.requiredStructuredOutput ||
      !Number.isSafeInteger(prepared.request.maxOutputTokens) ||
      prepared.request.maxOutputTokens <= 0 ||
      prepared.request.maxOutputTokens > model.applicationMaxOutputTokens
    ) {
      return 'The request does not match the model structured-output/output-token policy.';
    }
    if (
      !Number.isSafeInteger(prepared.request.timeoutMs) ||
      prepared.request.timeoutMs <= 0 ||
      prepared.request.timeoutMs > MAX_PROVIDER_TIMEOUT_MS ||
      prepared.request.messages.length === 0
    ) {
      return `The prepared request requires messages and a timeout from 1 through ${MAX_PROVIDER_TIMEOUT_MS} milliseconds.`;
    }
    return null;
  }

  private async dispatch(
    tasks: readonly SchedulerTask[],
    externalSignal?: AbortSignal,
  ): Promise<SchedulerJobOutcome[]> {
    const outcomes: SchedulerJobOutcome[] = [];
    const claimed = new Array<boolean>(tasks.length).fill(false);
    const providerActive = new Map<AiProviderId, number>();
    const modelActive = new Map<CandidateModelId, number>();
    const pausedProviders = new Set<AiProviderId>();
    const pausedModels = new Set<CandidateModelId>();
    const batchTaskIndexes = new Map<string, number[]>();
    tasks.forEach((task, index) => {
      const indexes = batchTaskIndexes.get(task.batchId) ?? [];
      indexes.push(index);
      batchTaskIndexes.set(task.batchId, indexes);
    });
    const batchIds = [...batchTaskIndexes.keys()];
    let active = 0;
    let batchCursor = 0;
    let failure: unknown;

    return new Promise((resolve, reject) => {
      const findNextRunnable = (): number => {
        for (let offset = 0; offset < batchIds.length; offset += 1) {
          const batchIndex = (batchCursor + offset) % batchIds.length;
          const batchId = batchIds[batchIndex];
          if (!batchId) {
            continue;
          }
          const taskIndexes = batchTaskIndexes.get(batchId) ?? [];
          for (const index of taskIndexes) {
            const task = tasks[index];
            if (!task || claimed[index] || outcomes[index] !== undefined) {
              continue;
            }
            if (
              pausedProviders.has(task.model.providerId) ||
              pausedModels.has(task.model.modelId) ||
              externalSignal?.aborted
            ) {
              outcomes[index] = toOutcome(
                task.batchId,
                task.job,
                pausedProviders.has(task.model.providerId)
                  ? 'provider_paused'
                  : pausedModels.has(task.model.modelId)
                    ? 'model_paused'
                    : 'cancelled_before_dispatch',
              );
              continue;
            }
            const providerCount = providerActive.get(task.model.providerId) ?? 0;
            const modelCount = modelActive.get(task.model.modelId) ?? 0;
            if (
              providerCount < this.maxConcurrentPerProvider &&
              modelCount < this.maxConcurrentPerModel
            ) {
              batchCursor = (batchIndex + 1) % batchIds.length;
              return index;
            }
          }
        }
        return -1;
      };

      const pump = () => {
        while (!failure && active < this.maxConcurrentTotal) {
          const selectedIndex = findNextRunnable();
          if (selectedIndex < 0) {
            break;
          }
          const task = tasks[selectedIndex];
          if (!task) {
            break;
          }
          claimed[selectedIndex] = true;
          active += 1;
          providerActive.set(
            task.model.providerId,
            (providerActive.get(task.model.providerId) ?? 0) + 1,
          );
          modelActive.set(
            task.model.modelId,
            (modelActive.get(task.model.modelId) ?? 0) + 1,
          );
          void this.dispatchTask(task, externalSignal).then((outcome) => {
            outcomes[selectedIndex] = outcome;
            if (outcome.status === 'blocked') {
              pausedModels.add(task.model.modelId);
              if (outcome.detail === 'provider_quota_exhausted') {
                pausedProviders.add(task.model.providerId);
              }
            }
          }).catch((error: unknown) => {
            failure = error;
          }).finally(() => {
            active -= 1;
            providerActive.set(
              task.model.providerId,
              Math.max(0, (providerActive.get(task.model.providerId) ?? 1) - 1),
            );
            modelActive.set(
              task.model.modelId,
              Math.max(0, (modelActive.get(task.model.modelId) ?? 1) - 1),
            );
            if (active === 0 && (failure || outcomes.filter(Boolean).length === tasks.length)) {
              if (failure) {
                reject(failure);
              } else {
                resolve(outcomes.filter((outcome): outcome is SchedulerJobOutcome => Boolean(outcome)));
              }
            } else {
              pump();
            }
          });
        }
        if (active === 0 && outcomes.filter(Boolean).length === tasks.length) {
          if (failure) {
            reject(failure);
          } else {
            resolve(outcomes.filter((outcome): outcome is SchedulerJobOutcome => Boolean(outcome)));
          }
        }
      };
      if (tasks.length === 0) {
        resolve([]);
      } else {
        pump();
      }
    });
  }

  private async dispatchTask(
    task: SchedulerTask,
    externalSignal?: AbortSignal,
  ): Promise<SchedulerJobOutcome> {
    const adapter = this.options.adapters[task.model.providerId];
    if (!adapter) {
      throw new Error(`The ${task.model.providerId} adapter is unavailable.`);
    }
    let job = this.options.ledger.getJob(task.job.jobId) ?? task.job;
    if (job.status !== 'queued') {
      return {
        ...toOutcome(task.batchId, job),
        result:
          job.status === 'succeeded'
            ? this.options.ledger.getAssessmentResult(job.jobId)?.normalizedResult ?? null
            : null,
      };
    }

    for (let attemptNumber = 1; attemptNumber <= this.maxAttempts; attemptNumber += 1) {
      if (externalSignal?.aborted) {
        job = this.options.ledger.getJob(job.jobId) ?? job;
        return toOutcome(task.batchId, job, 'cancelled_before_dispatch');
      }
      let reservation: BudgetReservation;
      try {
        reservation = await this.budget.reserve(
          task.model,
          task.estimatedInputTokens,
          task.request.maxOutputTokens,
          externalSignal,
        );
      } catch (error) {
        if (error instanceof BudgetReservationError) {
          return toOutcome(task.batchId, job, error.message);
        }
        if (externalSignal?.aborted) {
          return toOutcome(task.batchId, job, 'cancelled_before_dispatch');
        }
        throw error;
      }
      if (externalSignal?.aborted) {
        return toOutcome(task.batchId, job, 'cancelled_before_dispatch');
      }

      let attempt;
      try {
        attempt = this.options.ledger.beginAttempt(job.jobId, {
          retryRequested: attemptNumber > 1,
          estimatedInputTokens: task.estimatedInputTokens,
          estimatedOutputTokens: task.request.maxOutputTokens,
        });
      } catch (error) {
        const current = this.options.ledger.getJob(job.jobId);
        if (current && current.status !== 'queued') {
          return {
            ...toOutcome(task.batchId, current, 'job_already_claimed'),
            result:
              current.status === 'succeeded'
                ? this.options.ledger.getAssessmentResult(current.jobId)?.normalizedResult ?? null
                : null,
          };
        }
        throw error;
      }

      const controller = new AbortController();
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, controller.signal])
        : controller.signal;
      let leaseLost = false;
      const renewInterval = setInterval(() => {
        try {
          this.options.ledger.renewAttemptLease(job.jobId, attempt.attemptId);
        } catch {
          leaseLost = true;
          controller.abort(new Error('The scheduler lost ownership of the active attempt.'));
        }
      }, Math.max(250, Math.floor(this.options.ledger.attemptLeaseMs / 3)));
      const requestTimeout = setTimeout(() => {
        controller.abort(
          new Error('The provider request exceeded its configured timeout.'),
        );
      }, task.request.timeoutMs);

      let completion: ProviderCompletion;
      try {
        completion = await adapter.complete({
          ...task.request,
          signal,
        });
      } catch (error) {
        clearInterval(renewInterval);
        clearTimeout(requestTimeout);
        if (leaseLost) {
          const current = this.options.ledger.getJob(job.jobId) ?? job;
          return toOutcome(task.batchId, current, 'attempt_ownership_lost');
        }
        if (error instanceof ProviderRequestError) {
          const { metadata } = error;
          const status = getAttemptStatus(metadata.kind);
          const transient = isRetryableTransient(error);
          const invalidProviderResponse = metadata.kind === 'malformed_response';
          const attemptStatus = invalidProviderResponse
            ? 'invalid_response'
            : transient
              ? 'retryable_failed'
              : status;
          const updated = this.options.ledger.completeAttempt(
            job.jobId,
            attempt.attemptId,
            {
              status: attemptStatus,
              providerRequestId: metadata.providerRequestId,
              httpStatus: metadata.statusCode,
              retryAfterMs: metadata.retryAfterMs,
              errorClass: invalidProviderResponse
                ? 'malformed_response'
                : makeErrorClass(metadata.kind),
              estimatedInputTokens: task.estimatedInputTokens,
              estimatedOutputTokens: task.request.maxOutputTokens,
              validationStatus: invalidProviderResponse ? 'invalid' : 'not_run',
            },
          );
          if (status === 'blocked') {
            return toOutcome(
              task.batchId,
              updated,
              metadata.kind === 'quota_exhausted'
                ? 'provider_quota_exhausted'
                : 'model_blocked',
            );
          }
          if (transient && attemptNumber < this.maxAttempts) {
            const delay = retryDelay(
              attemptNumber,
              metadata.retryAfterMs,
              this.retryBaseMs,
              this.retryMaxMs,
              this.random,
            );
            if (externalSignal?.aborted) {
              return toOutcome(task.batchId, updated, 'cancelled_before_retry');
            }
            try {
              await this.sleep(delay, externalSignal);
            } catch (error) {
              if (!externalSignal?.aborted) {
                throw error;
              }
              return toOutcome(task.batchId, updated, 'cancelled_before_retry');
            }
            job = updated;
            continue;
          }
          return toOutcome(
            task.batchId,
            updated,
            invalidProviderResponse ? 'malformed_provider_response' : undefined,
          );
        }
        const updated = this.options.ledger.completeAttempt(
          job.jobId,
          attempt.attemptId,
          {
            status: 'unknown_outcome',
            errorClass: 'provider_unknown_error',
            estimatedInputTokens: task.estimatedInputTokens,
            estimatedOutputTokens: task.request.maxOutputTokens,
            validationStatus: 'not_run',
          },
        );
        return toOutcome(task.batchId, updated);
      }
      clearInterval(renewInterval);
      clearTimeout(requestTimeout);
      if (leaseLost) {
        const current = this.options.ledger.getJob(job.jobId) ?? job;
        return toOutcome(task.batchId, current, 'attempt_ownership_lost');
      }

      this.budget.settle(
        reservation,
        completion.usage.inputTokens,
        completion.usage.outputTokens,
      );
      if (
        completion.providerId !== task.model.providerId ||
        completion.modelId !== task.model.modelId
      ) {
        const updated = this.options.ledger.completeAttempt(
          job.jobId,
          attempt.attemptId,
          {
            status: 'invalid_response',
            providerRequestId: completion.providerRequestId,
            finishReason: completion.finishReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            estimatedInputTokens: task.estimatedInputTokens,
            estimatedOutputTokens: task.request.maxOutputTokens,
            errorClass: 'provider_response_identity_mismatch',
            validationStatus: 'invalid',
          },
        );
        return toOutcome(task.batchId, updated);
      }
      if (completion.status === 'incomplete') {
        const updated = this.options.ledger.completeAttempt(
          job.jobId,
          attempt.attemptId,
          {
            status: 'invalid_response',
            providerRequestId: completion.providerRequestId,
            finishReason: completion.finishReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            estimatedInputTokens: task.estimatedInputTokens,
            estimatedOutputTokens: task.request.maxOutputTokens,
            errorClass:
              completion.reason === 'unsupported'
                ? 'unsupported_finish_reason'
                : `incomplete_${completion.reason}`,
            validationStatus: 'invalid',
          },
        );
        return toOutcome(task.batchId, updated);
      }

      let parsed: unknown;
      try {
        parsed = parseAssessmentResponse(completion.text);
      } catch (error) {
        if (!(error instanceof AssessmentValidationError)) {
          throw error;
        }
        const updated = this.options.ledger.completeAttempt(
          job.jobId,
          attempt.attemptId,
          {
            status: 'invalid_response',
            providerRequestId: completion.providerRequestId,
            finishReason: completion.finishReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            estimatedInputTokens: task.estimatedInputTokens,
            estimatedOutputTokens: task.request.maxOutputTokens,
            errorClass: error.failure,
            validationStatus: 'invalid',
          },
        );
        return toOutcome(task.batchId, updated);
      }

      let normalized: JsonValue;
      try {
        normalized = this.options.ledger.validateResult(job.jobId, parsed);
      } catch (error) {
        if (!(error instanceof AssessmentValidationError)) {
          throw error;
        }
        const updated = this.options.ledger.completeAttempt(
          job.jobId,
          attempt.attemptId,
          {
            status: 'invalid_response',
            providerRequestId: completion.providerRequestId,
            finishReason: completion.finishReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            estimatedInputTokens: task.estimatedInputTokens,
            estimatedOutputTokens: task.request.maxOutputTokens,
            errorClass: error.failure,
            validationStatus: 'invalid',
          },
        );
        return toOutcome(task.batchId, updated);
      }
      const updated = this.options.ledger.completeAttempt(
        job.jobId,
        attempt.attemptId,
        {
          status: 'succeeded',
          providerRequestId: completion.providerRequestId,
          finishReason: completion.finishReason,
          inputTokens: completion.usage.inputTokens,
          outputTokens: completion.usage.outputTokens,
          estimatedInputTokens: task.estimatedInputTokens,
          estimatedOutputTokens: task.request.maxOutputTokens,
          validationStatus: 'valid',
          normalizedResult: normalized,
        },
      );
      return {
        ...toOutcome(task.batchId, updated),
        result: normalized,
      };
    }
    return toOutcome(
      task.batchId,
      this.options.ledger.getJob(job.jobId) ?? job,
      'maximum_attempts_reached',
    );
  }
}
