import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchLedger } from '../../src/ai/batchLedger.js';
import type { EligibleModelCandidate } from '../../src/ai/config.js';
import type {
  SchedulerBatchInput,
  SchedulerRunResult,
} from '../../src/ai/scheduler.js';
import {
  adaptContextSnapshotV2,
} from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import { runContextualAssessmentJobs } from '../../src/services/contextualAssessmentScheduler.js';

const html = '<!doctype html><html><body><button>Continue</button></body></html>';
const filename = 'sample.html';

const model = {
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
  applicationMaxOutputTokens: 512,
} as unknown as EligibleModelCandidate;

function createScheduler(
  status: SchedulerRunResult['jobs'][number]['status'] = 'succeeded',
) {
  let preparedRequest: ReturnType<
    SchedulerBatchInput['assessments'][number]['prepare']
  > | undefined;
  const scheduler = {
    run: vi.fn(async (batches: readonly SchedulerBatchInput[]) => {
      const batch = batches[0];
      const assessment = batch?.assessments[0];
      if (!batch || !assessment) {
        throw new Error('Expected one prepared assessment.');
      }
      preparedRequest = assessment.prepare(model);
      const normalizedResult =
        status === 'succeeded'
          ? {
              targetId: preparedRequest.job.componentId,
              ruleId: preparedRequest.job.ruleIds[0] ?? '',
              status: 'potential_issue',
              explanation: 'The available label may not explain the action.',
              evidenceRefs: [...preparedRequest.sentEvidenceRefIds],
              providerId: model.providerId,
              modelId: model.modelId,
            }
          : null;
      return {
        batches: [],
        jobs: [
          {
            batchId: 'batch-1',
            jobId: 'job-1',
            providerId: model.providerId,
            modelId: model.modelId,
            componentId: preparedRequest.job.componentId,
            ruleId: preparedRequest.job.ruleIds[0] ?? '',
            status,
            errorClass: status === 'succeeded' ? null : 'provider_authentication',
            result: normalizedResult,
          },
        ],
        blockedModels: [],
        preflightIssues: [],
      } satisfies SchedulerRunResult;
    }),
  };
  return {
    scheduler,
    getPreparedRequest: () => preparedRequest,
  };
}

describe('contextual assessment scheduler integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not invoke scheduling when credentials exist without explicit opt-in', async () => {
    const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
    const disabledScheduler = createScheduler().scheduler;

    await expect(
      runContextualAssessmentJobs(context, html, filename, {
        environment: {
          GROQ_API_KEY: 'test-groq-secret-placeholder',
          CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
          CLOUDFLARE_API_TOKEN: 'test-cloudflare-secret-placeholder',
        },
        scheduler: disabledScheduler,
      }),
    ).resolves.toEqual({ outcomes: [] });
    expect(disabledScheduler.run).not.toHaveBeenCalled();
  });

  it('rejects malformed opt-in values without scheduling', async () => {
    const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
    const disabledScheduler = createScheduler().scheduler;
    await expect(
      runContextualAssessmentJobs(context, html, filename, {
        environment: { RAC_CONTEXTUAL_AI_ENABLED: 'yes' },
        scheduler: disabledScheduler,
      }),
    ).rejects.toThrow('RAC_CONTEXTUAL_AI_ENABLED must be set to true or false.');
    expect(disabledScheduler.run).not.toHaveBeenCalled();
  });

  it('preserves snapshot, target, rule, and sent-evidence identity', async () => {
    const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
    expect(context.status).toBe('ready');
    const { scheduler, getPreparedRequest } = createScheduler();
    const execution = await runContextualAssessmentJobs(
      context,
      html,
      filename,
      {
        environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
        scheduler,
      },
    );
    const batch = scheduler.run.mock.calls[0]?.[0][0];
    const prepared = getPreparedRequest();

    expect(batch?.batch.contentHash).toBe(
      createHash('sha256').update(html, 'utf8').digest('hex'),
    );
    expect(prepared?.job.componentId).toBe(context.input.units[0]?.focal.id);
    expect(prepared?.job.ruleIds).toEqual(['BUTTON-PURPOSE-CLARITY']);
    expect(prepared?.sentEvidenceRefIds).toEqual(
      prepared?.job.evidenceRefIds,
    );
    expect(prepared?.sentEvidenceRefIds).toContain(
      context.input.units[0]?.focal.id,
    );

    const requestBody = JSON.parse(
      prepared?.request.messages[1]?.content ?? '{}',
    ) as {
      targetId?: string;
      ruleId?: string;
      context?: {
        evidence?: Array<{ id: string }>;
      };
    };
    expect(requestBody.targetId).toBe(prepared?.job.componentId);
    expect(requestBody.ruleId).toBe('BUTTON-PURPOSE-CLARITY');
    expect(requestBody.context?.evidence?.map(({ id }) => id)).toEqual(
      prepared?.sentEvidenceRefIds,
    );
    expect(prepared?.request.messages[1]?.content).not.toContain(html);
    expect(execution.outcomes).toMatchObject([
      {
        jobId: 'job-1',
        targetId: prepared?.job.componentId,
        ruleId: 'BUTTON-PURPOSE-CLARITY',
        status: 'succeeded',
        validationStatus: 'valid',
      },
    ]);
  });

  it('reports failed scheduler jobs without turning them into findings', async () => {
    const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
    const { scheduler } = createScheduler('permanent_failed');
    const execution = await runContextualAssessmentJobs(
      context,
      html,
      filename,
      {
        environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
        scheduler,
      },
    );

    expect(execution.outcomes).toMatchObject([
      {
        status: 'permanent_failed',
        validationStatus: 'not_run',
        normalizedResult: null,
        errorClass: 'provider_authentication',
      },
    ]);
  });

  it('reuses unchanged snapshots and creates a new snapshot when HTML changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rac-prompt17-'));
    const ledger = new BatchLedger({
      filePath: join(directory, 'acceptance.sqlite'),
      environment: {},
    });
    const snapshotIds: string[] = [];
    const scheduler = {
      run: vi.fn(async (batches) => {
        const batch = batches[0];
        if (!batch) {
          throw new Error('Expected one scheduler batch.');
        }
        const record = ledger.createBatch({
          ...batch.batch,
          plannedJobCount: 0,
        });
        snapshotIds.push(record.snapshotId);
        return {
          batches: [record],
          jobs: [],
          blockedModels: [],
          preflightIssues: [],
        } satisfies SchedulerRunResult;
      }),
    };

    try {
      const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
      for (const content of [html, html, `${html}<!-- changed -->`]) {
        await runContextualAssessmentJobs(context, content, filename, {
          environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
          scheduler,
        });
      }

      expect(snapshotIds).toHaveLength(3);
      expect(snapshotIds[0]).toBe(snapshotIds[1]);
      expect(snapshotIds[2]).not.toBe(snapshotIds[1]);
      expect(scheduler.run).toHaveBeenCalledTimes(3);
    } finally {
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
