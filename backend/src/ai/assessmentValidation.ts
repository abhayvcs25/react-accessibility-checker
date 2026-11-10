import { Buffer } from 'node:buffer';

export const MAX_ASSESSMENT_RESPONSE_BYTES = 64 * 1024;
export const MAX_ASSESSMENT_EXPLANATION_LENGTH = 2_000;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AssessmentValidationFailure =
  | 'empty_output'
  | 'malformed_json'
  | 'output_too_large'
  | 'unsupported_schema'
  | 'schema_invalid'
  | 'semantic_invalid';

export class AssessmentValidationError extends Error {
  constructor(
    readonly failure: AssessmentValidationFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AssessmentValidationError';
  }
}

export interface AssessmentValidationContext {
  targetId: string;
  providerId: string;
  modelId: string;
  schemaVersion: string;
  allowedRuleIds: ReadonlySet<string>;
  allowedEvidenceRefIds: ReadonlySet<string>;
}

const SUPPORTED_SCHEMA_VERSIONS = new Set(['schema-v1']);
const ALLOWED_FIELDS = new Set([
  'targetId',
  'ruleId',
  'status',
  'explanation',
  'evidenceRefs',
  'confidence',
  'providerId',
  'modelId',
]);
const ALLOWED_STATUSES = new Set([
  'potential_issue',
  'no_issue_detected',
  'insufficient_context',
]);
const REQUIRED_EXPLANATION_PREFIX: Record<string, string> = {
  potential_issue: 'Violation:',
  no_issue_detected: 'Not violation:',
  insufficient_context: 'Insufficient context:',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AssessmentValidationError(
        'schema_invalid',
        'Assessment data must contain plain JSON objects.',
      );
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  throw new AssessmentValidationError(
    'schema_invalid',
    'Assessment data contains a value that is not valid JSON.',
  );
}

function failSchema(message: string): never {
  throw new AssessmentValidationError('schema_invalid', message);
}

function failSemantic(message: string): never {
  throw new AssessmentValidationError('semantic_invalid', message);
}

export function parseAssessmentResponse(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_ASSESSMENT_RESPONSE_BYTES) {
    throw new AssessmentValidationError(
      'output_too_large',
      'The assessment response exceeds the configured size limit.',
    );
  }
  if (text.trim().length === 0) {
    throw new AssessmentValidationError(
      'empty_output',
      'The provider returned an empty assessment response.',
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new AssessmentValidationError(
      'malformed_json',
      'The provider returned malformed JSON.',
    );
  }
}

export function validateAssessment(
  value: unknown,
  context: AssessmentValidationContext,
): JsonValue {
  if (!SUPPORTED_SCHEMA_VERSIONS.has(context.schemaVersion)) {
    throw new AssessmentValidationError(
      'unsupported_schema',
      'The assessment schema version is not supported.',
    );
  }
  if (!isRecord(value)) {
    failSchema('The assessment response must be a JSON object.');
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => !ALLOWED_FIELDS.has(key)) ||
    [
      'targetId',
      'ruleId',
      'status',
      'explanation',
      'evidenceRefs',
      'providerId',
      'modelId',
    ].some((key) => !Object.hasOwn(value, key))
  ) {
    failSchema('The assessment response has missing or unsupported fields.');
  }
  if (
    typeof value.targetId !== 'string' ||
    typeof value.ruleId !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.explanation !== 'string' ||
    !Array.isArray(value.evidenceRefs) ||
    typeof value.providerId !== 'string' ||
    typeof value.modelId !== 'string'
  ) {
    failSchema('The assessment response contains fields of the wrong type.');
  }
  if (
    value.explanation.trim().length === 0 ||
    value.explanation.length > MAX_ASSESSMENT_EXPLANATION_LENGTH ||
    value.evidenceRefs.some((reference) => typeof reference !== 'string') ||
    (value.confidence !== undefined &&
      (typeof value.confidence !== 'number' ||
        !Number.isFinite(value.confidence) ||
        value.confidence < 0 ||
        value.confidence > 1))
  ) {
    failSchema('The assessment response contains invalid field values.');
  }
  if (
    value.targetId !== context.targetId ||
    !context.allowedRuleIds.has(value.ruleId) ||
    !ALLOWED_STATUSES.has(value.status) ||
    value.providerId !== context.providerId ||
    value.modelId !== context.modelId ||
    !value.explanation.startsWith(
      REQUIRED_EXPLANATION_PREFIX[value.status] ?? '',
    ) ||
    new Set(value.evidenceRefs).size !== value.evidenceRefs.length ||
    value.evidenceRefs.some(
      (reference) =>
        typeof reference !== 'string' ||
        !context.allowedEvidenceRefIds.has(reference),
    ) ||
    (value.status !== 'insufficient_context' &&
      value.evidenceRefs.length === 0)
  ) {
    failSemantic(
      'The assessment does not match the dispatched target, rule, provider, model, or evidence.',
    );
  }

  const normalized = canonicalize(value);
  if (
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') >
    MAX_ASSESSMENT_RESPONSE_BYTES
  ) {
    throw new AssessmentValidationError(
      'output_too_large',
      'The normalized assessment exceeds the configured size limit.',
    );
  }
  return normalized;
}
