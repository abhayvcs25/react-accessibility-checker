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
      ruleGuidance?: string;
      context?: {
        evidence?: Array<{ id: string; text?: string; recordType?: string }>;
      };
    };
    expect(requestBody.targetId).toBe(prepared?.job.componentId);
    expect(requestBody.ruleId).toBe('BUTTON-PURPOSE-CLARITY');
    expect(requestBody.ruleGuidance).toContain(
      'Do not infer handler behavior',
    );
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

  it('sends bounded associated static context and explicit rule criteria', async () => {
    const contextualHtml =
      '<!doctype html><html><body><form aria-label="Profile settings"><fieldset><legend>Contact details</legend><label for="email">Email address</label><input id="email" name="email" type="email"><label for="phone">Phone number</label><input id="phone" name="phone" type="tel"></fieldset></form></body></html>';
    const extraction = extractHtmlContextResultV2(
      contextualHtml,
      'single-document',
      filename,
    );
    expect(extraction.status).toBe('available');
    if (extraction.status !== 'available') {
      throw new Error('Expected static context extraction to succeed.');
    }
    const context = adaptContextSnapshotV2(extraction.snapshot);
    const { scheduler, getPreparedRequest } = createScheduler();

    await runContextualAssessmentJobs(context, contextualHtml, filename, {
      environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
      scheduler,
      projectContext: extraction.projectContext,
    });

    const requestBody = JSON.parse(
      getPreparedRequest()?.request.messages[1]?.content ?? '{}',
    ) as {
      ruleGuidance?: string;
      context?: {
        target?: {
          attributes?: {
            inputType?: {
              status: string;
              value?: { value: string };
            };
          };
        };
        evidence?: Array<{
          id: string;
          text?: string;
          recordType?: string;
          tagName?: string;
          category?: string;
          targetKind?: string;
          parentId?: string;
          parentContext?: boolean;
          attributes?: Record<string, unknown>;
        }>;
        parentContext?: {
          rootRecordId: string;
          recordIds: string[];
          complete: boolean;
        };
      };
    };
    expect(requestBody.ruleGuidance).toContain(
      'A name attribute alone does not establish purpose',
    );
    expect(requestBody.ruleGuidance).toContain(
      'input-format constraint',
    );
    const formContext = requestBody.context?.evidence?.find(
      (item) => item.tagName === 'form',
    );
    const fieldsetContext = requestBody.context?.evidence?.find(
      (item) => item.tagName === 'fieldset',
    );
    const siblingControl = requestBody.context?.evidence?.find(
      (item) =>
        item.targetKind === 'form-control' &&
        item.id !== requestBody.context?.evidence?.find(
          (evidence) => evidence.targetKind === 'form-control',
        )?.id,
    );
    expect(formContext).toMatchObject({
      category: 'form',
      parentContext: true,
      attributes: {
        'aria-label': {
          status: 'present',
          value: 'Profile settings',
        },
      },
    });
    expect(requestBody.context?.target?.attributes?.inputType).toMatchObject({
      status: 'present',
      value: { value: 'email' },
    });
    expect(fieldsetContext).toMatchObject({
      category: 'group',
      parentId: formContext?.id,
      parentContext: true,
    });
    expect(siblingControl?.attributes).toMatchObject({
      inputType: { status: 'present', value: { value: 'tel' } },
    });
    expect(requestBody.context?.parentContext).toMatchObject({
      rootRecordId: formContext?.id,
      complete: true,
    });
    expect(requestBody.context?.evidence).toContainEqual(
      expect.objectContaining({
        tagName: 'legend',
        text: 'Contact details',
      }),
    );
  });

  it('marks a resolved native label as explicitly associated in the model payload', async () => {
    const contextualHtml =
      '<!doctype html><html><body><form><label for="month">Favorite color</label><input id="month" type="month" placeholder="Month"></form></body></html>';
    const extraction = extractHtmlContextResultV2(
      contextualHtml,
      'single-document',
      filename,
    );
    expect(extraction.status).toBe('available');
    if (extraction.status !== 'available') {
      throw new Error('Expected static context extraction to succeed.');
    }
    const context = adaptContextSnapshotV2(extraction.snapshot);
    const { scheduler, getPreparedRequest } = createScheduler();

    await runContextualAssessmentJobs(context, contextualHtml, filename, {
      environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
      scheduler,
      projectContext: extraction.projectContext,
    });

    const requestBody = JSON.parse(
      getPreparedRequest()?.request.messages[1]?.content ?? '{}',
    ) as {
      ruleGuidance?: string;
      context?: {
        target?: {
          attributes?: {
            inputType?: { status: string; value?: { value: string } };
          };
        };
        evidence?: Array<{
          id: string;
          text?: string;
          associations?: Array<{ kind: string; provenance: string }>;
        }>;
      };
    };
    expect(requestBody.context?.target?.attributes?.inputType).toMatchObject({
      status: 'present',
      value: { value: 'month' },
    });
    expect(requestBody.context?.evidence).toContainEqual(
      expect.objectContaining({
        text: 'Favorite color',
        associations: [
          { kind: 'native-label', provenance: 'native-html' },
        ],
      }),
    );
    expect(requestBody.ruleGuidance).toContain(
      'month, time, week, email',
    );
  });

  it('does not assess authored ARIA names without browser-computed names', async () => {
    const widgetHtml =
      '<!doctype html><html><body><div role="button" aria-label="Thing" tabindex="0"></div></body></html>';
    const context = adaptContextSnapshotV2(
      extractHtmlContextResultV2(widgetHtml),
    );
    const scheduler = { run: vi.fn() };

    await expect(
      runContextualAssessmentJobs(context, widgetHtml, filename, {
        environment: { RAC_CONTEXTUAL_AI_ENABLED: 'true' },
        scheduler,
      }),
    ).resolves.toEqual({ outcomes: [] });
    expect(scheduler.run).not.toHaveBeenCalled();
  });

  it('randomizes model order while assigning each component to one distinct model', async () => {
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
      random: () => 0,
    });

    const batch = scheduler.run.mock.calls[0]?.[0][0];
    expect(batch?.assessments).toHaveLength(2);
    expect(batch?.assessments.map((assessment) => assessment.modelId)).toEqual([
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
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
      random: () => 0,
    });

    expect(scheduler.run).toHaveBeenCalledTimes(3);
    expect(modelIds).toEqual([
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      '@cf/zai-org/glm-4.7-flash',
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
