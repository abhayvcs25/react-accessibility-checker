import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';
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

function validAssessment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    targetId: 'component-1',
    ruleId: 'color-contrast',
    status: 'potential_issue',
    explanation: 'Violation: A visible text/background contrast issue was detected.',
    evidenceRefs: ['evidence-1'],
    confidence: 0.8,
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
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
      normalizedResult: validAssessment(),
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
    expect(new Set([
      initial.job.idempotencyKey,
      changedSnapshot.job.idempotencyKey,
      otherModel.job.idempotencyKey,
      changedPrompt.job.idempotencyKey,
    ]).size).toBe(4);
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

  it('includes request payload and canonical evidence references in job identity', () => {
    const batch = createBatch();
    const baseline = ledger.createJob(
      jobInput(batch.batchId, { evidenceRefIds: ['evidence-1', 'evidence-2'] }),
    );
    const reorderedEvidence = ledger.createJob(
      jobInput(batch.batchId, {
        evidenceRefIds: ['evidence-2', 'evidence-1', 'evidence-1'],
      }),
    );
    const changedPayload = ledger.createJob(
      jobInput(batch.batchId, { requestPayloadHash: hash('different-request') }),
    );
    const changedEvidence = ledger.createJob(
      jobInput(batch.batchId, { evidenceRefIds: ['evidence-3'] }),
    );

    expect(reorderedEvidence.created).toBe(false);
    expect(reorderedEvidence.job.jobId).toBe(baseline.job.jobId);
    expect(changedPayload.created).toBe(true);
    expect(changedEvidence.created).toBe(true);
    expect(new Set([
      baseline.job.idempotencyKey,
      changedPayload.job.idempotencyKey,
      changedEvidence.job.idempotencyKey,
    ]).size).toBe(3);
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
                    error?: string;
                  }) => {
                    if (message.ready) {
                      return;
                    }
                    if (message.error) {
                      reject(new Error(message.error));
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
      normalizedResult: validAssessment(),
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

  it('does not recover a live process owner and fences other ledger instances', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    const database = new DatabaseSync(ledgerPath);
    database
      .prepare('UPDATE attempts SET lease_expires_at = ? WHERE attempt_id = ?;')
      .run(Date.now() - 1, attempt.attemptId);
    database.close();
    const competingLedger = new BatchLedger({ filePath: ledgerPath });

    expect(competingLedger.recoverInterruptedJobs()).toBe(0);
    expect(() =>
      competingLedger.renewAttemptLease(job.jobId, attempt.attemptId),
    ).toThrow('The attempt lease is no longer owned by this ledger process.');
    expect(() =>
      competingLedger.completeAttempt(job.jobId, attempt.attemptId, {
        status: 'succeeded',
        validationStatus: 'valid',
        normalizedResult: validAssessment(),
      }),
    ).toThrow('The attempt is no longer owned by this ledger process.');
    expect(ledger.getJob(job.jobId)?.status).toBe('in_progress');
    expect(ledger.renewAttemptLease(job.jobId, attempt.attemptId)).toBeGreaterThan(
      Date.now(),
    );
    competingLedger.close();

    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'succeeded',
      validationStatus: 'valid',
      normalizedResult: validAssessment(),
    });
    expect(ledger.getJob(job.jobId)?.status).toBe('succeeded');
  });

  it('does not recover a separate live process after its lease expires', async () => {
    const childScript = `
      import { BatchLedger } from './src/ai/batchLedger.ts';
      const payload = JSON.parse(process.env.RAC_TEST_PAYLOAD);
      const ledger = new BatchLedger({ filePath: process.env.RAC_TEST_LEDGER_PATH });
      const batch = ledger.createBatch(payload.batch);
      const job = ledger.createJob({ ...payload.job, batchId: batch.batchId }).job;
      const attempt = ledger.beginAttempt(job.jobId);
      console.log(JSON.stringify({ ready: true, jobId: job.jobId, attemptId: attempt.attemptId }));
      process.stdin.once('data', () => {
        try {
          const completed = ledger.completeAttempt(job.jobId, attempt.attemptId, payload.completion);
          console.log(JSON.stringify({ completed: completed.status === 'succeeded' }));
        } catch (error) {
          console.log(JSON.stringify({ failure: error.message }));
          process.exitCode = 1;
        } finally {
          ledger.close();
        }
      });
    `;
    const child = spawn(
      process.execPath,
      [
        '--import',
        './node_modules/tsx/dist/loader.mjs',
        '--input-type=module',
        '-e',
        childScript,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RAC_TEST_LEDGER_PATH: ledgerPath,
          RAC_TEST_PAYLOAD: JSON.stringify({
            batch: { ...batchInput, plannedJobCount: 1 },
            job: jobInput('batch-created-by-child'),
            completion: {
              status: 'succeeded',
              validationStatus: 'valid',
              normalizedResult: validAssessment(),
            },
          }),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const output = createInterface({ input: child.stdout });
    let childStderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      childStderr += chunk.toString();
    });
    const messages = (async function* () {
      for await (const line of output) {
        yield JSON.parse(line) as {
          ready?: boolean;
          jobId?: string;
          attemptId?: string;
          completed?: boolean;
          failure?: string;
        };
      }
    })();

    try {
      const ready = await messages.next();
      if (!ready.value?.ready) {
        throw new Error(`The child process failed to start: ${childStderr}`);
      }
      const jobId = ready.value?.jobId;
      const attemptId = ready.value?.attemptId;
      if (!jobId || !attemptId) {
        throw new Error('The child process did not return its active attempt.');
      }

      const database = new DatabaseSync(ledgerPath);
      database
        .prepare('UPDATE attempts SET lease_expires_at = ? WHERE attempt_id = ?;')
        .run(Date.now() - 1, attemptId);
      database.close();

      expect(ledger.recoverInterruptedJobs()).toBe(0);
      child.stdin.end('complete\n');
      const completion = await messages.next();
      expect(completion.value?.completed).toBe(true);
      expect(completion.value?.failure).toBeUndefined();
      expect(ledger.getJob(jobId)?.status).toBe('succeeded');
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      expect(exitCode).toBe(0);
    } finally {
      output.close();
      if (child.exitCode === null) {
        child.kill();
      }
    }
  }, 15_000);

  it('atomically recovers only expired leases owned by dead processes', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    const deadProcessId = Number(
      execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        { encoding: 'utf8' },
      ),
    );
    expect(Number.isSafeInteger(deadProcessId)).toBe(true);

    const database = new DatabaseSync(ledgerPath);
    database
      .prepare(
        'UPDATE attempts SET owner_process_id = ?, lease_expires_at = ? WHERE attempt_id = ?;',
      )
      .run(deadProcessId, Date.now() - 1, attempt.attemptId);
    database.close();
    const competingLedger = new BatchLedger({ filePath: ledgerPath });

    const recoveryResults = [
      ledger.recoverInterruptedJobs(),
      competingLedger.recoverInterruptedJobs(),
    ];
    competingLedger.close();

    expect(recoveryResults).toEqual([1, 0]);
    expect(ledger.getJob(job.jobId)?.status).toBe('unknown_outcome');
    expect(ledger.getAttempts(job.jobId)).toMatchObject([
      {
        attemptId: attempt.attemptId,
        status: 'unknown_outcome',
        errorClass: 'process_interrupted',
      },
    ]);
    const retry = ledger.beginAttempt(job.jobId, {
      retryRequested: true,
      acknowledgePossibleDuplicate: true,
    });
    expect(retry.attemptId).not.toBe(attempt.attemptId);
    expect(() =>
      ledger.completeAttempt(job.jobId, attempt.attemptId, {
        status: 'succeeded',
        validationStatus: 'valid',
        normalizedResult: validAssessment(),
      }),
    ).toThrow('The AI attempt is missing or is no longer in progress.');
  });

  it('migrates schema v1 without claiming or recovering ownerless active attempts', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.close();

    const legacyDatabase = new DatabaseSync(ledgerPath);
    legacyDatabase.exec(`
      DROP INDEX idx_one_active_attempt_per_job;
      ALTER TABLE attempts DROP COLUMN lease_expires_at;
      ALTER TABLE attempts DROP COLUMN owner_instance_id;
      ALTER TABLE attempts DROP COLUMN owner_host;
      ALTER TABLE attempts DROP COLUMN owner_process_id;
      PRAGMA user_version = 1;
    `);
    legacyDatabase.close();
    ledger = new BatchLedger({ filePath: ledgerPath });

    expect(ledger.recoverInterruptedJobs()).toBe(0);
    expect(ledger.getJob(job.jobId)?.status).toBe('in_progress');
    expect(ledger.getAttempts(job.jobId)[0]?.status).toBe('in_progress');
    expect(() =>
      ledger.completeAttempt(job.jobId, attempt.attemptId, {
        status: 'succeeded',
        validationStatus: 'valid',
        normalizedResult: validAssessment(),
      }),
    ).toThrow('The attempt is no longer owned by this ledger process.');
  });

  it('rejects results with incompatible schema or mismatched job/evidence identity', () => {
    const invalidCases = [
      {
        name: 'unknown schema version',
        schemaVersion: 'schema-v2',
        result: validAssessment(),
      },
      {
        name: 'wrong target',
        schemaVersion: 'schema-v1',
        result: validAssessment({ targetId: 'other-component' }),
      },
      {
        name: 'unpermitted evidence',
        schemaVersion: 'schema-v1',
        result: validAssessment({ evidenceRefs: ['not-in-job-context'] }),
      },
      {
        name: 'unassigned rule',
        schemaVersion: 'schema-v1',
        result: validAssessment({ ruleId: 'unassigned-rule' }),
      },
      {
        name: 'wrong provider identity',
        schemaVersion: 'schema-v1',
        result: validAssessment({ providerId: 'cloudflare-workers-ai' }),
      },
    ];

    for (const [index, invalidCase] of invalidCases.entries()) {
      const batch = createBatch({
        contentHash: hash(`invalid-result-${index}`),
        schemaVersion: invalidCase.schemaVersion,
      });
      const job = ledger.createJob(
        jobInput(batch.batchId, { schemaVersion: invalidCase.schemaVersion }),
      ).job;
      const attempt = ledger.beginAttempt(job.jobId);

      expect(
        () =>
          ledger.completeAttempt(job.jobId, attempt.attemptId, {
            status: 'succeeded',
            validationStatus: 'valid',
            normalizedResult: invalidCase.result,
          }),
        invalidCase.name,
      ).toThrow();
      expect(ledger.getJob(job.jobId)?.status).toBe('in_progress');
      expect(ledger.getAttempts(job.jobId)[0]?.status).toBe('in_progress');
      expect(ledger.getAssessmentResult(job.jobId)).toBeUndefined();
    }
  });

  it('rolls back attempt and job changes if result persistence fails', () => {
    const batch = createBatch();
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    const database = new DatabaseSync(ledgerPath);
    database.exec(`
      CREATE TRIGGER reject_assessment_result
      BEFORE INSERT ON assessment_results
      BEGIN
        SELECT RAISE(ABORT, 'injected result persistence failure');
      END;
    `);
    database.close();

    expect(() =>
      ledger.completeAttempt(job.jobId, attempt.attemptId, {
        status: 'succeeded',
        validationStatus: 'valid',
        normalizedResult: validAssessment(),
      }),
    ).toThrow('injected result persistence failure');
    expect(ledger.getJob(job.jobId)?.status).toBe('in_progress');
    expect(ledger.getAttempts(job.jobId)[0]?.status).toBe('in_progress');
    expect(ledger.getAssessmentResult(job.jobId)).toBeUndefined();
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
    expect(ledger.getBatch(batch.batchId)).toBeDefined();
    const database = new DatabaseSync(ledgerPath, { readOnly: true });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM projects WHERE project_id = ?;')
        .get(batch.projectId),
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM snapshots WHERE snapshot_id = ?;')
        .get(batch.snapshotId),
    ).toMatchObject({ count: 1 });
    database.close();
  });

  it('deletes project data and all linked batch/job/result records', () => {
    const batch = createBatch({ plannedJobCount: 1 });
    const job = ledger.createJob(jobInput(batch.batchId)).job;
    const attempt = ledger.beginAttempt(job.jobId);
    ledger.completeAttempt(job.jobId, attempt.attemptId, {
      status: 'succeeded',
      validationStatus: 'valid',
      normalizedResult: validAssessment(),
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
