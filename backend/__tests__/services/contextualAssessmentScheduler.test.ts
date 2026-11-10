import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchLedger } from '../../src/ai/batchLedger.js';
import {
  getEligibleModels,
  type EligibleModelCandidate,
} from '../../src/ai/config.js';
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
              explanation: 'Violation: The available label may not explain the action.',
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
    expect(prepared?.request.messages[0]?.content).toContain(
      'start explanation with exactly "Violation:"',
    );
    expect(prepared?.request.messages[0]?.content).toContain(
      'Do not suggest IBM, another analyzer, a generic website, or an external source',
    );
    expect(prepared?.request.timeoutMs).toBe(45_000);
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

  it('assigns each component to one model in order instead of assessing every component with every model', async () => {
    const twoButtonHtml =
      '<!doctype html><html><body><button>Save</button><button>Cancel</button></body></html>';
    const context = adaptContextSnapshotV2(
      extractHtmlContextResultV2(twoButtonHtml),
    );
    expect(context.status).toBe('ready');
    expect(context.input.units).toHaveLength(2);

    const { scheduler } = createScheduler();
    await runContextualAssessmentJobs(context, twoButtonHtml, filename, {
      environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
      scheduler,
    });

    const batch = scheduler.run.mock.calls[0]?.[0][0];
    expect(batch?.assessments).toHaveLength(2);
    expect(batch?.assessments.map((assessment) => assessment.modelId)).toEqual([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ]);
  });

  it('tries at most three distinct models when a validated assessment abstains', async () => {
    const context = adaptContextSnapshotV2(extractHtmlContextResultV2(html));
    const modelIds: string[] = [];
    let runNumber = 0;
    const statuses = [
      'insufficient_context',
      'insufficient_context',
      'no_issue_detected',
    ] as const;
    const scheduler = {
      run: vi.fn(async (batches: readonly SchedulerBatchInput[]) => {
        const batch = batches[0];
        const assessment = batch?.assessments[0];
        if (!batch || !assessment?.modelId) {
          throw new Error('Expected an explicitly assigned model assessment.');
        }
        const candidate = getEligibleModels().find(
          (item) => item.modelId === assessment.modelId,
        );
        if (!candidate) {
          throw new Error('The assigned model should be eligible.');
        }
        modelIds.push(candidate.modelId);
        const prepared = assessment.prepare(candidate);
        const status = statuses[runNumber++];
        if (!status) {
          throw new Error('The scheduler exceeded its three-attempt bound.');
        }
        return {
          batches: [],
          blockedModels: [],
          preflightIssues: [],
          jobs: [{
            batchId: `batch-${runNumber}`,
            jobId: `job-${runNumber}`,
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            componentId: prepared.job.componentId,
            ruleId: prepared.job.ruleIds[0] ?? '',
            status: 'succeeded',
            errorClass: null,
            result: {
              targetId: prepared.job.componentId,
              ruleId: prepared.job.ruleIds[0] ?? '',
              providerId: candidate.providerId,
              modelId: candidate.modelId,
              status,
              explanation:
                status === 'insufficient_context'
                  ? 'Insufficient context: the supplied evidence is incomplete.'
                  : 'Not violation: the available evidence indicates a clear label.',
              evidenceRefs:
                status === 'insufficient_context'
                  ? []
                  : [...prepared.sentEvidenceRefIds],
            },
          }],
        } satisfies SchedulerRunResult;
      }),
    };

    const execution = await runContextualAssessmentJobs(context, html, filename, {
      environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
      scheduler,
    });

    expect(scheduler.run).toHaveBeenCalledTimes(3);
    expect(modelIds).toEqual([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ]);
    expect(execution.outcomes).toHaveLength(3);
    expect(execution.outcomes.map((item) => item.normalizedResult?.status))
      .toEqual(statuses);
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
    expect(scheduler.run).toHaveBeenCalledOnce();
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
