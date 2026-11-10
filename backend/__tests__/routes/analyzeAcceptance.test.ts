import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_SIZE } from '../../src/config.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import analyzeRouter from '../../src/routes/analyze.js';
import type { AdvisoryJobOutcome } from '../../src/services/reportAggregation.js';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  getCompliance: vi.fn(),
  getConfigUnsupported: vi.fn(),
  runContextualAssessmentJobs: vi.fn(),
  closeContextualAssessmentScheduler: vi.fn(),
}));

vi.mock('accessibility-checker', () => ({
  close: mocks.close,
  getCompliance: mocks.getCompliance,
  getConfigUnsupported: mocks.getConfigUnsupported,
}));

vi.mock('../../src/services/contextualAssessmentScheduler.js', () => ({
  runContextualAssessmentJobs: mocks.runContextualAssessmentJobs,
  closeContextualAssessmentScheduler: mocks.closeContextualAssessmentScheduler,
}));

const html =
  '<!doctype html><html lang="en"><head><title>Acceptance</title></head><body><button>Continue</button><img src="photo.png"></body></html>';
const filename = 'acceptance.html';
const candidateModels = [
  ['groq', 'openai/gpt-oss-120b'],
  ['groq', 'openai/gpt-oss-20b'],
  ['groq', 'qwen/qwen3.8-27b'],
  ['cloudflare-workers-ai', '@cf/zai-org/glm-4.7-flash'],
  ['cloudflare-workers-ai', '@cf/nvidia/nemotron-3-120b-a12b'],
  ['cloudflare-workers-ai', '@cf/google/gemma-4-26b-a4b-it'],
] as const;
const buttonTargetId = 'target-button-1';
const ruleId = 'BUTTON-PURPOSE-CLARITY';

const ibmReport = {
  report: {
    summary: {
      counts: {
        violation: 1,
        potentialviolation: 0,
        recommendation: 0,
        potentialrecommendation: 0,
        manual: 0,
      },
    },
    results: [
      {
        ruleId: 'WCAG20_Img_HasAlt',
        level: 'violation',
        value: ['VIOLATION', 'FAIL'],
        message: 'Image has no alternative text.',
        path: { dom: '/html/body/img' },
        snippet: '<img src="photo.png">',
        help: 'https://example.test/ibm-image-alt',
      },
    ],
  },
};

function outcome(
  modelIndex: number,
  status: AdvisoryJobOutcome['status'] = 'succeeded',
  assessmentStatus:
    | 'potential_issue'
    | 'no_issue_detected'
    | 'insufficient_context' = 'potential_issue',
): AdvisoryJobOutcome {
  const model = candidateModels[modelIndex];
  if (!model) {
    throw new Error('Unknown test model index.');
  }
  const [providerId, modelId] = model;
  const jobId = `mock-job-${modelIndex + 1}`;
  const validated = status === 'succeeded';
  return {
    jobId,
    providerId,
    modelId,
    targetId: buttonTargetId,
    componentRef: buttonTargetId,
    ruleId,
    status,
    validationStatus: validated
      ? 'valid'
      : status === 'invalid_response'
        ? 'invalid'
        : 'not_run',
    errorClass:
      status === 'permanent_failed'
        ? 'provider_authentication'
        : status === 'invalid_response'
          ? 'malformed_response'
          : null,
    normalizedResult: validated
      ? {
          targetId: buttonTargetId,
          ruleId,
          status: assessmentStatus,
          explanation:
            assessmentStatus === 'potential_issue'
              ? `Mock model ${modelIndex + 1} sees an unclear action label.`
              : assessmentStatus === 'no_issue_detected'
                ? `Mock model ${modelIndex + 1} considers the label clear.`
                : 'The supplied evidence is insufficient.',
          evidenceRefs: [buttonTargetId],
          providerId,
          modelId,
        }
      : null,
    evidence: [{ id: buttonTargetId, text: 'Continue' }],
  };
}

describe('mocked file-to-report acceptance', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: MAX_BODY_SIZE }));
    app.use(analyzeRouter);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    vi.stubEnv('RAC_CONTEXTUAL_AI_ENABLED', 'false');
    mocks.getConfigUnsupported.mockReset().mockResolvedValue({
      ruleArchive: 'latest',
      policies: ['IBM_Accessibility'],
      outputFormat: ['disable'],
      perfMetrics: false,
      reportLevels: [
        'violation',
        'potentialviolation',
        'recommendation',
        'potentialrecommendation',
        'manual',
      ],
    });
    mocks.getCompliance.mockReset().mockResolvedValue(ibmReport);
    mocks.runContextualAssessmentJobs.mockReset().mockResolvedValue({
      outcomes: [],
    });
  });

  async function submit(content = html) {
    return fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: content, filename }),
    });
  }

  async function acceptedReport(outcomes: AdvisoryJobOutcome[]) {
    mocks.runContextualAssessmentJobs.mockResolvedValueOnce({ outcomes });
    const response = await submit();
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      filename: string;
      summary: Record<string, number>;
      issues: Array<Record<string, unknown>>;
      advisoryReport: {
        status: string;
        models: Array<{
          modelId: string;
          status: string;
          eligibility: string;
          validatedCount: number;
          invalidCount: number;
          failedCount: number;
        }>;
        jobs: Array<{
          modelId: string;
          status: string;
          validationStatus: string;
        }>;
        assessmentGroups: Array<{
          agreement: string;
          issueCount: number;
          assessments: Array<{ providerId: string; modelId: string }>;
        }>;
        findings: unknown[];
        fixingPrompt: string | null;
      };
    }>;
  }

  function expectIbmUnchanged(report: {
    filename: string;
    summary: Record<string, number>;
    issues: Array<Record<string, unknown>>;
  }) {
    expect(report.filename).toBe(filename);
    expect(report.summary).toEqual({
      total: 1,
      violations: 1,
      potentialViolations: 0,
      recommendations: 0,
      potentialRecommendations: 0,
      manual: 0,
    });
    expect(report.issues).toEqual([
      {
        ruleId: 'WCAG20_Img_HasAlt',
        level: 'violation',
        message: 'Image has no alternative text.',
        path: '/html/body/img',
        snippet: '<img src="photo.png">',
        help: 'https://example.test/ibm-image-alt',
      },
    ]);
  }

  it('keeps an IBM-only upload idle when eligible models have no assessments', async () => {
    const report = await acceptedReport([]);
    expectIbmUnchanged(report);
    expect(report.advisoryReport.status).toBe('not_run');
    expect(report.advisoryReport.models).toHaveLength(6);
    expect(
      report.advisoryReport.models.every(
        (model) =>
          model.status === 'not_run' &&
          model.eligibility === 'eligible' &&
          model.validatedCount === 0,
      ),
    ).toBe(true);
    expect(mocks.runContextualAssessmentJobs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
      html,
      filename,
    );
    expect(mocks.getCompliance).toHaveBeenCalledWith(
      html,
      expect.stringMatching(/^accessibility-analyzer-/),
    );
  });

  it('renders isolated mock outcomes with eligible models still partially verified', async () => {
    const report = await acceptedReport(
      candidateModels.map((_model, index) => outcome(index)),
    );
    expectIbmUnchanged(report);
    expect(report.advisoryReport.status).toBe('completed');
    expect(report.advisoryReport.models).toHaveLength(6);
    expect(report.advisoryReport.models).toEqual(
      expect.arrayContaining(
        candidateModels.map(([, modelId]) =>
          expect.objectContaining({
            modelId,
            status: 'completed',
            eligibility: 'eligible',
            validatedCount: 1,
          }),
        ),
      ),
    );
    expect(report.advisoryReport.assessmentGroups).toHaveLength(1);
    expect(report.advisoryReport.assessmentGroups[0]?.assessments).toHaveLength(6);
    expect(report.advisoryReport.findings).toHaveLength(1);
    expect(report.advisoryReport.fixingPrompt).toContain(
      'Only the external coding assistant may edit source files',
    );
    expect(report.advisoryReport.fixingPrompt?.length).toBeLessThanOrEqual(
      16_000,
    );
    expect(mocks.getCompliance).toHaveBeenCalledOnce();
  });

  it('shows provider failures as failures, not negative assessments', async () => {
    const report = await acceptedReport([
      outcome(0),
      outcome(1, 'permanent_failed'),
    ]);
    expectIbmUnchanged(report);
    expect(report.advisoryReport.status).toBe('partial');
    expect(report.advisoryReport.findings).toHaveLength(1);
    expect(report.advisoryReport.assessmentGroups[0]?.issueCount).toBe(1);
    expect(report.advisoryReport.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: candidateModels[1]?.[1],
          status: 'permanent_failed',
          validationStatus: 'not_run',
        }),
      ]),
    );
    expect(
      report.advisoryReport.assessmentGroups[0]?.assessments.some(
        (assessment) => assessment.modelId === candidateModels[1]?.[1],
      ),
    ).toBe(false);
  });

  it('reports malformed responses as invalid and excludes them from findings', async () => {
    const report = await acceptedReport([outcome(0, 'invalid_response')]);
    expectIbmUnchanged(report);
    expect(report.advisoryReport.status).toBe('failed');
    expect(report.advisoryReport.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: candidateModels[0]?.[1],
          status: 'failed',
          invalidCount: 1,
          validatedCount: 0,
        }),
      ]),
    );
    expect(report.advisoryReport.assessmentGroups).toHaveLength(0);
    expect(report.advisoryReport.findings).toHaveLength(0);
    expect(report.advisoryReport.fixingPrompt).toBeNull();
  });

  it('preserves disagreement and per-model provenance', async () => {
    const report = await acceptedReport([
      outcome(0, 'succeeded', 'potential_issue'),
      outcome(1, 'succeeded', 'no_issue_detected'),
    ]);
    expectIbmUnchanged(report);
    expect(report.advisoryReport.status).toBe('partial');
    expect(report.advisoryReport.assessmentGroups[0]).toMatchObject({
      agreement: 'disagreement',
      issueCount: 1,
      assessments: [
        expect.objectContaining({ modelId: candidateModels[0]?.[1] }),
        expect.objectContaining({ modelId: candidateModels[1]?.[1] }),
      ],
    });
    expect(report.advisoryReport.findings).toHaveLength(1);
    expect(report.advisoryReport.fixingPrompt).toContain(
      'Model agreement: 1 of 2 validated assessments flagged an issue',
    );
  });

  it('keeps IBM output unchanged for identical and changed submitted snapshots', async () => {
    const submitted: string[] = [];
    mocks.runContextualAssessmentJobs.mockImplementation(
      async (_context: unknown, content: string, submittedFilename: string) => {
        submitted.push(content);
        expect(submittedFilename).toBe(filename);
        return { outcomes: [] };
      },
    );

    for (const content of [html, html, `${html}<!-- changed snapshot -->`]) {
      const response = await submit(content);
      expect(response.status).toBe(200);
      const report = await response.json();
      expectIbmUnchanged(report);
    }

    expect(submitted).toEqual([
      html,
      html,
      `${html}<!-- changed snapshot -->`,
    ]);
    expect(mocks.getCompliance).toHaveBeenCalledTimes(3);
    expect(mocks.getCompliance.mock.calls.map(([content]) => content)).toEqual(
      submitted,
    );
  });
});
