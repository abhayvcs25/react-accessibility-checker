import { describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { assessAdaptedContext } from '../../src/services/contextualAssessment.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';

function assess(html: string) {
  const extraction = extractHtmlContextResultV2(html);
  return assessAdaptedContext(adaptContextSnapshotV2(extraction));
}

describe('contextual assessment evidence gate', () => {
  it('abstains when static V2 lacks computed names and expected information', () => {
    const report = assess(
      '<form><label for="email">Email address</label><input id="email" type="email"></form>' +
        '<button aria-label="Continue">Continue</button>',
    );

    expect(report.inferenceStatus).toBe(
      'not_invoked_insufficient_context',
    );
    expect(report.modelLoaded).toBe(false);
    expect(report.assessments.map(({ ruleId }) => ruleId).sort()).toEqual([
      'ARIA-NAME-CLARITY',
      'BUTTON-PURPOSE-CLARITY',
      'FORM-LABEL-RELEVANCE',
    ]);
    expect(
      report.assessments.every(
        ({ assessment, confidence, source }) =>
          assessment === 'insufficient_context' &&
          confidence === null &&
          source === 'evidence_gate',
      ),
    ).toBe(true);

    const formAssessment = report.assessments.find(
      ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
    );
    expect(formAssessment?.uncertainty).toContain(
      'independently-evidenced-expected-information',
    );
    expect(formAssessment?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record: { recordType: 'target', id: expect.any(String) } }),
        expect.objectContaining({ record: { recordType: 'evidence', id: expect.any(String) }, text: 'Email address' }),
      ]),
    );
  });

  it('abstains when ambiguous native-label relationships were omitted by the adapter', () => {
    const report = assess(
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
        'native-label-association-not-captured',
      ]),
    );
  });

  it('does not report label relevance when no label relationship was captured', () => {
    const report = assess('<input type="email" placeholder="Email">');

    expect(
      report.assessments.some(
        ({ ruleId }) => ruleId === 'FORM-LABEL-RELEVANCE',
      ),
    ).toBe(false);
  });

  it('does not equate partial extraction with having no targets', () => {
    const report = assess('<div id="first" id="second">Not a target</div>');

    expect(report.inferenceStatus).toBe(
      'not_invoked_insufficient_context',
    );
    expect(report.assessments).toEqual([]);
  });

  it('does not fabricate assessments when the context adapter is unavailable', () => {
    const report = assessAdaptedContext({
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
});
