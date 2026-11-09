import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchLedger, type CreateJobInput } from '../../src/ai/batchLedger.js';

let temporaryDirectory: string;
let ledgerPath: string;
let ledger: BatchLedger;

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const batchInput = {
  projectId: 'project-test-1',
  sourceKind: 'uploaded-html',
  contentHash: hash('content-hash-v1'),
  extractionVersion: 'extractor-v1',
  ruleRegistryVersion: 'rules-v1',
  promptVersion: 'prompt-v1',
  schemaVersion: 'schema-v1',
  plannedJobCount: 2,
} as const;

function createBatch(overrides: Partial<typeof batchInput> = {}) {
  return ledger.createBatch({ ...batchInput, ...overrides });
}

function jobInput(
  batchId: string,
  overrides: Partial<CreateJobInput> = {},
): CreateJobInput {
  return {
    batchId,
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    componentId: 'component-1',
    ruleIds: ['color-contrast'],
    contextHash: hash('context-hash-v1'),
    evidenceRefIds: ['evidence-1'],
    requestPayloadHash: hash('request-hash-v1'),
    promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1',
    modelConfigHash: hash('model-config-v1'),
    ...overrides,
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'rac-ai-batch-ledger-'));
  ledgerPath = join(temporaryDirectory, 'batch-ledger.sqlite');
  ledger = new BatchLedger({ filePath: ledgerPath });
});

afterEach(() => {
  vi.useRealTimers();
  ledger.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('persistent AI batch ledger', () => {
  it('creates durable batch, snapshot, job, rules, and evidence references', () => {
    const batch = createBatch();
    const created = ledger.createJob(jobInput(batch.batchId));

    expect(batch).toMatchObject({
      projectId: batchInput.projectId,
      status: 'queued',
      promptVersion: batchInput.promptVersion,
      schemaVersion: batchInput.schemaVersion,
      plannedJobCount: 2,
      terminalJobCount: 0,
    });
    expect(created.created).toBe(true);
    expect(created.job).toMatchObject({
      batchId: batch.batchId,
      providerId: 'groq',
      modelId: 'openai/gpt-oss-20b',
      componentId: 'component-1',
      ruleIds: ['color-contrast'],
      evidenceRefIds: ['evidence-1'],
      status: 'queued',
      validationStatus: 'not_run',
    });
    expect(created.job.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.getBatch(batch.batchId)?.status).toBe('queued');
  });

  it('atomically reuses an identical job submission', () => {
    const firstBatch = createBatch({ plannedJobCount: 1 });
    const first = ledger.createJob(jobInput(firstBatch.batchId));
    const attempt = ledger.beginAttempt(first.job.jobId);
    ledger.completeAttempt(first.job.jobId, attempt.attemptId, {
      status: 'succeeded',
      validationStatus: 'valid',
      normalizedResult: { status: 'pass' },
    });
    const secondBatch = createBatch({ plannedJobCount: 1 });
    const duplicate = ledger.createJob(jobInput(secondBatch.batchId));

    expect(duplicate.created).toBe(false);
    expect(duplicate.job.jobId).toBe(first.job.jobId);
    expect(duplicate.job.idempotencyKey).toBe(first.job.idempotencyKey);
    expect(duplicate.job.batchId).toBe(firstBatch.batchId);
    expect(duplicate.job.status).toBe('succeeded');
    expect(ledger.getBatch(secondBatch.batchId)).toMatchObject({
      status: 'succeeded',
      terminalJobCount: 1,
    });
  });

  it('keeps changed snapshots, prompt versions, and model IDs independent', () => {
    const initialBatch = createBatch();
    const initial = ledger.createJob(jobInput(initialBatch.batchId));
    const changedSnapshotBatch = createBatch({
      contentHash: hash('content-hash-v2'),
    });
    const changedSnapshot = ledger.createJob(
      jobInput(changedSnapshotBatch.batchId),
    );
    const otherModelBatch = createBatch({
      contentHash: hash('content-hash-v3'),
    });
    const otherModel = ledger.createJob(
      jobInput(otherModelBatch.batchId, {
        modelId: 'openai/gpt-oss-120b',
      }),
    );
    const changedPromptBatch = createBatch({
      contentHash: hash('content-hash-v4'),
      promptVersion: 'prompt-v2',
    });
    const changedPrompt = ledger.createJob(
      jobInput(changedPromptBatch.batchId, { promptVersion: 'prompt-v2' }),
    );
    const changedSchemaBatch = createBatch({
      contentHash: hash('content-hash-v5'),
      schemaVersion: 'schema-v2',
    });
    const changedSchema = ledger.createJob(
      jobInput(changedSchemaBatch.batchId, { schemaVersion: 'schema-v2' }),
    );

    expect(new Set([
      initial.job.idempotencyKey,
      changedSnapshot.job.idempotencyKey,
      otherModel.job.idempotencyKey,
      changedPrompt.job.idempotencyKey,
      changedSchema.job.idempotencyKey,
    ]).size).toBe(5);
    expect(otherModel.job.modelId).toBe('openai/gpt-oss-120b');
  });

  it('enforces unique idempotency across independent database connections', () => {
    const batch = createBatch();
    const secondConnection = new BatchLedger({ filePath: ledgerPath });
    try {
      const inputs = [
        jobInput(batch.batchId),
        jobInput(batch.batchId),
        jobInput(batch.batchId),
      ];
      const results = inputs.map((input) => ledger.createJob(input));
      const crossConnection = secondConnection.createJob(inputs[0]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(crossConnection.created).toBe(false);
      expect(
        new Set(results.map((result) => result.job.jobId)).size,
      ).toBe(1);
    } finally {
      secondConnection.close();
    }
  });

  it('creates one durable job when independent workers race on the same key', async () => {
    const batch = createBatch({ plannedJobCount: 1 });
    const input = jobInput(batch.batchId);
    const inspectionDatabase = new DatabaseSync(ledgerPath, {
      readOnly: true,
    });
    const snapshotRow = inspectionDatabase
      .prepare('SELECT snapshot_id FROM snapshots WHERE project_id = ?;')
      .get(batch.projectId) as { snapshot_id: string };
    inspectionDatabase.close();
    ledger.close();
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const { randomUUID } = require('node:crypto');
      const database = new DatabaseSync(workerData.filePath, { timeout: 5000 });
      database.exec('PRAGMA busy_timeout = 5000;');
      parentPort.postMessage({ ready: true });
      const gate = new Int32Array(workerData.gate);
      Atomics.wait(gate, 1, 0);
      database.exec('BEGIN IMMEDIATE;');
      const jobId = randomUUID();
      const result = database.prepare(
        \`INSERT INTO jobs (
           job_id, batch_id, snapshot_id, idempotency_key, provider_id,
           model_id, component_id, context_hash, request_payload_hash,
           prompt_version, schema_version, model_config_hash, status,
           created_at, validation_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'not_run')
         ON CONFLICT(idempotency_key) DO NOTHING;\`
      ).run(
        jobId, workerData.input.batchId, workerData.snapshotId,
        workerData.idempotencyKey, workerData.input.providerId,
        workerData.input.modelId, workerData.input.componentId,
        workerData.input.contextHash, workerData.input.requestPayloadHash,
        workerData.input.promptVersion, workerData.input.schemaVersion,
        workerData.input.modelConfigHash, Date.now()
      );
      if (result.changes === 1) {
        database.prepare(
          'INSERT INTO batch_jobs (batch_id, job_id) VALUES (?, ?);'
        ).run(workerData.input.batchId, jobId);
        for (const ruleId of workerData.input.ruleIds) {
          database.prepare(
            'INSERT INTO job_rules (job_id, rule_id) VALUES (?, ?);'
          ).run(jobId, ruleId);
        }
        for (const evidenceRefId of workerData.input.evidenceRefIds) {
          database.prepare(
            'INSERT INTO job_evidence_refs (job_id, evidence_ref_id) VALUES (?, ?);'
          ).run(jobId, evidenceRefId);
        }
      }
      const row = database.prepare(
        'SELECT job_id FROM jobs WHERE idempotency_key = ?;'
      ).get(workerData.idempotencyKey);
      database.exec('COMMIT;');
      database.close();
      parentPort.postMessage({
        created: result.changes === 1,
        jobId: row.job_id
      });
    `;
    const workers = [0, 1].map(
      () =>
        new Worker(workerSource, {
          eval: true,
          workerData: {
            filePath: ledgerPath,
            input,
            snapshotId: snapshotRow.snapshot_id,
            idempotencyKey: 'c'.repeat(64),
            gate,
          },
        }),
    );
    try {
      await Promise.all(
        workers.map(
          (worker) =>
            new Promise<void>((resolve, reject) => {
              worker.once('error', reject);
              worker.on('message', (message: { ready?: boolean }) => {
                if (message.ready) {
                  resolve();
                }
              });
            }),
        ),
      );
      Atomics.store(new Int32Array(gate), 1, 1);
      Atomics.notify(new Int32Array(gate), 1);
      const results = await Promise.all(
        workers.map(
          (worker) =>
            new Promise<{ created: boolean; jobId: string }>(
              (resolve, reject) => {
                worker.once('error', reject);
                worker.on(
                  'message',
                  (message: {
                    ready?: boolean;
                    created?: boolean;
                    jobId?: string;
                  }) => {
                    if (message.ready) {
                      return;
                    }
                    if (typeof message.created !== 'boolean' || !message.jobId) {
                      reject(new Error('Worker returned an invalid result.'));
                      return;
                    }
                    resolve({
                      created: message.created,
                      jobId: message.jobId,
                    });
                  },
                );
              },
            ),
        ),
      );

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      ledger = new BatchLedger({ filePath: ledgerPath });
    }
  });

  it('persists successful validated results across a ledger restart', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'succeeded',
      providerRequestId: 'provider-request-1',
      inputTokens: 20,
      outputTokens: 12,
      estimatedInputTokens: 18,
      estimatedOutputTokens: 16,
      validationStatus: 'valid',
      normalizedResult: {
        ruleId: 'color-contrast',
        targetId: 'component-1',
        status: 'pass',
        evidenceRefs: ['evidence-1'],
      },
    });

    ledger.close();
    ledger = new BatchLedger({ filePath: ledgerPath });

    expect(ledger.getJob(job.jobId)?.status).toBe('succeeded');
    expect(ledger.getJob(job.jobId)?.resultId).not.toBeNull();
    expect(ledger.getAssessmentResult(job.jobId)).toMatchObject({
      jobId: job.jobId,
      validationStatus: 'valid',
      normalizedResult: {
        ruleId: 'color-contrast',
        targetId: 'component-1',
      },
    });
    expect(ledger.getAttempts(job.jobId)).toMatchObject([
      {
        attemptNumber: 1,
        status: 'succeeded',
        providerRequestId: 'provider-request-1',
        inputTokens: 20,
        outputTokens: 12,
        estimatedInputTokens: 18,
        estimatedOutputTokens: 16,
        validationStatus: 'valid',
      },
    ]);
  });

  it('reuses an in-flight job rather than creating duplicate work', () => {
    const batch = createBatch({ plannedJobCount: 1 });
    const first = ledger.createJob(jobInput(batch.batchId));
    ledger.beginAttempt(first.job.jobId);
    const duplicate = ledger.createJob(jobInput(batch.batchId));

    expect(duplicate.created).toBe(false);
    expect(duplicate.job.jobId).toBe(first.job.jobId);
    expect(duplicate.job.status).toBe('in_progress');
    expect(ledger.getAttempts(first.job.jobId)).toHaveLength(1);
  });

  it('requires explicit retries and records every attempt', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const firstAttempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, firstAttempt.attemptId, {
      status: 'retryable_failed',
      errorClass: 'rate_limited',
      retryAfterMs: 1_000,
      validationStatus: 'not_run',
    });

    expect(() => ledger.beginAttempt(job.jobId)).toThrow(
      'Retry requires explicit operator or scheduler authorization.',
    );
    const secondAttempt = ledger.beginAttempt(job.jobId, {
      retryRequested: true,
    });
    expect(secondAttempt.attemptNumber).toBe(2);
    expect(ledger.getAttempts(job.jobId)).toHaveLength(2);
  });

  it('requires acknowledgement before retrying an uncertain outcome', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'unknown_outcome',
      errorClass: 'process_interrupted',
      validationStatus: 'not_run',
    });

    expect(() =>
      ledger.beginAttempt(job.jobId, { retryRequested: true }),
    ).toThrow('Retrying an unknown outcome requires explicit duplicate-risk acknowledgement.');
    const retry = ledger.beginAttempt(job.jobId, {
      retryRequested: true,
      acknowledgePossibleDuplicate: true,
    });
    expect(retry.attemptNumber).toBe(2);
  });

  it('does not retry permanent or blocked failures', () => {
    for (const status of ['permanent_failed', 'blocked'] as const) {
      const batch = createBatch({ contentHash: hash(`snapshot-${status}`) });
      const job = ledger.createJob(jobInput(batch.batchId)).job;
      const attempt = ledger.beginAttempt(job.jobId);
      ledger.completeAttempt(job.jobId, attempt.attemptId, {
        status,
        errorClass: status,
        validationStatus: 'not_run',
      });

      expect(() =>
        ledger.beginAttempt(job.jobId, { retryRequested: true }),
      ).toThrow(`AI job in state ${status} cannot start an attempt.`);
    }
  });

  it('marks interrupted in-progress attempts as uncertain on recovery', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);

    expect(ledger.recoverInterruptedJobs()).toBe(1);
    expect(ledger.getJob(job.jobId)?.status).toBe('unknown_outcome');
    expect(ledger.getAttempts(job.jobId)).toMatchObject([
      {
        attemptId: attempt.attemptId,
        status: 'unknown_outcome',
        errorClass: 'process_interrupted',
      },
    ]);
  });

  it('expires terminal jobs after seven days but preserves active jobs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T00:00:00.000Z'));
    const batch = createBatch();
    const doneJob = ledger.createJob(jobInput(batch.batchId)).job;
    const doneAttempt = ledger.beginAttempt(doneJob.jobId);
    ledger.completeAttempt(doneJob.jobId, doneAttempt.attemptId, {
      status: 'permanent_failed',
      errorClass: 'invalid_request',
      validationStatus: 'not_run',
    });
    const activeJob = ledger.createJob(
      jobInput(batch.batchId, { componentId: 'active-component' }),
    ).job;
    ledger.beginAttempt(activeJob.jobId);

    const expiredAt = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(ledger.cleanupExpiredTerminalJobs(expiredAt)).toBe(1);
    expect(ledger.getJob(doneJob.jobId)).toBeUndefined();
    expect(ledger.getAttempts(doneJob.jobId)).toEqual([]);
    expect(ledger.getJob(activeJob.jobId)?.status).toBe('in_progress');
  });

  it('deletes project data and all linked batch/job/result records', () => {
    const batch = createBatch({ plannedJobCount: 1 });
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'succeeded',
      validationStatus: 'valid',
      normalizedResult: { status: 'pass' },
    });

    expect(ledger.deleteProject(batch.projectId)).toBe(true);
    expect(ledger.deleteProject(batch.projectId)).toBe(false);
    expect(ledger.getBatch(batch.batchId)).toBeUndefined();
    expect(ledger.getJob(job.jobId)).toBeUndefined();
    expect(ledger.getAttempts(job.jobId)).toEqual([]);
    expect(ledger.getAssessmentResult(job.jobId)).toBeUndefined();
  });

  it('honors configured seven-day retention and rejects unsafe schema versions', () => {
    const configured = new BatchLedger({
      filePath: join(temporaryDirectory, 'configured.sqlite'),
      environment: { USAGE_LEDGER_RETENTION_DAYS: '7' },
    });
    expect(configured.retentionDays).toBe(7);
    configured.close();
    expect(
      () =>
        new BatchLedger({
          filePath: join(temporaryDirectory, 'invalid-retention.sqlite'),
          environment: { USAGE_LEDGER_RETENTION_DAYS: '0' },
        }),
    ).toThrow('USAGE_LEDGER_RETENTION_DAYS must be an integer');

    const unsupportedPath = join(temporaryDirectory, 'future-schema.sqlite');
    const futureDatabase = new DatabaseSync(unsupportedPath);
    futureDatabase.exec('PRAGMA user_version = 99;');
    futureDatabase.close();
    expect(
      () => new BatchLedger({ filePath: unsupportedPath }),
    ).toThrow('Unsupported AI batch ledger schema version 99');
  });

  it('leaves the existing JSON usage ledger untouched and never imports raw responses', () => {
    const usagePath = join(temporaryDirectory, 'existing-usage.json');
    const historicalUsage = '{"version":1,"days":[]}';
    writeFileSync(usagePath, historicalUsage, 'utf8');
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'invalid_response',
      errorClass: 'schema_validation_failed',
      validationStatus: 'invalid',
    });

    expect(readFileSync(usagePath, 'utf8')).toBe(historicalUsage);
    const inspectionDatabase = new DatabaseSync(ledgerPath, {
      readOnly: true,
    });
    const tables = inspectionDatabase
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all()
      .map((row) => (row as { name: string }).name);
    inspectionDatabase.close();
    expect(tables).not.toContain('raw_provider_responses');
  });

  it('requires a valid result before marking a job successful', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);

    expect(() =>
      ledger.completeAttempt(job.jobId, attempt.attemptId, {
        status: 'succeeded',
        validationStatus: 'not_run',
      }),
    ).toThrow('A successful attempt requires a validated normalized result.');
    expect(ledger.getJob(job.jobId)?.status).toBe('in_progress');
  });
});
