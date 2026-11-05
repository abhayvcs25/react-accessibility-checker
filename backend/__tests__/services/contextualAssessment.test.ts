import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContextualAssessment,
  ContextualAssessmentRuleId,
} from '../../src/types/checker.js';
import type { TargetContextInputUnit } from '../../src/types/contextV2.js';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { assessAdaptedContext } from '../../src/services/contextualAssessment.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';

const { assessUnitsWithRemoteAi, isProviderConfigured } = vi.hoisted(() => ({
  assessUnitsWithRemoteAi: vi.fn(),
  isProviderConfigured: vi.fn(),
}));

vi.mock('../../src/ai/config.js', () => ({
  AI_PROVIDERS: { gemini: { keyEnv: 'GEMINI_API_KEY' } },
  isProviderConfigured,
  remoteAiEnabled: true,
  selectedModel: { modelId: 'gemini-3.8-flash' },
  selectedProvider: 'gemini',
}));

vi.mock('../../src/services/remoteAssessment.js', () => ({
  assessUnitsWithRemoteAi,
}));

type RemoteWork = {
  ruleId: ContextualAssessmentRuleId;
  unit: TargetContextInputUnit;
  workIndex: number;
};

type RemoteOutcome = {
  workIndex: number;
  assessment?: ContextualAssessment;
  error?: Error;
  providerQuotaExceeded?: boolean;
};

function remoteOutcomes(work: RemoteWork[]): RemoteOutcome[] {
  return work.map(({ ruleId, unit, workIndex }) => ({
    workIndex,
    assessment: {
      ruleId,
      targetId: unit.focal.id,
      assessment: 'no_issue_detected' as const,
      evidence: [
        {
          record: { recordType: 'target' as const, id: unit.focal.id },
          ...(unit.focal.text ? { text: unit.focal.text.value } : {}),
        },
        ...unit.associatedEvidence.map(({ evidence }) => ({
          record: { recordType: 'evidence' as const, id: evidence.id },
          ...(evidence.text ? { text: evidence.text.value } : {}),
        })),
      ],
      explanation: 'The supplied authored name is clear.',
      confidence: null,
      uncertainty: [],
      source: 'remote_ai' as const,
    },
  }));
}

function assess(html: string) {
  const extraction = extractHtmlContextResultV2(html);
  return assessAdaptedContext(adaptContextSnapshotV2(extraction));
}

describe('online contextual assessment', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    assessUnitsWithRemoteAi
      .mockReset()
      .mockImplementation((work: RemoteWork[]) =>
        Promise.resolve(remoteOutcomes(work)),
      );
    isProviderConfigured.mockReset().mockReturnValue(true);
  });

  it('waits for the selected online model and returns its completed assessment', async () => {
    let finishRequest: (() => void) | undefined;
    assessUnitsWithRemoteAi.mockImplementationOnce(
      (work: RemoteWork[]) =>
        new Promise<RemoteOutcome[]>((resolve) => {
          finishRequest = () => resolve(remoteOutcomes(work));
        }),
    );

    let reportFinished = false;
    const reportPromise = assess('<button>Save changes</button>').then(
      (report) => {
        reportFinished = true;
        return report;
      },
    );
    await Promise.resolve();

    expect(reportFinished).toBe(false);
    expect(assessUnitsWithRemoteAi).toHaveBeenCalledOnce();
    expect(assessUnitsWithRemoteAi.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'BUTTON-PURPOSE-CLARITY' }),
      ]),
    );

    if (!finishRequest) {
      throw new Error('Remote assessment was not started.');
    }
    finishRequest();

    const report = await reportPromise;
    expect(report).toMatchObject({
      modelId: 'gemini-3.8-flash',
      modelRevision: 'gemini-managed',
      inferenceStatus: 'completed',
      assessments: [
        {
          ruleId: 'BUTTON-PURPOSE-CLARITY',
          assessment: 'no_issue_detected',
          source: 'remote_ai',
        },
      ],
    });
  });

  it('sends every eligible candidate without a per-report target cap', async () => {
    const buttons = Array.from(
      { length: 11 },
      (_, index) => `<button>Action ${index}</button>`,
    ).join('');
    const report = await assess(`<main>${buttons}</main>`);
    const submitted = assessUnitsWithRemoteAi.mock.calls.flatMap(
      ([work]) => work as RemoteWork[],
    );

    expect(submitted).toHaveLength(11);
    expect(assessUnitsWithRemoteAi).toHaveBeenCalledTimes(11);
    expect(
      assessUnitsWithRemoteAi.mock.calls.every(
        ([work]) => (work as RemoteWork[]).length === 1,
      ),
    ).toBe(true);
    expect(report.inferenceStatus).toBe('completed');
    expect(
      report.assessments.filter(({ source }) => source === 'remote_ai'),
    ).toHaveLength(11);
  });

  it('preserves associated authored evidence in the completed report', async () => {
    const report = await assess(
      '<form><label for="email">Email address</label><input id="email" type="email"></form>',
    );
    const formAssessment = report.assessments.find(
      ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
    );

    expect(formAssessment?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record: { recordType: 'target', id: expect.any(String) },
        }),
        expect.objectContaining({
          record: { recordType: 'evidence', id: expect.any(String) },
          text: 'Email address',
        }),
      ]),
    );
  });

  it('keeps successful rule assessments when another rule fails', async () => {
    assessUnitsWithRemoteAi.mockImplementation((work: RemoteWork[]) =>
      Promise.resolve(
        work.map(({ ruleId, unit, workIndex }) =>
          ruleId === 'FORM-LABEL-RELEVANCE'
            ? {
                workIndex,
                error: new Error('Remote inference failed after retries.'),
              }
            : remoteOutcomes([{ ruleId, unit, workIndex }])[0]!,
        ),
      ),
    );

    const report = await assess(
      '<button>Save</button><form><label for="email">Email address</label><input id="email" type="email"></form>',
    );

    expect(report.inferenceStatus).toBe('failed');
    expect(report.errorCode).toBe('remote-ai-inference-failed');
    expect(report.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'FORM-LABEL-RELEVANCE',
          assessment: 'not_assessed',
          statusCode: 'remote-ai-inference-failed',
          rule: 'FORM-LABEL-RELEVANCE',
          status: 'Not assessed',
        }),
        expect.objectContaining({
          ruleId: 'BUTTON-PURPOSE-CLARITY',
          assessment: 'no_issue_detected',
          source: 'remote_ai',
        }),
      ]),
    );
  });

  it('stops issuing remote requests after the provider reports quota exhaustion', async () => {
    assessUnitsWithRemoteAi.mockImplementationOnce((work: RemoteWork[]) =>
      Promise.resolve(
        work.map(({ ruleId, unit, workIndex }) => ({
          workIndex,
          error: Object.assign(
            new Error('Provider reported quota exhaustion.'),
            { providerQuotaExceeded: true },
          ),
          providerQuotaExceeded: true,
        })),
      ),
    );

    const report = await assess(
      '<button>Save</button><form><label for="email">Email address</label><input id="email" type="email"></form>',
    );

    expect(assessUnitsWithRemoteAi).toHaveBeenCalledOnce();
    expect(report.inferenceStatus).toBe('completed_with_limit');
    expect(report.errorCode).toBe('provider-quota-exhausted');
    expect(
      report.assessments.filter(
        ({ uncertainty }) =>
          uncertainty.includes('provider-quota-exhausted'),
      ),
    ).toHaveLength(2);
  });

  it('returns a rule-specific fallback if the remote assessment batch rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    assessUnitsWithRemoteAi.mockRejectedValue(
      new Error('Remote assessment batch failed.'),
    );

    const report = await assess(
      '<button>Save</button><form><label for="email">Email address</label><input id="email" type="email"></form>',
    );

    const failures = report.assessments.filter(
      ({ statusCode }) => statusCode === 'remote-ai-inference-failed',
    );
    expect(failures).toHaveLength(2);
    expect(failures.map(({ rule }) => rule)).toEqual(
      expect.arrayContaining([
        'BUTTON-PURPOSE-CLARITY',
        'FORM-LABEL-RELEVANCE',
      ]),
    );
    expect(failures.every(({ status }) => status === 'Not assessed')).toBe(
      true,
    );
  });

  it('does not report label relevance when no label relationship was captured', async () => {
    const report = await assess('<input type="email" placeholder="Email">');

    expect(
      report.assessments.some(
        ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
      ),
    ).toBe(false);
    expect(assessUnitsWithRemoteAi).not.toHaveBeenCalled();
  });

  it('does not invoke the model when context extraction is partial with no targets', async () => {
    const report = await assess('<div id="first" id="second">Not a target</div>');

    expect(report.inferenceStatus).toBe('not_invoked_insufficient_context');
    expect(report.assessments).toEqual([]);
    expect(assessUnitsWithRemoteAi).not.toHaveBeenCalled();
  });

  it('reports a missing selected-provider key without claiming model output', async () => {
    isProviderConfigured.mockReturnValue(false);

    const report = await assess('<button>Continue</button>');

    expect(report).toMatchObject({
      modelId: 'gemini-3.8-flash',
      inferenceStatus: 'unavailable',
      errorCode: 'missing-GEMINI_API_KEY',
      assessments: [
        {
          assessment: 'not_assessed',
          source: 'evidence_gate',
          uncertainty: ['missing-GEMINI_API_KEY'],
        },
      ],
    });
    expect(assessUnitsWithRemoteAi).not.toHaveBeenCalled();
  });
});
