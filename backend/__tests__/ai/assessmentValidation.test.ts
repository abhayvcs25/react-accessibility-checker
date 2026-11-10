import { describe, expect, it } from 'vitest';
import {
  AssessmentValidationError,
  MAX_ASSESSMENT_RESPONSE_BYTES,
  parseAssessmentResponse,
  validateAssessment,
  type AssessmentValidationContext,
} from '../../src/ai/assessmentValidation.js';

const context: AssessmentValidationContext = {
  targetId: 'target-1',
  providerId: 'groq',
  modelId: 'openai/gpt-oss-20b',
  schemaVersion: 'schema-v1',
  allowedRuleIds: new Set(['color-contrast']),
  allowedEvidenceRefIds: new Set(['evidence-1', 'evidence-2']),
};

function assessment(overrides: Record<string, unknown> = {}) {
  return {
    targetId: 'target-1',
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

function expectFailure(
  callback: () => unknown,
  failure: AssessmentValidationError['failure'],
): void {
  let caught: unknown;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AssessmentValidationError);
  if (caught instanceof AssessmentValidationError) {
    expect(caught.failure).toBe(failure);
  }
}

describe('shared assessment normalization and validation', () => {
  it('parses valid JSON and canonicalizes its object keys', () => {
    const valid = parseAssessmentResponse(JSON.stringify(assessment()));

    expect(validateAssessment(valid, context)).toEqual({
      confidence: 0.8,
      evidenceRefs: ['evidence-1'],
      explanation: 'Violation: A visible text/background contrast issue was detected.',
      modelId: 'openai/gpt-oss-20b',
      providerId: 'groq',
      ruleId: 'color-contrast',
      status: 'potential_issue',
      targetId: 'target-1',
    });
  });

  it('distinguishes empty, malformed, and oversized output', () => {
    expectFailure(() => parseAssessmentResponse(' \r\n'), 'empty_output');
    expectFailure(() => parseAssessmentResponse('{"status":'), 'malformed_json');
    expectFailure(
      () => parseAssessmentResponse(' '.repeat(MAX_ASSESSMENT_RESPONSE_BYTES + 1)),
      'output_too_large',
    );
  });

  it('rejects missing and unexpected contract fields as schema-invalid', () => {
    const missing = assessment();
    delete (missing as Partial<typeof missing>).targetId;
    expectFailure(() => validateAssessment(missing, context), 'schema_invalid');
    expectFailure(
      () => validateAssessment(assessment({ ignored: true }), context),
      'schema_invalid',
    );
    expectFailure(
      () => validateAssessment(assessment({ confidence: null }), context),
      'schema_invalid',
    );
    expectFailure(
      () => validateAssessment(assessment({ confidence: Number.NaN }), context),
      'schema_invalid',
    );
  });

  it('rejects unsupported schema versions', () => {
    expectFailure(
      () => validateAssessment(assessment(), { ...context, schemaVersion: 'schema-v2' }),
      'unsupported_schema',
    );
  });

  it.each([
    ['unknown status', { status: 'pass' }],
    ['wrong target', { targetId: 'other-target' }],
    ['unknown rule', { ruleId: 'unknown-rule' }],
    ['foreign evidence', { evidenceRefs: ['outside-context'] }],
    ['ungrounded issue', { evidenceRefs: [] }],
    ['wrong provider', { providerId: 'cloudflare-workers-ai' }],
    ['wrong model', { modelId: 'openai/gpt-oss-120b' }],
  ])('rejects semantically invalid %s output', (_label, overrides) => {
    expectFailure(
      () => validateAssessment(assessment(overrides), context),
      'semantic_invalid',
    );
  });

  it('allows insufficient-context outcomes without evidence references', () => {
    expect(
      validateAssessment(
        assessment({
          status: 'insufficient_context',
          explanation: 'Insufficient context: the available evidence is incomplete.',
          evidenceRefs: [],
        }),
        context,
      ),
    ).toMatchObject({
      status: 'insufficient_context',
      evidenceRefs: [],
    });
  });

  it('requires the explanation to lead with the matching decision', () => {
    expectFailure(
      () =>
        validateAssessment(
          assessment({ explanation: 'The label may not explain the action.' }),
          context,
        ),
      'semantic_invalid',
    );
    expectFailure(
      () =>
        validateAssessment(
          assessment({
            status: 'no_issue_detected',
            explanation: 'Violation: the available evidence supports a clear label.',
          }),
          context,
        ),
      'semantic_invalid',
    );
  });

  it('accepts a correctly prefixed no-violation decision', () => {
    expect(
      validateAssessment(
        assessment({
          status: 'no_issue_detected',
          explanation: 'Not violation: the supplied label clearly identifies the action.',
        }),
        context,
      ),
    ).toMatchObject({ status: 'no_issue_detected' });
  });

  it('rejects duplicate evidence references', () => {
    expectFailure(
      () =>
        validateAssessment(
          assessment({ evidenceRefs: ['evidence-1', 'evidence-1'] }),
          context,
        ),
      'semantic_invalid',
    );
  });
});
