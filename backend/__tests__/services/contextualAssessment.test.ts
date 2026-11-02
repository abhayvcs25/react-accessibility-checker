import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { assessAdaptedContext } from '../../src/services/contextualAssessment.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';

const { generateQwenText, isQwenGenerationInProgress } = vi.hoisted(() => ({
  generateQwenText: vi.fn(),
  isQwenGenerationInProgress: vi.fn(),
}));

vi.mock('../../src/services/qwenModel.js', () => ({
  QWEN_MODEL_ID: 'huggingworld/Qwen3.5-4B-ONNX',
  QWEN_MODEL_REVISION: '8e3760349b4480f1f1a0f2d2010e46c5863262f1',
  QWEN_MAX_NEW_TOKENS: 16,
  generateQwenText,
  isQwenGenerationInProgress,
}));

function assess(html: string) {
  const extraction = extractHtmlContextResultV2(html);
  return assessAdaptedContext(adaptContextSnapshotV2(extraction));
}

function validBatchResponse(prompt: string): string {
  const inputStart = prompt.indexOf('INPUT=');
  const targets = JSON.parse(prompt.slice(inputStart + 'INPUT='.length)) as unknown[];
  return '0'.repeat(targets.length);
}

describe('contextual assessment evidence gate', () => {
  const previousFlag = process.env.RAC_ENABLE_QWEN_ASSESSMENTS;

  beforeEach(() => {
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '0';
    generateQwenText.mockReset();
    isQwenGenerationInProgress.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousFlag === undefined) {
      delete process.env.RAC_ENABLE_QWEN_ASSESSMENTS;
    } else {
      process.env.RAC_ENABLE_QWEN_ASSESSMENTS = previousFlag;
    }
  });

  it('keeps Qwen disabled by default and preserves available authored evidence', async () => {
    const report = await assess(
      '<form><label for="email">Email address</label><input id="email" type="email"></form>' +
        '<button aria-label="Continue">Continue</button>',
    );

    expect(report.inferenceStatus).toBe('not_invoked_disabled');
    expect(report.modelLoaded).toBe(false);
    expect(report.assessments.map(({ ruleId }) => ruleId).sort()).toEqual([
      'ARIA-NAME-CLARITY',
      'BUTTON-PURPOSE-CLARITY',
      'FORM-LABEL-RELEVANCE',
    ]);
    expect(
      report.assessments.every(
        ({ assessment, confidence, source, uncertainty }) =>
          assessment === 'not_assessed' &&
          confidence === null &&
          source === 'evidence_gate' &&
          uncertainty.includes('experimental-model-disabled'),
      ),
    ).toBe(true);

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
    expect(generateQwenText).not.toHaveBeenCalled();
  });

  it('abstains when ambiguous native-label relationships were omitted by the adapter', async () => {
    const report = await assess(
      '<label for="duplicate">Email address</label>' +
        '<input id="duplicate" type="email"><input id="duplicate" type="text">',
    );
    const formAssessment = report.assessments.find(
      ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
    );

    expect(formAssessment?.assessment).toBe('insufficient_context');
    expect(formAssessment?.uncertainty).toEqual(
      expect.arrayContaining([
        'complete-context-capture',
        'label-association-not-captured',
      ]),
    );
  });

  it('does not report label relevance when no label relationship was captured', async () => {
    const report = await assess('<input type="email" placeholder="Email">');

    expect(
      report.assessments.some(
        ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
      ),
    ).toBe(false);
  });

  it('does not equate partial extraction with having no targets', async () => {
    const report = await assess('<div id="first" id="second">Not a target</div>');

    expect(report.inferenceStatus).toBe('not_invoked_insufficient_context');
    expect(report.assessments).toEqual([]);
  });

  it('does not fabricate assessments when the context adapter is unavailable', async () => {
    const report = await assessAdaptedContext({
      status: 'unavailable',
      reason: 'parser-failure',
    });

    expect(report).toMatchObject({
      inferenceStatus: 'unavailable',
      modelLoaded: false,
      assessments: [],
      errorCode: 'context-parser-failure',
    });
  });

  it('uses one concise Qwen batch only when explicitly enabled', async () => {
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockImplementation(validBatchResponse);

    const report = await assess('<button>Save changes</button>');

    expect(report.inferenceStatus).toBe('completed');
    expect(report.modelLoaded).toBe(true);
    expect(report.assessments).toMatchObject([
      {
        ruleId: 'BUTTON-PURPOSE-CLARITY',
        assessment: 'no_issue_detected',
        confidence: null,
        source: 'qwen3.5-4b',
      },
    ]);
    expect(generateQwenText).toHaveBeenCalledOnce();
    expect(generateQwenText.mock.calls[0]?.[0]).toContain('Return exactly 1 codes');
  });

  it('keeps description evidence out of the naming review prompt', async () => {
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockImplementation(validBatchResponse);

    await assess(
      '<button aria-describedby="hint">Save changes</button><span id="hint">Saves your changes</span>',
    );

    const prompt = generateQwenText.mock.calls[0]?.[0] as string;
    expect(prompt).not.toContain('Saves your changes');
    expect(prompt).not.toContain('aria-describedby');
  });

  it('batches at most 10 Qwen targets per document and marks the remainder unassessed', async () => {
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockImplementation(validBatchResponse);

    const buttons = Array.from(
      { length: 11 },
      (_, index) => `<button>Action ${index}</button>`,
    ).join('');
    const report = await assess(`<main>${buttons}</main>`);

    expect(report.inferenceStatus).toBe('completed_with_limit');
    expect(generateQwenText).toHaveBeenCalledOnce();
    expect(
      report.assessments.filter(({ source }) => source === 'qwen3.5-4b'),
    ).toHaveLength(10);
    expect(report.assessments.at(-1)).toMatchObject({
      assessment: 'not_assessed',
      uncertainty: ['per-document-qwen-target-limit-reached'],
    });
  });

  it('rejects invalid response codes', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockResolvedValue('X');

    try {
      const report = await assess('<button>Continue</button>');

      expect(report.inferenceStatus).toBe('failed');
      expect(report.errorCode).toBe('qwen-inference-failed');
      expect(report.assessments[0]).toMatchObject({
        assessment: 'not_assessed',
        uncertainty: ['qwen-inference-failed'],
        source: 'evidence_gate',
      });
      expect(logError).toHaveBeenCalledOnce();
    } finally {
      logError.mockRestore();
    }
  });

  it('rejects response text that does not match the batch size', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockResolvedValue('not JSON');

    try {
      const report = await assess('<button>Continue</button>');

      expect(report.inferenceStatus).toBe('failed');
      expect(report.assessments[0]?.assessment).toBe('not_assessed');
      expect(report.errorCode).toBe('qwen-inference-failed');
    } finally {
      logError.mockRestore();
    }
  });

  it('surfaces local model load failures as not assessed', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockRejectedValue(new Error('local model load failed'));

    try {
      const report = await assess('<button>Continue</button>');

      expect(report.inferenceStatus).toBe('failed');
      expect(report.modelLoaded).toBe(false);
      expect(report.assessments[0]).toMatchObject({
        assessment: 'not_assessed',
        uncertainty: ['qwen-inference-failed'],
      });
      expect(logError).toHaveBeenCalledOnce();
    } finally {
      logError.mockRestore();
    }
  });

  it('returns an IBM-safe not-assessed report when Qwen exceeds its time budget', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    vi.useFakeTimers();
    generateQwenText.mockReturnValue(new Promise<string>(() => {}));

    try {
      const reportPromise = assess('<button>Continue</button>');
      await vi.advanceTimersByTimeAsync(40_000);
      const report = await reportPromise;

      expect(report.inferenceStatus).toBe('timed_out');
      expect(report.errorCode).toBe('qwen-response-time-budget-exceeded');
      expect(report.assessments[0]).toMatchObject({
        assessment: 'not_assessed',
        uncertainty: ['qwen-response-time-budget-exceeded'],
      });
      expect(logError).toHaveBeenCalledOnce();
    } finally {
      logError.mockRestore();
    }
  });

  it('does not queue another model generation while a timed-out run is still active', async () => {
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    isQwenGenerationInProgress.mockReturnValue(true);

    const report = await assess('<button>Continue</button>');

    expect(report.inferenceStatus).toBe('busy');
    expect(report.errorCode).toBe('qwen-inference-in-progress');
    expect(report.assessments[0]).toMatchObject({
      assessment: 'not_assessed',
      uncertainty: ['qwen-inference-in-progress'],
    });
    expect(generateQwenText).not.toHaveBeenCalled();
  });

  it('logs compact extracted context and Qwen output only when logging is enabled', async () => {
    const previousLogging = process.env.RAC_LOG_ANALYSIS;
    process.env.RAC_LOG_ANALYSIS = '1';
    const logInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
    generateQwenText.mockResolvedValue(
      '1',
    );

    try {
      const report = await assess('<button>Do it</button>');

      expect(report.assessments[0]).toMatchObject({
        assessment: 'potential_issue',
        explanation: 'Possible authored-name wording concern; review this target.',
      });
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('[analysis] context extracted'),
      );
      expect(logInfo.mock.calls[0]?.[0]).toContain('"text":"Do it"');
      expect(
        logInfo.mock.calls.some(
          ([message]) =>
            typeof message === 'string' &&
            message.includes('[qwen] batch completed') &&
            message.includes('potential_issue'),
        ),
      ).toBe(true);
    } finally {
      logInfo.mockRestore();
      if (previousLogging === undefined) {
        delete process.env.RAC_LOG_ANALYSIS;
      } else {
        process.env.RAC_LOG_ANALYSIS = previousLogging;
      }
    }
  });
});
