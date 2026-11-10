import { describe, expect, it } from 'vitest';
import type { AdvisoryJobOutcome, AdvisoryModelCandidate } from '../../src/services/reportAggregation.js';
import { aggregateAdvisoryReport } from '../../src/services/reportAggregation.js';

const firstModel: AdvisoryModelCandidate = {
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
  eligibility: 'eligible',
  eligibilityReason: '',
};
const secondModel: AdvisoryModelCandidate = {
  providerId: 'groq',
  modelId: 'openai/gpt-oss-20b',
  eligibility: 'eligible',
  eligibilityReason: '',
};
const blockedModel: AdvisoryModelCandidate = {
  providerId: 'cloudflare-workers-ai',
  modelId: '@cf/zai-org/glm-4.7-flash',
  eligibility: 'blocked_unverified',
  eligibilityReason: 'Runtime verification is pending.',
};

function outcome(
  overrides: Partial<AdvisoryJobOutcome> = {},
): AdvisoryJobOutcome {
  const identity = {
    jobId: 'job-1',
    providerId: 'groq' as const,
    modelId: 'openai/gpt-oss-120b' as const,
    targetId: 'target-1',
    componentRef: 'button#save',
    domPath: '/html/body/button',
    ruleId: 'BUTTON-PURPOSE-CLARITY',
  };
  return {
    ...identity,
    status: 'succeeded',
    validationStatus: 'valid',
    errorClass: null,
    inputTokens: 120,
    outputTokens: 40,
    tokenUsageSource: 'provider',
    normalizedResult: {
      targetId: identity.targetId,
      ruleId: identity.ruleId,
      providerId: identity.providerId,
      modelId: identity.modelId,
      status: 'potential_issue',
      explanation: 'The button name does not explain its action.',
      evidenceRefs: ['evidence-1'],
    },
    evidence: [{ id: 'evidence-1', text: 'Save' }],
    ...overrides,
  };
}

describe('aggregateAdvisoryReport', () => {
  it('groups equivalent validated findings and retains every model attribution', () => {
    const issues = [
      {
        ruleId: 'BUTTON-PURPOSE-CLARITY',
        level: 'violation',
        message: 'IBM issue is not merged.',
        path: '/html/body/button',
        snippet: '<button>Save</button>',
      },
    ];
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [
        outcome(),
        outcome({
          jobId: 'job-2',
          modelId: secondModel.modelId,
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: secondModel.modelId,
            status: 'potential_issue',
            explanation: 'The button name does not explain its action.',
            evidenceRefs: ['evidence-1'],
          },
        }),
      ],
      issues,
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      agreement: 'unanimous_issue',
      issueCount: 2,
      validatedCount: 2,
      relatedIbmIssueIds: ['IBM-01'],
      equivalentFindings: [
        {
          status: 'potential_issue',
          modelCount: 2,
          evidenceRefIds: ['evidence-1'],
        },
      ],
    });
    expect(report.findings[0]?.assessments.map((assessment) => assessment.modelId))
      .toEqual([firstModel.modelId, secondModel.modelId]);
    expect(report.fixingPrompt).toContain('Evidence evidence-1: "Save"');
    expect(report.fixingPrompt).toContain('IBM-01');
    expect(report.fixingPrompt).toContain(
      'Do not claim conformance from these results.',
    );
    expect(issues).toEqual([
      {
        ruleId: 'BUTTON-PURPOSE-CLARITY',
        level: 'violation',
        message: 'IBM issue is not merged.',
        path: '/html/body/button',
        snippet: '<button>Save</button>',
      },
    ]);
  });

  it('shows disagreement without turning the majority into a verdict', () => {
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [
        outcome(),
        outcome({
          jobId: 'job-2',
          modelId: secondModel.modelId,
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: secondModel.modelId,
            status: 'no_issue_detected',
            explanation: 'The evidence indicates a recognizable action.',
            evidenceRefs: ['evidence-1'],
          },
        }),
      ],
      [],
    );

    expect(report.findings[0]).toMatchObject({
      agreement: 'disagreement',
      issueCount: 1,
      validatedCount: 2,
    });
    expect(report.fixingPrompt).toContain('disagreement');
    expect(report.fixingPrompt).toContain('no_issue_detected');
  });

  it('does not deduplicate validated issues with different evidence identities', () => {
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [
        outcome(),
        outcome({
          jobId: 'job-2',
          modelId: secondModel.modelId,
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: secondModel.modelId,
            status: 'potential_issue',
            explanation: 'A separate evidence reference supports this finding.',
            evidenceRefs: ['evidence-2'],
          },
          evidence: [{ id: 'evidence-2', text: 'Submit' }],
        }),
      ],
      [],
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.equivalentFindings).toHaveLength(2);
    expect(
      report.findings[0]?.equivalentFindings.map((finding) =>
        finding.evidenceRefIds[0],
      ),
    ).toEqual(['evidence-1', 'evidence-2']);
  });

  it('bounds displayed evidence while retaining a distinct full evidence identity', () => {
    const evidenceRefs = Array.from({ length: 21 }, (_, index) =>
      `evidence-${index}`,
    );
    const report = aggregateAdvisoryReport(
      [firstModel],
      [
        outcome({
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: firstModel.modelId,
            status: 'potential_issue',
            explanation: 'A bounded evidence-list test.',
            evidenceRefs,
          },
          evidence: evidenceRefs.map((id) => ({ id, text: id })),
        }),
      ],
      [],
    );

    expect(report.assessmentGroups[0]?.assessments[0]).toMatchObject({
      omittedEvidenceCount: 1,
      evidence: expect.arrayContaining([expect.objectContaining({ id: 'evidence-0' })]),
    });
    expect(report.assessmentGroups[0]?.assessments[0]?.evidence).toHaveLength(20);
    expect(report.assessmentGroups[0]?.equivalentFindings[0]).toMatchObject({
      omittedEvidenceCount: 1,
      evidenceRefIds: expect.arrayContaining(['evidence-0']),
    });
  });

  it('keeps negative outcomes out of actionable findings', () => {
    const report = aggregateAdvisoryReport(
      [firstModel],
      [
        outcome({
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: firstModel.modelId,
            status: 'no_issue_detected',
            explanation: 'The available evidence supports a clear action.',
            evidenceRefs: ['evidence-1'],
          },
        }),
      ],
      [],
    );

    expect(report.assessmentGroups[0]?.agreement).toBe('unanimous_no_issue');
    expect(report.findings).toEqual([]);
    expect(report.fixingPrompt).toBeNull();
  });

  it('reports insufficient context as an abstention rather than a negative result', () => {
    const report = aggregateAdvisoryReport(
      [firstModel],
      [
        outcome({
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: firstModel.modelId,
            status: 'insufficient_context',
            explanation: 'The available context does not show the button action.',
            evidenceRefs: [],
          },
        }),
      ],
      [],
    );

    expect(report.assessmentGroups[0]?.agreement).toBe('insufficient_context');
    expect(report.findings).toEqual([]);
    expect(report.fixingPrompt).toBeNull();
  });

  it('does not count an abstention as disagreement with a later no-issue result', () => {
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [
        outcome({
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: firstModel.modelId,
            status: 'insufficient_context',
            explanation: 'Insufficient context: the target has no usable name.',
            evidenceRefs: [],
          },
        }),
        outcome({
          jobId: 'job-2',
          modelId: secondModel.modelId,
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: secondModel.modelId,
            status: 'no_issue_detected',
            explanation: 'Not violation: the supplied label identifies the action.',
            evidenceRefs: ['evidence-1'],
          },
        }),
      ],
      [],
    );

    expect(report.assessmentGroups[0]).toMatchObject({
      agreement: 'no_issue_detected',
      issueCount: 0,
      validatedCount: 2,
      decisiveCount: 1,
      abstentionCount: 1,
    });
    expect(report.findings).toEqual([]);
    expect(report.fixingPrompt).toBeNull();
  });

  it('keeps an abstention separate from a later validated issue', () => {
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [
        outcome({
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: firstModel.modelId,
            status: 'insufficient_context',
            explanation: 'Insufficient context: the target has no usable name.',
            evidenceRefs: [],
          },
        }),
        outcome({
          jobId: 'job-2',
          modelId: secondModel.modelId,
          normalizedResult: {
            targetId: 'target-1',
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: 'groq',
            modelId: secondModel.modelId,
            status: 'potential_issue',
            explanation: 'Violation: the available name does not explain the action.',
            evidenceRefs: ['evidence-1'],
          },
        }),
      ],
      [],
    );

    expect(report.assessmentGroups[0]).toMatchObject({
      agreement: 'issue_detected',
      issueCount: 1,
      validatedCount: 2,
      decisiveCount: 1,
      abstentionCount: 1,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.fixingPrompt).toContain(
      'Model result: 1 of 1 decisive assessments flagged an issue; 1 abstained',
    );
  });

  it('keeps blocked, failed, quota-limited, and invalid outcomes out of prompt findings', () => {
    const invalid = outcome({
      jobId: 'invalid-job',
      validationStatus: 'invalid',
      status: 'invalid_response',
      errorClass: 'semantic_invalid',
      normalizedResult: null,
    });
    const quota = outcome({
      jobId: 'quota-job',
      providerId: blockedModel.providerId,
      modelId: blockedModel.modelId,
      status: 'blocked',
      validationStatus: 'not_run',
      errorClass: 'provider_quota_exhausted',
      normalizedResult: null,
    });
    const report = aggregateAdvisoryReport(
      [firstModel, blockedModel],
      [invalid, quota],
      [],
    );

    expect(report.findings).toEqual([]);
    expect(report.fixingPrompt).toBeNull();
    expect(report.models[0]).toMatchObject({
      status: 'failed',
      invalidCount: 1,
      validatedCount: 0,
    });
    expect(report.models[1]).toMatchObject({
      status: 'quota_limited',
      quotaLimited: true,
    });
    expect(report.jobs.map((job) => job.validationStatus)).toEqual([
      'invalid',
      'not_run',
    ]);
  });

  it('keeps queued work distinct from a failed or negative assessment', () => {
    const report = aggregateAdvisoryReport(
      [firstModel],
      [
        outcome({
          status: 'queued',
          validationStatus: 'not_run',
          normalizedResult: null,
        }),
      ],
      [],
    );

    expect(report.status).toBe('queued');
    expect(report.models[0]?.status).toBe('queued');
    expect(report.jobs[0]).toMatchObject({
      status: 'queued',
      validationStatus: 'not_run',
    });
    expect(report.assessmentGroups).toEqual([]);
    expect(report.fixingPrompt).toBeNull();
  });

  it('preserves partial successes and excludes fabricated evidence references', () => {
    const successful = outcome();
    const fabricatedEvidence = outcome({
      jobId: 'fabricated-job',
      modelId: secondModel.modelId,
      normalizedResult: {
        targetId: 'target-1',
        ruleId: 'BUTTON-PURPOSE-CLARITY',
        providerId: 'groq',
        modelId: secondModel.modelId,
        status: 'potential_issue',
        explanation: 'The model cited an unsent record.',
        evidenceRefs: ['not-sent'],
      },
    });
    const report = aggregateAdvisoryReport(
      [firstModel, secondModel],
      [successful, fabricatedEvidence],
      [],
    );

    expect(report.status).toBe('partial');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.assessments).toHaveLength(1);
    expect(report.jobs[1]).toMatchObject({
      status: 'invalid_response',
      validationStatus: 'invalid',
    });
    expect(report.models[1]).toMatchObject({
      status: 'failed',
      invalidCount: 1,
      notValidatedCount: 0,
      failedCount: 0,
    });
    expect(report.fixingPrompt).not.toContain(
      'The model cited an unsent record.',
    );
  });

  it('returns a deterministic bounded fixing prompt', () => {
    const outcomeWithLongEvidence = outcome({
      evidence: [{ id: 'evidence-1', text: 'source '.repeat(200) }],
    });
    const first = aggregateAdvisoryReport(
      [firstModel],
      [outcomeWithLongEvidence],
      [],
    );
    const second = aggregateAdvisoryReport(
      [firstModel],
      [outcomeWithLongEvidence],
      [],
    );

    expect(first.fixingPrompt).toBe(second.fixingPrompt);
    expect(first.fixingPrompt?.length).toBeLessThanOrEqual(16_000);
    expect(first.fixingPrompt).not.toContain('source '.repeat(100));
  });

  it('keeps large fixing prompts under the limit and marks omitted findings', () => {
    const candidates: AdvisoryModelCandidate[] = [
      firstModel,
      secondModel,
      {
        providerId: 'groq',
        modelId: 'qwen/qwen3.8-27b',
        eligibility: 'eligible',
        eligibilityReason: '',
      },
      {
        providerId: 'cloudflare-workers-ai',
        modelId: '@cf/zai-org/glm-4.7-flash',
        eligibility: 'eligible',
        eligibilityReason: '',
      },
      {
        providerId: 'cloudflare-workers-ai',
        modelId: '@cf/nvidia/nemotron-3-120b-a12b',
        eligibility: 'eligible',
        eligibilityReason: '',
      },
      {
        providerId: 'cloudflare-workers-ai',
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        eligibility: 'eligible',
        eligibilityReason: '',
      },
    ];
    const outcomes = candidates.flatMap((candidate) =>
      Array.from({ length: 6 }, (_, index) => {
        const jobId = `${candidate.modelId}-${index}`;
        const targetId = `target-${index}`;
        const evidenceRefs = [`${jobId}-e1`, `${jobId}-e2`];
        return outcome({
          jobId,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          targetId,
          componentRef: `component-${'x'.repeat(450)}`,
          domPath: `/html/${'section/'.repeat(60)}`,
          normalizedResult: {
            targetId,
            ruleId: 'BUTTON-PURPOSE-CLARITY',
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            status: 'potential_issue',
            explanation: 'A'.repeat(400),
            evidenceRefs,
          },
          evidence: evidenceRefs.map((id) => ({
            id,
            text: 'E'.repeat(120),
          })),
        });
      }),
    );
    const report = aggregateAdvisoryReport(candidates, outcomes, []);

    expect(report.fixingPrompt).not.toBeNull();
    expect(report.fixingPrompt?.length).toBeLessThanOrEqual(16_000);
    expect(report.omittedPromptFindingCount).toBeGreaterThan(0);
    expect(report.fixingPrompt).toContain(
      'additional validated advisory finding(s) are omitted',
    );
    expect(report.fixingPrompt).toContain(
      'This application does not modify project files.',
    );
  });
});
