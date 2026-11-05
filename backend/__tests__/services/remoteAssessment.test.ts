import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateProviderCompletion } = vi.hoisted(() => ({
  generateProviderCompletion: vi.fn(),
}));

vi.mock('../../src/ai/providerClient.js', () => ({
  generateProviderCompletion,
}));

import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';
import { assessUnitsWithRemoteAi } from '../../src/services/remoteAssessment.js';

function getFormWorkItem(label: string) {
  const adapted = adaptContextSnapshotV2(
    extractHtmlContextResultV2(
      `<form><label for="email">${label}</label><input id="email" type="email"></form>`,
    ),
  );
  if (!('input' in adapted)) {
    throw new Error('Expected the form context to be available for the test.');
  }
  const unit = adapted.input.units.find(
    (candidate) => candidate.focal.kind === 'form-control',
  );
  if (!unit) {
    throw new Error('Expected a form-control context unit for the test.');
  }
  return {
    ruleId: 'FORM-LABEL-RELEVANCE' as const,
    unit,
    workIndex: 0,
  };
}

async function assessResponse(text: string, label: string) {
  generateProviderCompletion.mockResolvedValueOnce({
    text,
    inputTokens: 10,
    outputTokens: 10,
    rateLimited: false,
  });
  const [outcome] = await assessUnitsWithRemoteAi([getFormWorkItem(label)]);
  if (!outcome) {
    throw new Error('Expected a remote assessment outcome.');
  }
  return outcome;
}

describe('remote model assessment response parsing', () => {
  beforeEach(() => {
    generateProviderCompletion.mockReset();
  });

  it('accepts whitespace around valid JSON and preserves the assessment', async () => {
    const outcome = await assessResponse(
      ` \n{\n  "assessment": "no_issue_detected",\n  "explanation": "The label matches the control."\n}\n `,
      'Email address',
    );

    expect(outcome.assessment).toMatchObject({
      assessment: 'no_issue_detected',
      explanation: 'The label matches the control.',
    });
  });

  it('accepts JSON inside a Markdown code fence', async () => {
    const outcome = await assessResponse(
      '```json\n{"assessment":"potential_issue","explanation":"The label is unclear."}\n```',
      'Work email',
    );

    expect(outcome.assessment).toMatchObject({
      assessment: 'potential_issue',
      explanation: 'The label is unclear.',
    });
  });

  it('accepts one complete assessment object surrounded by text', async () => {
    const outcome = await assessResponse(
      'Here is the assessment:\n{"assessment":"insufficient_context","explanation":"The supplied evidence is incomplete."}\nEnd of response.',
      'Preferred contact',
    );

    expect(outcome.assessment).toMatchObject({
      assessment: 'insufficient_context',
      explanation: 'The supplied evidence is incomplete.',
    });
  });

  it('reports malformed JSON without logging the response text', async () => {
    const sensitiveText = 'sensitive-response-fragment';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await assessResponse(
      `not JSON ${sensitiveText} {"assessment":`,
      'Billing email',
    );

    expect(outcome.error?.message).toContain('invalid JSON');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitiveText);
  });

  it('rejects JSON missing required assessment fields', async () => {
    const outcome = await assessResponse(
      '{"assessment":"no_issue_detected"}',
      'Login email',
    );

    expect(outcome.error?.message).toContain(
      'invalid assessment object',
    );
    expect(outcome.assessment).toBeUndefined();
  });

  it.each([
    ['{"assessment":"unknown","explanation":"The label is unclear."}', 'Unknown assessment'],
    ['{"assessment":"potential_issue","explanation":"   "}', 'Blank explanation'],
    [
      `{"assessment":"potential_issue","explanation":"${'x'.repeat(501)}"}`,
      'Overlong explanation',
    ],
  ])('rejects responses that violate the assessment schema', async (text, label) => {
    const outcome = await assessResponse(text, label);

    expect(outcome.error?.message).toContain(
      'invalid assessment object',
    );
    expect(outcome.assessment).toBeUndefined();
  });
});
