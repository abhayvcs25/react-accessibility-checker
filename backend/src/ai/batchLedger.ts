import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import {
  MODEL_CANDIDATES,
  type AiProviderId,
  type CandidateModelId,
} from './config.js';

const LEDGER_SCHEMA_VERSION = 2;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_ATTEMPT_LEASE_MS = 120_000;
const MAX_NORMALIZED_RESULT_BYTES = 1_000_000;
const SUPPORTED_ASSESSMENT_SCHEMA_VERSIONS = new Set(['schema-v1']);

const TERMINAL_STATUSES = [
  'succeeded',
  'invalid_response',
  'retryable_failed',
  'permanent_failed',
  'blocked',
  'unknown_outcome',
] as const;

export type BatchStatus =
  | 'queued'
  | 'in_progress'
  | 'succeeded'
  | 'partial'
  | 'failed';

export type JobStatus =
  | 'queued'
  | 'in_progress'
  | (typeof TERMINAL_STATUSES)[number];

export type AttemptStatus = Exclude<JobStatus, 'queued' | 'in_progress'> | 'in_progress';

export type ValidationStatus = 'valid' | 'invalid' | 'not_run';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BatchLedgerOptions {
  filePath?: string;
  retentionDays?: number;
  attemptLeaseMs?: number;
  environment?: NodeJS.ProcessEnv;
}

export interface CreateBatchInput {
  projectId: string;
  sourceKind: string;
  projectLabel?: string;
  contentHash: string;
  extractionVersion: string;
  ruleRegistryVersion: string;
  promptVersion: string;
  schemaVersion: string;
  plannedJobCount: number;
}

export interface CreateJobInput {
  batchId: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  componentId: string;
  ruleIds: readonly string[];
  contextHash: string;
  evidenceRefIds: readonly string[];
  requestPayloadHash: string;
  promptVersion: string;
  schemaVersion: string;
  modelConfigHash: string;
}

export interface BatchRecord {
  batchId: string;
  projectId: string;
  snapshotId: string;
  status: BatchStatus;
  promptVersion: string;
  schemaVersion: string;
  plannedJobCount: number;
  terminalJobCount: number;
  createdAt: number;
  completedAt: number | null;
}

export interface JobRecord {
  jobId: string;
  batchId: string;
  idempotencyKey: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  componentId: string;
  ruleIds: string[];
  contextHash: string;
  evidenceRefIds: string[];
  requestPayloadHash: string;
  promptVersion: string;
  schemaVersion: string;
  modelConfigHash: string;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  resultId: string | null;
  validationStatus: ValidationStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  errorClass: string | null;
  retryAfterMs: number | null;
}

export interface AttemptRecord {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  status: AttemptStatus;
  requestStartedAt: number;
  responseReceivedAt: number | null;
  providerRequestId: string | null;
  httpStatus: number | null;
  finishReason: string | null;
  retryAfterMs: number | null;
  errorClass: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedInputTokens: number | null;
  estimatedOutputTokens: number | null;
  validationStatus: ValidationStatus;
}

export interface AssessmentResultRecord {
  resultId: string;
  jobId: string;
  attemptId: string;
  schemaVersion: string;
  validationStatus: 'valid';
  normalizedResult: JsonValue;
  createdAt: number;
}

export interface BeginAttemptOptions {
  retryRequested?: boolean;
  acknowledgePossibleDuplicate?: boolean;
}

export interface CompleteAttemptInput {
  status: Exclude<AttemptStatus, 'in_progress'>;
  providerRequestId?: string | null;
  httpStatus?: number | null;
  finishReason?: string | null;
  retryAfterMs?: number | null;
  errorClass?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  validationStatus: ValidationStatus;
  normalizedResult?: JsonValue;
}

interface DatabaseRow extends Record<string, SQLOutputValue> {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: string, field: string, maxLength = 256): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Normalized results must contain plain JSON objects.');
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  throw new TypeError('The value is not valid JSON data.');
}

function serializeCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function requireSha256(value: string, field: string): string {
  requiredText(value, field, 64);
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new TypeError(`${field} must be a SHA-256 hex digest.`);
  }
  return value.toLowerCase();
}

function parseRetentionDays(
  configured: string | undefined,
  override: number | undefined,
): number {
  if (override !== undefined) {
    if (!Number.isSafeInteger(override) || override < 1 || override > 3650) {
      throw new RangeError('retentionDays must be an integer from 1 through 3650.');
    }
    return override;
  }
  if (configured === undefined || configured.trim() === '') {
    return DEFAULT_RETENTION_DAYS;
  }
  if (!/^[1-9]\d{0,3}$/.test(configured.trim())) {
    throw new RangeError(
      'USAGE_LEDGER_RETENTION_DAYS must be an integer from 1 through 3650.',
    );
  }
  const days = Number(configured);
  if (days > 3650) {
    throw new RangeError(
      'USAGE_LEDGER_RETENTION_DAYS must be an integer from 1 through 3650.',
    );
  }
  return days;
}

function toNumber(value: SQLOutputValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('The AI batch ledger contains an invalid numeric value.');
  }
  return value;
}

function toNullableNumber(value: SQLOutputValue | undefined): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

function toText(value: SQLOutputValue | undefined): string {
  if (typeof value !== 'string') {
    throw new Error('The AI batch ledger contains an invalid text value.');
  }
  return value;
}

function toNullableText(value: SQLOutputValue | undefined): string | null {
  return value === null || value === undefined ? null : toText(value);
}

function parseStringArray(value: SQLOutputValue | undefined): string[] {
  const parsed: unknown = JSON.parse(toText(value));
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string')
  ) {
    throw new Error('The AI batch ledger contains an invalid string list.');
  }
  return parsed;
}

function parseJsonValue(value: string): JsonValue {
  const parsed: unknown = JSON.parse(value);
  return parsed as JsonValue;
}

function assertTokenCount(value: number | null | undefined, field: string): void {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new RangeError(`${field} must be a non-negative integer or null.`);
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

function validateAssessmentResult(
  value: unknown,
  job: {
    componentId: string;
    providerId: string;
    modelId: string;
    schemaVersion: string;
  },
  ruleIds: ReadonlySet<string>,
  evidenceRefIds: ReadonlySet<string>,
): JsonValue {
  if (!SUPPORTED_ASSESSMENT_SCHEMA_VERSIONS.has(job.schemaVersion)) {
    throw new Error(
      `Unsupported assessment result schema version: ${job.schemaVersion}.`,
    );
  }
  if (!isRecord(value)) {
    throw new TypeError('The assessment result must be an object.');
  }
  const allowedFields = new Set([
    'targetId',
    'ruleId',
    'status',
    'explanation',
    'evidenceRefs',
    'confidence',
    'providerId',
    'modelId',
  ]);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    throw new TypeError('The assessment result contains unsupported fields.');
  }
  if (
    value.targetId !== job.componentId ||
    typeof value.ruleId !== 'string' ||
    !ruleIds.has(value.ruleId) ||
    typeof value.status !== 'string' ||
    !['potential_issue', 'no_issue_detected', 'insufficient_context'].includes(
      value.status,
    ) ||
    typeof value.explanation !== 'string' ||
    value.explanation.trim().length === 0 ||
    value.explanation.length > 2_000 ||
    !Array.isArray(value.evidenceRefs) ||
    value.evidenceRefs.some(
      (reference) =>
        typeof reference !== 'string' || !evidenceRefIds.has(reference),
    ) ||
    value.providerId !== job.providerId ||
    value.modelId !== job.modelId ||
    (value.confidence !== undefined &&
      value.confidence !== null &&
      (typeof value.confidence !== 'number' ||
        !Number.isFinite(value.confidence) ||
        value.confidence < 0 ||
        value.confidence > 1))
  ) {
    throw new TypeError(
      'The assessment result does not match the job schema, identity, or permitted evidence.',
    );
  }
  return canonicalize(value);
}

export function deriveJobIdempotencyKey(
  input: CreateJobInput,
  snapshot: {
    projectId: string;
    contentHash: string;
    extractionVersion: string;
    ruleRegistryVersion: string;
  },
): string {
  const ruleIds = [...new Set(input.ruleIds)].sort();
  return sha256(
    serializeCanonical({
      projectId: snapshot.projectId,
      snapshotContentHash: snapshot.contentHash,
      extractionVersion: snapshot.extractionVersion,
      ruleRegistryVersion: snapshot.ruleRegistryVersion,
      providerId: input.providerId,
      modelId: input.modelId,
      componentId: input.componentId,
      ruleIds,
      evidenceRefIds: [...new Set(input.evidenceRefIds)].sort(),
      contextHash: input.contextHash,
      requestPayloadHash: input.requestPayloadHash,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      modelConfigHash: input.modelConfigHash,
    }),
  );
}

export class BatchLedger {
  readonly filePath: string;
  readonly retentionDays: number;
  readonly attemptLeaseMs: number;
  private readonly database: DatabaseSync;
  private readonly ownerInstanceId = randomUUID();
  private readonly ownerProcessId = process.pid;
  private readonly ownerHost = hostname();
  private closed = false;

  constructor(options: BatchLedgerOptions = {}) {
    const environment = options.environment ?? process.env;
    const localDataDirectory = environment.LOCALAPPDATA
      ? join(environment.LOCALAPPDATA, 'ReactAccessibilityChecker')
      : join(homedir(), '.react-accessibility-checker');
    this.filePath =
      options.filePath ??
      (environment.RAC_AI_BATCH_LEDGER_FILE?.trim() || null) ??
      join(localDataDirectory, 'ai-batch-ledger.sqlite');
    this.retentionDays = parseRetentionDays(
      environment.USAGE_LEDGER_RETENTION_DAYS,
      options.retentionDays,
    );
    this.attemptLeaseMs = options.attemptLeaseMs ?? DEFAULT_ATTEMPT_LEASE_MS;
    if (
      !Number.isSafeInteger(this.attemptLeaseMs) ||
      this.attemptLeaseMs < 1_000 ||
      this.attemptLeaseMs > 24 * 60 * 60 * 1_000
    ) {
      throw new RangeError('attemptLeaseMs must be an integer from 1000 through 86400000.');
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const existingFile = existsSync(this.filePath);
    this.database = new DatabaseSync(this.filePath, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.database.exec('PRAGMA busy_timeout = 5000;');
    try {
      this.initializeSchema(existingFile);
      this.cleanupExpiredTerminalJobs();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('The AI batch ledger is closed.');
    }
  }

  private transaction<T>(operation: () => T): T {
    this.assertOpen();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private initializeSchema(existingFile: boolean): void {
    const versionRow = this.database
      .prepare('PRAGMA user_version;')
      .get() as DatabaseRow;
    const version = toNumber(versionRow.user_version);
    if (version === LEDGER_SCHEMA_VERSION) {
      return;
    }
    if (version === 1) {
      this.transaction(() => {
        this.database.exec(`
          ALTER TABLE attempts ADD COLUMN owner_process_id INTEGER;
          ALTER TABLE attempts ADD COLUMN owner_host TEXT;
          ALTER TABLE attempts ADD COLUMN owner_instance_id TEXT;
          ALTER TABLE attempts ADD COLUMN lease_expires_at INTEGER;
          CREATE UNIQUE INDEX idx_one_active_attempt_per_job
            ON attempts(job_id) WHERE status = 'in_progress';
        `);
        this.database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION};`);
      });
      return;
    }
    if (version !== 0) {
      throw new Error(
        `Unsupported AI batch ledger schema version ${version}; expected ${LEDGER_SCHEMA_VERSION}.`,
      );
    }
    if (existingFile) {
      const table = this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1;",
        )
        .get();
      if (table) {
        throw new Error(
          'The AI batch ledger has tables but no supported schema version; refusing to modify it.',
        );
      }
    }

    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          source_kind TEXT NOT NULL,
          project_label TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE snapshots (
          snapshot_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL,
          extraction_version TEXT NOT NULL,
          rule_registry_version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE (project_id, content_hash, extraction_version, rule_registry_version)
        ) STRICT;

        CREATE TABLE batches (
          batch_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'succeeded', 'partial', 'failed')),
          prompt_version TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          planned_job_count INTEGER NOT NULL CHECK (planned_job_count >= 0),
          terminal_job_count INTEGER NOT NULL DEFAULT 0 CHECK (terminal_job_count >= 0),
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        ) STRICT;

        CREATE TABLE jobs (
          job_id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
          snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL UNIQUE,
          provider_id TEXT NOT NULL CHECK (provider_id IN ('groq', 'cloudflare-workers-ai')),
          model_id TEXT NOT NULL,
          component_id TEXT NOT NULL,
          context_hash TEXT NOT NULL,
          request_payload_hash TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          model_config_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'succeeded', 'invalid_response', 'retryable_failed', 'permanent_failed', 'blocked', 'unknown_outcome')),
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          result_id TEXT,
          validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'not_run')),
          input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
          estimated_input_tokens INTEGER CHECK (estimated_input_tokens IS NULL OR estimated_input_tokens >= 0),
          estimated_output_tokens INTEGER CHECK (estimated_output_tokens IS NULL OR estimated_output_tokens >= 0),
          error_class TEXT,
          retry_after_ms INTEGER CHECK (retry_after_ms IS NULL OR retry_after_ms >= 0)
        ) STRICT;

        CREATE TABLE job_rules (
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          rule_id TEXT NOT NULL,
          PRIMARY KEY (job_id, rule_id)
        ) STRICT;

        CREATE TABLE batch_jobs (
          batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          PRIMARY KEY (batch_id, job_id)
        ) STRICT;

        CREATE TABLE job_evidence_refs (
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          evidence_ref_id TEXT NOT NULL,
          PRIMARY KEY (job_id, evidence_ref_id)
        ) STRICT;

        CREATE TABLE attempts (
          attempt_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
          status TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'invalid_response', 'retryable_failed', 'permanent_failed', 'blocked', 'unknown_outcome')),
          request_started_at INTEGER NOT NULL,
          response_received_at INTEGER,
          provider_request_id TEXT,
          http_status INTEGER,
          finish_reason TEXT,
          retry_after_ms INTEGER CHECK (retry_after_ms IS NULL OR retry_after_ms >= 0),
          error_class TEXT,
          input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
          estimated_input_tokens INTEGER CHECK (estimated_input_tokens IS NULL OR estimated_input_tokens >= 0),
          estimated_output_tokens INTEGER CHECK (estimated_output_tokens IS NULL OR estimated_output_tokens >= 0),
          validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'not_run')),
          owner_process_id INTEGER,
          owner_host TEXT,
          owner_instance_id TEXT,
          lease_expires_at INTEGER,
          UNIQUE (job_id, attempt_number)
        ) STRICT;

        CREATE TABLE assessment_results (
          result_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id) ON DELETE CASCADE,
          attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(attempt_id) ON DELETE CASCADE,
          schema_version TEXT NOT NULL,
          validation_status TEXT NOT NULL CHECK (validation_status = 'valid'),
          normalized_result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_snapshots_project ON snapshots(project_id, created_at);
        CREATE INDEX idx_batches_status ON batches(status, created_at);
        CREATE INDEX idx_jobs_batch_status ON jobs(batch_id, status);
        CREATE INDEX idx_batch_jobs_job ON batch_jobs(job_id);
        CREATE INDEX idx_jobs_provider_model ON jobs(provider_id, model_id, created_at);
        CREATE INDEX idx_attempts_started ON attempts(request_started_at);
        CREATE UNIQUE INDEX idx_one_active_attempt_per_job
          ON attempts(job_id) WHERE status = 'in_progress';
      `);
      this.database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION};`);
    });
  }

  createBatch(input: CreateBatchInput): BatchRecord {
    this.assertOpen();
    requiredText(input.projectId, 'projectId');
    requiredText(input.sourceKind, 'sourceKind');
    requireSha256(input.contentHash, 'contentHash');
    requiredText(input.extractionVersion, 'extractionVersion');
    requiredText(input.ruleRegistryVersion, 'ruleRegistryVersion');
    requiredText(input.promptVersion, 'promptVersion');
    requiredText(input.schemaVersion, 'schemaVersion');
    if (!Number.isSafeInteger(input.plannedJobCount) || input.plannedJobCount < 0) {
      throw new RangeError('plannedJobCount must be a non-negative integer.');
    }
    const now = Date.now();
    const snapshotId = randomUUID();
    const batchId = randomUUID();

    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects (project_id, source_kind, project_label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             source_kind = excluded.source_kind,
             project_label = COALESCE(excluded.project_label, projects.project_label),
             updated_at = excluded.updated_at;`,
        )
        .run(
          input.projectId,
          input.sourceKind,
          input.projectLabel ?? null,
          now,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO snapshots (
             snapshot_id, project_id, content_hash, extraction_version,
             rule_registry_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, content_hash, extraction_version, rule_registry_version)
           DO NOTHING;`,
        )
        .run(
          snapshotId,
          input.projectId,
          input.contentHash,
          input.extractionVersion,
          input.ruleRegistryVersion,
          now,
        );
      const snapshotRow = this.database
        .prepare(
          `SELECT snapshot_id FROM snapshots
           WHERE project_id = ? AND content_hash = ? AND extraction_version = ?
             AND rule_registry_version = ?;`,
        )
        .get(
          input.projectId,
          input.contentHash,
          input.extractionVersion,
          input.ruleRegistryVersion,
        ) as DatabaseRow | undefined;
      if (!snapshotRow) {
        throw new Error('Could not resolve the persisted snapshot.');
      }
      this.database
        .prepare(
          `INSERT INTO batches (
             batch_id, project_id, snapshot_id, status, prompt_version,
             schema_version, planned_job_count, terminal_job_count, created_at
           ) VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, ?);`,
        )
        .run(
          batchId,
          input.projectId,
          toText(snapshotRow.snapshot_id),
          input.promptVersion,
          input.schemaVersion,
          input.plannedJobCount,
          now,
        );
    });

    const batch = this.getBatch(batchId);
    if (!batch) {
      throw new Error('The created AI batch could not be read back.');
    }
    return batch;
  }

  createJob(input: CreateJobInput): {
    job: JobRecord;
    created: boolean;
  } {
    this.assertOpen();
    requiredText(input.batchId, 'batchId');
    requiredText(input.componentId, 'componentId');
    requireSha256(input.contextHash, 'contextHash');
    requireSha256(input.requestPayloadHash, 'requestPayloadHash');
    requiredText(input.promptVersion, 'promptVersion');
    requiredText(input.schemaVersion, 'schemaVersion');
    requireSha256(input.modelConfigHash, 'modelConfigHash');
    const candidate = MODEL_CANDIDATES[input.modelId];
    if (!candidate || candidate.providerId !== input.providerId) {
      throw new TypeError('providerId does not match the candidate model.');
    }
    const ruleIds = [...new Set(input.ruleIds.map((id) => requiredText(id, 'ruleId')))].sort();
    const evidenceRefIds = [
      ...new Set(
        input.evidenceRefIds.map((id) => requiredText(id, 'evidenceRefId')),
      ),
    ].sort();
    if (ruleIds.length === 0) {
      throw new TypeError('At least one included rule is required.');
    }
    const batchRow = this.database
      .prepare(
        `SELECT b.project_id, b.snapshot_id, b.prompt_version, b.schema_version,
                s.content_hash, s.extraction_version, s.rule_registry_version
         FROM batches b
         JOIN snapshots s ON s.snapshot_id = b.snapshot_id
         WHERE b.batch_id = ?;`,
      )
      .get(input.batchId) as DatabaseRow | undefined;
    if (!batchRow) {
      throw new Error('The AI batch was not found.');
    }
    if (
      input.promptVersion !== toText(batchRow.prompt_version) ||
      input.schemaVersion !== toText(batchRow.schema_version)
    ) {
      throw new Error('Job prompt/schema versions must match the batch.');
    }
    const idempotencyKey = deriveJobIdempotencyKey(input, {
      projectId: toText(batchRow.project_id),
      contentHash: toText(batchRow.content_hash),
      extractionVersion: toText(batchRow.extraction_version),
      ruleRegistryVersion: toText(batchRow.rule_registry_version),
    });
    const now = Date.now();
    const jobId = randomUUID();

    const created = this.transaction(() => {
      const insert = this.database
        .prepare(
          `INSERT INTO jobs (
             job_id, batch_id, snapshot_id, idempotency_key, provider_id,
             model_id, component_id, context_hash, request_payload_hash,
             prompt_version, schema_version, model_config_hash, status,
             created_at, validation_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'not_run')
           ON CONFLICT(idempotency_key) DO NOTHING;`,
        )
        .run(
          jobId,
          input.batchId,
          toText(batchRow.snapshot_id),
          idempotencyKey,
          input.providerId,
          input.modelId,
          input.componentId,
          input.contextHash,
          input.requestPayloadHash,
          input.promptVersion,
          input.schemaVersion,
          input.modelConfigHash,
          now,
        );
      if (insert.changes === 0) {
        this.database
          .prepare(
            'INSERT INTO batch_jobs (batch_id, job_id) SELECT ?, job_id FROM jobs WHERE idempotency_key = ? ON CONFLICT(batch_id, job_id) DO NOTHING;',
          )
          .run(input.batchId, idempotencyKey);
        this.refreshBatchState(input.batchId);
        return false;
      }
      this.database
        .prepare('INSERT INTO batch_jobs (batch_id, job_id) VALUES (?, ?);')
        .run(input.batchId, jobId);
      const insertRule = this.database.prepare(
        'INSERT INTO job_rules (job_id, rule_id) VALUES (?, ?);',
      );
      for (const ruleId of ruleIds) {
        insertRule.run(jobId, ruleId);
      }
      const insertEvidence = this.database.prepare(
        'INSERT INTO job_evidence_refs (job_id, evidence_ref_id) VALUES (?, ?);',
      );
      for (const evidenceRefId of evidenceRefIds) {
        insertEvidence.run(jobId, evidenceRefId);
      }
      this.refreshBatchState(input.batchId);
      return true;
    });

    const job = this.getJobByIdempotencyKey(idempotencyKey);
    if (!job) {
      throw new Error('The created AI job could not be read back.');
    }
    return { job, created };
  }

  private refreshBatchState(batchId: string): void {
    const counts = this.database
      .prepare(
        `SELECT COUNT(*) AS job_count,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS running_count,
           SUM(CASE WHEN status IN (${TERMINAL_STATUSES.map(() => '?').join(', ')})
             THEN 1 ELSE 0 END) AS terminal_count,
           SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success_count
         FROM batch_jobs bj
         JOIN jobs j ON j.job_id = bj.job_id
         WHERE bj.batch_id = ?;`,
      )
      .get(...TERMINAL_STATUSES, batchId) as DatabaseRow;
    const batch = this.database
      .prepare('SELECT planned_job_count FROM batches WHERE batch_id = ?;')
      .get(batchId) as DatabaseRow | undefined;
    if (!batch) {
      throw new Error('The AI batch was not found while updating its state.');
    }
    const total = toNumber(counts.job_count);
    const running = toNumber(counts.running_count ?? 0);
    const terminal = toNumber(counts.terminal_count ?? 0);
    const succeeded = toNumber(counts.success_count ?? 0);
    const planned = Math.max(toNumber(batch.planned_job_count), total);
    const completedAt =
      terminal >= planned && planned > 0 ? Date.now() : null;
    const status: BatchStatus =
      total === 0 || (terminal < planned && running === 0)
        ? 'queued'
        : terminal < planned
          ? 'in_progress'
          : succeeded === planned
            ? 'succeeded'
            : succeeded === 0
              ? 'failed'
              : 'partial';
    this.database
      .prepare(
        `UPDATE batches
         SET status = ?, planned_job_count = ?, terminal_job_count = ?,
             completed_at = ?
         WHERE batch_id = ?;`,
      )
      .run(status, planned, terminal, completedAt, batchId);
  }

  private refreshBatchesForJob(jobId: string): void {
    const batches = this.database
      .prepare('SELECT batch_id FROM batch_jobs WHERE job_id = ?;')
      .all(jobId) as DatabaseRow[];
    for (const batch of batches) {
      this.refreshBatchState(toText(batch.batch_id));
    }
  }

  beginAttempt(
    jobId: string,
    options: BeginAttemptOptions = {},
  ): AttemptRecord {
    requiredText(jobId, 'jobId');
    const now = Date.now();
    const attemptId = randomUUID();
    this.transaction(() => {
      const job = this.database
        .prepare('SELECT status FROM jobs WHERE job_id = ?;')
        .get(jobId) as DatabaseRow | undefined;
      if (!job) {
        throw new Error('The AI job was not found.');
      }
      const status = toText(job.status) as JobStatus;
      if (status === 'queued') {
        // First attempt is allowed without a retry acknowledgement.
      } else if (status === 'retryable_failed' || status === 'invalid_response') {
        if (options.retryRequested !== true) {
          throw new Error('Retry requires explicit operator or scheduler authorization.');
        }
      } else if (status === 'unknown_outcome') {
        if (
          options.retryRequested !== true ||
          options.acknowledgePossibleDuplicate !== true
        ) {
          throw new Error(
            'Retrying an unknown outcome requires explicit duplicate-risk acknowledgement.',
          );
        }
      } else {
        throw new Error(`AI job in state ${status} cannot start an attempt.`);
      }

      const attemptNumberRow = this.database
        .prepare(
          'SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt FROM attempts WHERE job_id = ?;',
        )
        .get(jobId) as DatabaseRow;
      const attemptNumber = toNumber(attemptNumberRow.next_attempt);
      this.database
        .prepare(
          `INSERT INTO attempts (
             attempt_id, job_id, attempt_number, status, request_started_at,
             validation_status, owner_process_id, owner_host, owner_instance_id,
             lease_expires_at
           ) VALUES (?, ?, ?, 'in_progress', ?, 'not_run', ?, ?, ?, ?);`,
        )
        .run(
          attemptId,
          jobId,
          attemptNumber,
          now,
          this.ownerProcessId,
          this.ownerHost,
          this.ownerInstanceId,
          now + this.attemptLeaseMs,
        );
      this.database
        .prepare(
          `UPDATE jobs SET status = 'in_progress', started_at = ?, completed_at = NULL
           WHERE job_id = ?;`,
        )
        .run(now, jobId);
      this.refreshBatchesForJob(jobId);
    });

    const attempt = this.getAttempt(attemptId);
    if (!attempt) {
      throw new Error('The created AI attempt could not be read back.');
    }
    return attempt;
  }

  renewAttemptLease(jobId: string, attemptId: string): number {
    requiredText(jobId, 'jobId');
    requiredText(attemptId, 'attemptId');
    const now = Date.now();
    const renewed = this.transaction(() =>
      this.database
        .prepare(
          `UPDATE attempts SET lease_expires_at = ?
           WHERE attempt_id = ? AND job_id = ? AND status = 'in_progress'
             AND owner_process_id = ? AND owner_host = ?
             AND owner_instance_id = ?
             AND EXISTS (
               SELECT 1 FROM jobs
               WHERE jobs.job_id = attempts.job_id AND jobs.status = 'in_progress'
             );`,
        )
        .run(
          now + this.attemptLeaseMs,
          attemptId,
          jobId,
          this.ownerProcessId,
          this.ownerHost,
          this.ownerInstanceId,
        ).changes,
    );
    if (renewed !== 1) {
      throw new Error('The attempt lease is no longer owned by this ledger process.');
    }
    return now + this.attemptLeaseMs;
  }

  completeAttempt(
    jobId: string,
    attemptId: string,
    input: CompleteAttemptInput,
  ): JobRecord {
    requiredText(jobId, 'jobId');
    requiredText(attemptId, 'attemptId');
    for (const field of [
      ['inputTokens', input.inputTokens],
      ['outputTokens', input.outputTokens],
      ['estimatedInputTokens', input.estimatedInputTokens],
      ['estimatedOutputTokens', input.estimatedOutputTokens],
    ] as const) {
      assertTokenCount(field[1], field[0]);
    }
    if (
      input.retryAfterMs !== undefined &&
      input.retryAfterMs !== null &&
      (!Number.isSafeInteger(input.retryAfterMs) || input.retryAfterMs < 0)
    ) {
      throw new RangeError('retryAfterMs must be a non-negative integer or null.');
    }
    if (
      input.httpStatus !== undefined &&
      input.httpStatus !== null &&
      (!Number.isSafeInteger(input.httpStatus) ||
        input.httpStatus < 100 ||
        input.httpStatus > 599)
    ) {
      throw new RangeError('httpStatus must be a valid HTTP status or null.');
    }
    const isSuccess = input.status === 'succeeded';
    if (
      isSuccess &&
      (input.validationStatus !== 'valid' ||
        input.normalizedResult === undefined)
    ) {
      throw new Error(
        'A successful attempt requires a validated normalized result.',
      );
    }
    if (
      input.status === 'invalid_response' &&
      input.validationStatus !== 'invalid'
    ) {
      throw new Error(
        'An invalid_response attempt requires an invalid validation result.',
      );
    }
    if (!isSuccess && input.normalizedResult !== undefined) {
      throw new Error('Failed attempts cannot persist assessment results.');
    }
    const now = Date.now();
    const resultId = isSuccess ? randomUUID() : null;
    this.transaction(() => {
      const job = this.database
        .prepare(
          `SELECT status, schema_version, component_id, provider_id, model_id
           FROM jobs WHERE job_id = ?;`,
        )
        .get(jobId) as DatabaseRow | undefined;
      if (!job || toText(job.status) !== 'in_progress') {
        throw new Error('Only an in-progress AI job can complete an attempt.');
      }
      const attempt = this.database
        .prepare(
          `SELECT status, owner_process_id, owner_host, owner_instance_id
           FROM attempts WHERE attempt_id = ? AND job_id = ?;`,
        )
        .get(attemptId, jobId) as DatabaseRow | undefined;
      if (!attempt || toText(attempt.status) !== 'in_progress') {
        throw new Error('The AI attempt is missing or is no longer in progress.');
      }
      if (
        toNullableNumber(attempt.owner_process_id) !== this.ownerProcessId ||
        toNullableText(attempt.owner_host) !== this.ownerHost ||
        toNullableText(attempt.owner_instance_id) !== this.ownerInstanceId
      ) {
        throw new Error('The attempt is no longer owned by this ledger process.');
      }

      let normalizedResultJson: string | null = null;
      if (isSuccess) {
        const ruleIds = new Set(
          (
            this.database
              .prepare('SELECT rule_id FROM job_rules WHERE job_id = ?;')
              .all(jobId) as DatabaseRow[]
          ).map((rule) => toText(rule.rule_id)),
        );
        const evidenceRefIds = new Set(
          (
            this.database
              .prepare(
                'SELECT evidence_ref_id FROM job_evidence_refs WHERE job_id = ?;',
              )
              .all(jobId) as DatabaseRow[]
          ).map((reference) => toText(reference.evidence_ref_id)),
        );
        normalizedResultJson = JSON.stringify(
          validateAssessmentResult(
            input.normalizedResult,
            {
              componentId: toText(job.component_id),
              providerId: toText(job.provider_id),
              modelId: toText(job.model_id),
              schemaVersion: toText(job.schema_version),
            },
            ruleIds,
            evidenceRefIds,
          ),
        );
        if (
          Buffer.byteLength(normalizedResultJson, 'utf8') >
          MAX_NORMALIZED_RESULT_BYTES
        ) {
          throw new RangeError('The normalized assessment result exceeds 1 MB.');
        }
      }

      this.database
        .prepare(
          `UPDATE attempts SET status = ?, response_received_at = ?,
             provider_request_id = ?, http_status = ?, finish_reason = ?,
             retry_after_ms = ?, error_class = ?, input_tokens = ?,
             output_tokens = ?, estimated_input_tokens = ?,
             estimated_output_tokens = ?, validation_status = ?
           WHERE attempt_id = ?;`,
        )
        .run(
          input.status,
          now,
          input.providerRequestId ?? null,
          input.httpStatus ?? null,
          input.finishReason ?? null,
          input.retryAfterMs ?? null,
          input.errorClass ?? null,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.estimatedInputTokens ?? null,
          input.estimatedOutputTokens ?? null,
          input.validationStatus,
          attemptId,
        );

      if (isSuccess && resultId && normalizedResultJson !== null) {
        this.database
          .prepare(
            `INSERT INTO assessment_results (
               result_id, job_id, attempt_id, schema_version,
               validation_status, normalized_result_json, created_at
             ) VALUES (?, ?, ?, ?, 'valid', ?, ?);`,
          )
          .run(
            resultId,
            jobId,
            attemptId,
            toText(job.schema_version),
            normalizedResultJson,
            now,
          );
      }
      this.database
        .prepare(
          `UPDATE jobs SET status = ?, completed_at = ?, result_id = ?,
             validation_status = ?, input_tokens = ?, output_tokens = ?,
             estimated_input_tokens = ?, estimated_output_tokens = ?,
             error_class = ?, retry_after_ms = ?
           WHERE job_id = ?;`,
        )
        .run(
          input.status,
          now,
          resultId,
          input.validationStatus,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.estimatedInputTokens ?? null,
          input.estimatedOutputTokens ?? null,
          input.errorClass ?? null,
          input.retryAfterMs ?? null,
          jobId,
        );
      this.refreshBatchesForJob(jobId);
    });
    const completed = this.getJob(jobId);
    if (!completed) {
      throw new Error('The completed AI job could not be read back.');
    }
    return completed;
  }

  getBatch(batchId: string): BatchRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare('SELECT * FROM batches WHERE batch_id = ?;')
      .get(batchId) as DatabaseRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      batchId: toText(row.batch_id),
      projectId: toText(row.project_id),
      snapshotId: toText(row.snapshot_id),
      status: toText(row.status) as BatchStatus,
      promptVersion: toText(row.prompt_version),
      schemaVersion: toText(row.schema_version),
      plannedJobCount: toNumber(row.planned_job_count),
      terminalJobCount: toNumber(row.terminal_job_count),
      createdAt: toNumber(row.created_at),
      completedAt: toNullableNumber(row.completed_at),
    };
  }

  getJob(jobId: string): JobRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE job_id = ?;')
      .get(jobId) as DatabaseRow | undefined;
    return row ? this.toJobRecord(row) : undefined;
  }

  getJobByIdempotencyKey(idempotencyKey: string): JobRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE idempotency_key = ?;')
      .get(idempotencyKey) as DatabaseRow | undefined;
    return row ? this.toJobRecord(row) : undefined;
  }

  private toJobRecord(row: DatabaseRow): JobRecord {
    const jobId = toText(row.job_id);
    return {
      jobId,
      batchId: toText(row.batch_id),
      idempotencyKey: toText(row.idempotency_key),
      providerId: toText(row.provider_id) as AiProviderId,
      modelId: toText(row.model_id) as CandidateModelId,
      componentId: toText(row.component_id),
      ruleIds: (
        this.database
          .prepare('SELECT rule_id FROM job_rules WHERE job_id = ? ORDER BY rule_id;')
          .all(jobId) as DatabaseRow[]
      ).map((rule) => toText(rule.rule_id)),
      contextHash: toText(row.context_hash),
      evidenceRefIds: (
        this.database
          .prepare(
            'SELECT evidence_ref_id FROM job_evidence_refs WHERE job_id = ? ORDER BY evidence_ref_id;',
          )
          .all(jobId) as DatabaseRow[]
      ).map((evidence) => toText(evidence.evidence_ref_id)),
      requestPayloadHash: toText(row.request_payload_hash),
      promptVersion: toText(row.prompt_version),
      schemaVersion: toText(row.schema_version),
      modelConfigHash: toText(row.model_config_hash),
      status: toText(row.status) as JobStatus,
      createdAt: toNumber(row.created_at),
      startedAt: toNullableNumber(row.started_at),
      completedAt: toNullableNumber(row.completed_at),
      resultId: toNullableText(row.result_id),
      validationStatus: toText(row.validation_status) as ValidationStatus,
      inputTokens: toNullableNumber(row.input_tokens),
      outputTokens: toNullableNumber(row.output_tokens),
      errorClass: toNullableText(row.error_class),
      retryAfterMs: toNullableNumber(row.retry_after_ms),
    };
  }

  getAttempts(jobId: string): AttemptRecord[] {
    this.assertOpen();
    return (
      this.database
        .prepare(
          'SELECT * FROM attempts WHERE job_id = ? ORDER BY attempt_number;',
        )
        .all(jobId) as DatabaseRow[]
    ).map((row) => ({
      attemptId: toText(row.attempt_id),
      jobId: toText(row.job_id),
      attemptNumber: toNumber(row.attempt_number),
      status: toText(row.status) as AttemptStatus,
      requestStartedAt: toNumber(row.request_started_at),
      responseReceivedAt: toNullableNumber(row.response_received_at),
      providerRequestId: toNullableText(row.provider_request_id),
      httpStatus: toNullableNumber(row.http_status),
      finishReason: toNullableText(row.finish_reason),
      retryAfterMs: toNullableNumber(row.retry_after_ms),
      errorClass: toNullableText(row.error_class),
      inputTokens: toNullableNumber(row.input_tokens),
      outputTokens: toNullableNumber(row.output_tokens),
      estimatedInputTokens: toNullableNumber(row.estimated_input_tokens),
      estimatedOutputTokens: toNullableNumber(row.estimated_output_tokens),
      validationStatus: toText(row.validation_status) as ValidationStatus,
    }));
  }

  private getAttempt(attemptId: string): AttemptRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM attempts WHERE attempt_id = ?;')
      .get(attemptId) as DatabaseRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      attemptId: toText(row.attempt_id),
      jobId: toText(row.job_id),
      attemptNumber: toNumber(row.attempt_number),
      status: toText(row.status) as AttemptStatus,
      requestStartedAt: toNumber(row.request_started_at),
      responseReceivedAt: toNullableNumber(row.response_received_at),
      providerRequestId: toNullableText(row.provider_request_id),
      httpStatus: toNullableNumber(row.http_status),
      finishReason: toNullableText(row.finish_reason),
      retryAfterMs: toNullableNumber(row.retry_after_ms),
      errorClass: toNullableText(row.error_class),
      inputTokens: toNullableNumber(row.input_tokens),
      outputTokens: toNullableNumber(row.output_tokens),
      estimatedInputTokens: toNullableNumber(row.estimated_input_tokens),
      estimatedOutputTokens: toNullableNumber(row.estimated_output_tokens),
      validationStatus: toText(row.validation_status) as ValidationStatus,
    };
  }

  getAssessmentResult(jobId: string): AssessmentResultRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare('SELECT * FROM assessment_results WHERE job_id = ?;')
      .get(jobId) as DatabaseRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      resultId: toText(row.result_id),
      jobId: toText(row.job_id),
      attemptId: toText(row.attempt_id),
      schemaVersion: toText(row.schema_version),
      validationStatus: 'valid',
      normalizedResult: parseJsonValue(toText(row.normalized_result_json)),
      createdAt: toNumber(row.created_at),
    };
  }

  deleteProject(projectId: string): boolean {
    this.assertOpen();
    requiredText(projectId, 'projectId');
    return this.transaction(() => {
      const result = this.database
        .prepare('DELETE FROM projects WHERE project_id = ?;')
        .run(projectId);
      return result.changes > 0;
    });
  }

  recoverInterruptedJobs(): number {
    return this.transaction(() => {
      const now = Date.now();
      const candidates = this.database
        .prepare(`SELECT job_id FROM jobs WHERE status = 'in_progress';`)
        .all() as DatabaseRow[];
      let recovered = 0;
      for (const job of candidates) {
        const jobId = toText(job.job_id);
        const attempts = this.database
          .prepare(
            `SELECT attempt_id, owner_process_id, owner_host, owner_instance_id,
                    lease_expires_at
             FROM attempts WHERE job_id = ? AND status = 'in_progress';`,
          )
          .all(jobId) as DatabaseRow[];
        for (const attempt of attempts) {
          const ownerProcessId = toNullableNumber(attempt.owner_process_id);
          const leaseExpiresAt = toNullableNumber(attempt.lease_expires_at);
          const ownerHost = toNullableText(attempt.owner_host);
          const ownerInstanceId = toNullableText(attempt.owner_instance_id);
          if (
            ownerProcessId === null ||
            leaseExpiresAt === null ||
            ownerHost !== this.ownerHost ||
            ownerInstanceId === null ||
            leaseExpiresAt > now ||
            isProcessAlive(ownerProcessId)
          ) {
            continue;
          }
          const claim = this.database
            .prepare(
              `UPDATE attempts SET status = 'unknown_outcome',
                 response_received_at = ?, error_class = 'process_interrupted'
               WHERE attempt_id = ? AND job_id = ? AND status = 'in_progress'
                 AND owner_process_id = ? AND owner_host = ?
                 AND owner_instance_id = ? AND lease_expires_at <= ?;`,
            )
            .run(
              now,
              toText(attempt.attempt_id),
              jobId,
              ownerProcessId,
              ownerHost,
              ownerInstanceId,
              now,
            );
          if (claim.changes !== 1) {
            continue;
          }
          this.database
            .prepare(
              `UPDATE jobs SET status = 'unknown_outcome', completed_at = ?,
                 error_class = 'process_interrupted', validation_status = 'not_run'
               WHERE job_id = ? AND status = 'in_progress';`,
            )
            .run(now, jobId);
          this.refreshBatchesForJob(jobId);
          recovered += 1;
        }
      }
      return recovered;
    });
  }

  cleanupExpiredTerminalJobs(now = Date.now()): number {
    this.assertOpen();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError('now must be an integer timestamp.');
    }
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `DELETE FROM jobs
           WHERE status NOT IN ('queued', 'in_progress')
             AND completed_at IS NOT NULL AND completed_at < ?;`,
        )
        .run(cutoff);
      return Number(result.changes);
    });
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
