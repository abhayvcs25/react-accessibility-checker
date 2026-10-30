import type {
  ContextAdapterResult,
  ContextCompleteness,
  ContextAriaAttribute,
  ContextRecordRef,
  ContextRelationship,
  ContextSnapshot,
  ContextUnavailableReason,
  AdapterUnitTruncation,
  EvaluationTarget,
  SupportingEvidence,
  TargetContextInputUnit,
  TargetEvidenceRelationship,
  TargetRelationshipProjection,
} from '../types/contextV2.js';
import { CONTEXT_SCHEMA_V2 } from '../types/contextV2.js';

export const MAX_V2_ASSOCIATED_EVIDENCE_RECORDS = 8;
export const MAX_V2_GROUP_SERIALIZED_CHARACTERS = 8_000;
export const MAX_V2_GROUP_EVIDENCE_CHARACTERS = 2_400;

const MAX_RECORDS = 500;
const MAX_RECORD_ID_LENGTH = 64;
const MAX_ID_REFERENCE_TARGETS_PER_ID = 20;
const INPUT_PLACEHOLDER_TYPES = [
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is { value: string; truncated: boolean } {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    typeof value.truncated === 'boolean'
  );
}

function isAttributeObservation(
  value: unknown,
  isValue: (value: unknown) => boolean,
): boolean {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'present') return isValue(value.value);
  if (value.status === 'absent') return true;
  if (value.status === 'invalid') return isBoundedString(value.raw);
  if (value.status === 'unavailable') {
    return ['parser-normalized-duplicate', 'extraction-limit'].includes(
      String(value.reason),
    );
  }
  if (value.status === 'ambiguous') {
    return (
      Array.isArray(value.candidates) &&
      value.candidates.every(isValue) &&
      Number.isInteger(value.totalCandidateCount) &&
      typeof value.totalCandidateCount === 'number' &&
      typeof value.additionalCandidateCount === 'number' &&
      value.totalCandidateCount >= value.candidates.length &&
      value.additionalCandidateCount ===
        value.totalCandidateCount - value.candidates.length
    );
  }
  return false;
}

function isBooleanAttributeState(value: unknown): boolean {
  return ['present', 'absent', 'unavailable'].includes(String(value));
}

function isRecordCompleteness(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.status === 'complete') return true;
  return (
    value.status === 'partial' &&
    Array.isArray(value.truncations) &&
    value.truncations.length > 0 &&
    value.truncations.every((truncation) =>
      ['text-limit', 'attribute-value-limit', 'aria-attribute-limit'].includes(
        String(truncation),
      ),
    )
  );
}

function isDocumentField(value: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'present') {
    return typeof value.value === 'string' && typeof value.truncated === 'boolean';
  }
  if (value.status === 'absent') return true;
  if (value.status === 'invalid') {
    return (
      ['empty', 'malformed', 'multiple-values'].includes(String(value.reason)) &&
      (value.raw === undefined || isBoundedString(value.raw))
    );
  }
  return (
    value.status === 'unavailable' &&
    ['not-parsed', 'field-parse-failure'].includes(String(value.reason))
  );
}

function isDocumentContext(value: unknown): value is ContextSnapshot['document'] {
  return (
    isRecord(value) &&
    isDocumentField(value.title) &&
    isDocumentField(value.language)
  );
}

function isSnapshotCompleteness(value: unknown): value is ContextCompleteness {
  if (
    !isRecord(value) ||
    !isRecord(value.relationshipResolution) ||
    !Number.isInteger(value.relationshipResolution.unresolvedCount) ||
    !Number.isInteger(value.relationshipResolution.ambiguousCount) ||
    (value.relationshipResolution.unresolvedCount as number) < 0 ||
    (value.relationshipResolution.ambiguousCount as number) < 0 ||
    !Array.isArray(value.policyOmissions) ||
    !value.policyOmissions.every(
      (omission) =>
        isRecord(omission) &&
        [
          'non-target-node',
          'unsupported-role',
          'unsupported-evidence-category',
          'script-or-style-content',
        ].includes(String(omission.category)) &&
        (omission.count === undefined ||
          (Number.isInteger(omission.count) && (omission.count as number) >= 0)),
    )
  ) {
    return false;
  }
  if (value.status === 'complete') {
    return Array.isArray(value.truncations) && value.truncations.length === 0;
  }
  return (
    value.status === 'partial' &&
    Array.isArray(value.truncations) &&
    value.truncations.length > 0 &&
    value.truncations.every(
      (truncation) =>
        isRecord(truncation) &&
        ['snapshot', 'target', 'evidence', 'relationship'].includes(
          String(truncation.scope),
        ) &&
        [
          'record-count',
          'text-length',
          'attribute-value-length',
          'aria-attribute-count',
          'idref-character-count',
          'idref-token-count',
          'duplicate-id-candidates',
        ].includes(String(truncation.limit)) &&
        (truncation.recordId === undefined ||
          typeof truncation.recordId === 'string') &&
        (truncation.omittedCount === undefined ||
          (Number.isInteger(truncation.omittedCount) &&
            (truncation.omittedCount as number) >= 0)),
    )
  );
}

const ARIA_ATTRIBUTE_NAMES: ContextAriaAttribute[] = [
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-level',
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-pressed',
  'aria-disabled',
  'aria-required',
  'aria-invalid',
  'aria-controls',
  'aria-owns',
  'aria-valuenow',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuetext',
  'aria-orientation',
  'aria-haspopup',
  'aria-activedescendant',
];

function isAriaValue(name: ContextAriaAttribute, value: unknown): boolean {
  const boolean = (item: unknown) => typeof item === 'boolean';
  const string = (item: unknown) => isBoundedString(item);
  const number = (item: unknown) =>
    typeof item === 'number' && Number.isFinite(item);
  const oneOf = (...values: unknown[]) => (item: unknown) => values.includes(item);
  const valueValidator =
    name === 'aria-hidden' ||
    name === 'aria-selected' ||
    name === 'aria-expanded' ||
    name === 'aria-disabled' ||
    name === 'aria-required'
      ? boolean
      : name === 'aria-level'
        ? (item: unknown) =>
            typeof item === 'number' &&
            number(item) &&
            Number.isInteger(item) &&
            item > 0
        : name === 'aria-checked' || name === 'aria-pressed'
          ? (item: unknown) => boolean(item) || item === 'mixed'
          : name === 'aria-invalid'
            ? (item: unknown) =>
                boolean(item) || item === 'grammar' || item === 'spelling'
            : name === 'aria-valuenow' ||
                name === 'aria-valuemin' ||
                name === 'aria-valuemax'
              ? number
              : name === 'aria-orientation'
                ? oneOf('horizontal', 'vertical')
                : name === 'aria-haspopup'
                  ? (item: unknown) =>
                      boolean(item) ||
                      ['menu', 'listbox', 'tree', 'grid', 'dialog'].includes(
                        String(item),
                      )
                  : string;
  return isAttributeObservation(value, valueValidator);
}

function isCommonAttributes(attributes: Record<string, unknown>): boolean {
  if (
    !isAttributeObservation(attributes.authoredId, isBoundedString) ||
    !isAttributeObservation(attributes.role, isBoundedString) ||
    !isRecord(attributes.aria) ||
    typeof attributes.aria.truncated !== 'boolean' ||
    !isRecord(attributes.aria.values) ||
    !isAttributeObservation(attributes.title, isBoundedString) ||
    !isBooleanAttributeState(attributes.hidden) ||
    !isBooleanAttributeState(attributes.inert) ||
    !isAttributeObservation(
      attributes.tabIndex,
      (value) => Number.isInteger(value),
    )
  ) {
    return false;
  }
  return Object.entries(attributes.aria.values).every(
    ([name, value]) =>
      ARIA_ATTRIBUTE_NAMES.includes(name as ContextAriaAttribute) &&
      isAriaValue(name as ContextAriaAttribute, value),
  );
}

function attributeStringValue(value: unknown): string | undefined {
  if (
    isRecord(value) &&
    value.status === 'present' &&
    isBoundedString(value.value)
  ) {
    return value.value.value;
  }
  return undefined;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

const COMMON_ATTRIBUTE_KEYS = [
  'authoredId',
  'role',
  'aria',
  'title',
  'hidden',
  'inert',
  'tabIndex',
];

function isValidTarget(value: unknown): value is EvaluationTarget {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > MAX_RECORD_ID_LENGTH ||
    typeof value.tagName !== 'string' ||
    !isRecord(value.basis) ||
    !isRecord(value.attributes) ||
    !isCommonAttributes(value.attributes) ||
    !isRecordCompleteness(value.completeness) ||
    (value.text !== undefined && !isBoundedString(value.text))
  ) {
    return false;
  }
  const { kind, tagName, basis, attributes } = value;
  const nativeBasis =
    basis.type === 'native-html' && hasOnlyKeys(basis, ['type']);
  const attributesHaveOnly = (...keys: string[]) =>
    hasOnlyKeys(attributes, [...COMMON_ATTRIBUTE_KEYS, ...keys]);
  const validStringAttribute = (name: string) =>
    isAttributeObservation(attributes[name], isBoundedString);
  const validBooleanAttribute = (name: string) =>
    isBooleanAttributeState(attributes[name]);

  if (kind === 'image') {
    const inputType = attributeStringValue(attributes.inputType);
    return (
      nativeBasis &&
      (tagName === 'img' ||
        (tagName === 'input' && inputType?.toLowerCase() === 'image')) &&
      validStringAttribute('alt') &&
      attributesHaveOnly(
        'alt',
        ...(tagName === 'input' ? ['inputType'] : []),
      ) &&
      (tagName === 'img' ? !('inputType' in attributes) : validStringAttribute('inputType'))
    );
  }
  if (kind === 'link') {
    return (
      nativeBasis &&
      ['a', 'area'].includes(tagName) &&
      attributesHaveOnly('href', 'hrefKind') &&
      validStringAttribute('href') &&
      attributeStringValue(attributes.href) !== undefined &&
      (attributes.hrefKind === undefined ||
        ['fragment', 'same-document', 'external'].includes(
          String(attributes.hrefKind),
        )) &&
      (attributes.hrefKind === undefined ||
        attributeStringValue(attributes.href) !== undefined)
    );
  }
  if (kind === 'button') {
    if (!nativeBasis || !validBooleanAttribute('disabled')) return false;
    if (tagName === 'button') {
      return (
        attributesHaveOnly('disabled') &&
        !('inputType' in attributes) &&
        !('value' in attributes)
      );
    }
    if (tagName !== 'input') return false;
    const inputType = attributeStringValue(attributes.inputType)?.toLowerCase();
    return (
      ['button', 'submit', 'reset'].includes(inputType ?? '') &&
      attributesHaveOnly('disabled', 'inputType', 'value') &&
      validStringAttribute('inputType') &&
      validStringAttribute('value')
    );
  }
  if (kind === 'form-control') {
    if (
      !nativeBasis ||
      !validStringAttribute('name') ||
      !validBooleanAttribute('required') ||
      !validBooleanAttribute('disabled') ||
      !attributesHaveOnly(
        'name',
        'required',
        'disabled',
        'inputType',
        'checked',
        'selected',
        'placeholder',
      )
    ) {
      return false;
    }
    if (tagName === 'input') {
      const inputType = attributeStringValue(attributes.inputType)?.toLowerCase();
      const type = inputType ?? 'text';
      return (
        validStringAttribute('inputType') &&
        !['hidden', 'image', 'button', 'submit', 'reset'].includes(type) &&
        !('selected' in attributes) &&
        (type === 'checkbox' || type === 'radio'
          ? validBooleanAttribute('checked')
          : !('checked' in attributes)) &&
        (INPUT_PLACEHOLDER_TYPES.includes(type)
          ? validStringAttribute('placeholder')
          : !('placeholder' in attributes))
      );
    }
    if (tagName === 'select') {
      return (
        !('inputType' in attributes) &&
        !('checked' in attributes) &&
        !('placeholder' in attributes) &&
        validBooleanAttribute('selected')
      );
    }
    return (
      tagName === 'textarea' &&
      !('inputType' in attributes) &&
      !('checked' in attributes) &&
      !('selected' in attributes) &&
      validStringAttribute('placeholder')
    );
  }
  if (kind === 'heading') {
    return (
      ((nativeBasis && /^h[1-6]$/.test(tagName)) ||
        (basis.type === 'aria-heading' &&
          hasOnlyKeys(basis, ['type']) &&
          tagName.length > 0 &&
          typeof attributeStringValue(attributes.role) === 'string' &&
          attributeStringValue(attributes.role)?.toLowerCase().split(/\s+/)[0] ===
            'heading')) &&
      attributesHaveOnly() &&
      (value.headingLevel === undefined ||
        (Number.isInteger(value.headingLevel) &&
          (value.headingLevel as number) >= 1 &&
          (value.headingLevel as number) <= 6))
    );
  }
  if (kind === 'custom-widget') {
    return (
      basis.type === 'aria-widget' &&
      hasOnlyKeys(basis, ['type', 'role']) &&
      attributesHaveOnly() &&
      typeof basis.role === 'string' &&
      ['button', 'checkbox', 'radio', 'switch', 'slider', 'textbox', 'combobox', 'listbox', 'searchbox', 'spinbutton'].includes(basis.role) &&
      attributeStringValue(attributes.role)?.toLowerCase().split(/\s+/)[0] ===
        basis.role
    );
  }
  return (
    kind === 'other' &&
    basis.type === 'explicit-policy' &&
    hasOnlyKeys(basis, ['type', 'policyId']) &&
    attributesHaveOnly() &&
    typeof basis.policyId === 'string' &&
    basis.policyId.length > 0
  );
}

function isValidSourceLocator(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'dom-path') {
    if (
      value.format !== 'element-index-path-v1' ||
      typeof value.path !== 'string' ||
      !value.path.startsWith('/')
    ) {
      return false;
    }
    const segments = value.path.slice(1).split('/');
    return (
      segments.length > 0 &&
      segments.every((segment) => {
        const match = /^([^\[\]/\s]+)\[([1-9]\d*)\]$/.exec(segment);
        return match !== null && Number.isSafeInteger(Number(match[2]));
      })
    );
  }
  return (
    value.kind === 'html-source-range' &&
    Number.isInteger(value.startOffset) &&
    Number.isInteger(value.endOffset) &&
    (value.startOffset as number) >= 0 &&
    (value.endOffset as number) >= (value.startOffset as number) &&
    value.sourceLanguage === 'html' &&
    value.offsetUnit === 'utf16-code-unit'
  );
}

function isValidRef(
  value: unknown,
  targets: Map<string, EvaluationTarget>,
  evidence: Map<string, SupportingEvidence>,
): value is ContextRecordRef {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  if (value.recordType === 'target') return targets.has(value.id);
  if (value.recordType === 'evidence') return evidence.has(value.id);
  return false;
}

function isLabelableTarget(target: EvaluationTarget): boolean {
  return (
    ['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'].includes(
      target.tagName,
    ) &&
    !(
      target.tagName === 'input' &&
        'inputType' in target.attributes &&
        target.attributes.inputType?.status === 'present' &&
        target.attributes.inputType.value.value.toLowerCase() === 'hidden'
      )
  );
}

function isValidRelationship(
  value: unknown,
  targets: Map<string, EvaluationTarget>,
  evidence: Map<string, SupportingEvidence>,
): value is ContextRelationship {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > MAX_RECORD_ID_LENGTH ||
    !isRecord(value.provenance) ||
    !isRecord(value.completeness) ||
    !(
      value.completeness.status === 'complete' ||
      (value.completeness.status === 'partial' &&
        value.completeness.reason === 'candidate-list-limit')
    )
  ) {
    return false;
  }
  if (value.kind === 'parent-child') {
    return (
      value.direction === 'parent-to-child' &&
      isValidRef(value.source, targets, evidence) &&
      isRecord(value.destination) &&
      value.destination.status === 'resolved' &&
      isValidRef(value.destination.record, targets, evidence) &&
      value.provenance.basis === 'structural-html' &&
      hasOnlyKeys(value.provenance, ['basis', 'ruleId']) &&
      typeof value.provenance.ruleId === 'string' &&
      value.provenance.ruleId.length > 0
    );
  }
  if (
    !['native-label', 'aria-labelledby', 'aria-describedby', 'structural-context'].includes(
      String(value.kind),
    ) ||
    value.direction !== 'target-to-associated-record' ||
    !isRecord(value.source) ||
    value.source.recordType !== 'target' ||
    !targets.has(String(value.source.id)) ||
    !isRecord(value.destination)
  ) {
    return false;
  }
  if (value.destination.status === 'resolved') {
    if (!isValidRef(value.destination.record, targets, evidence)) return false;
  } else if (value.destination.status === 'ambiguous') {
    if (
      !isBoundedString(value.destination.authoredId) ||
      !Array.isArray(value.destination.candidates) ||
      !Number.isInteger(value.destination.totalCandidateCount) ||
      typeof value.destination.totalCandidateCount !== 'number' ||
      typeof value.destination.additionalCandidateCount !== 'number' ||
      value.destination.totalCandidateCount < value.destination.candidates.length ||
      value.destination.additionalCandidateCount !==
        value.destination.totalCandidateCount - value.destination.candidates.length ||
      !value.destination.candidates.every((candidate) =>
        isValidRef(candidate, targets, evidence),
      )
    ) {
      return false;
    }
  } else if (
    value.destination.status === 'unresolved'
      ? !isBoundedString(value.destination.authoredId) ||
        !['not-found', 'excluded-by-policy', 'truncated'].includes(
          String(value.destination.reason),
        ) ||
        !['for', 'aria-labelledby', 'aria-describedby'].includes(
          String(value.destination.attribute),
        )
      : true
  ) {
    return false;
  }
  if (
    value.provenance.basis === 'aria-idref' &&
    !['aria-labelledby', 'aria-describedby'].includes(
      String(value.provenance.attribute),
    )
  ) {
    return false;
  }
  if (
    value.provenance.basis === 'native-html' &&
    value.provenance.attribute !== undefined &&
    value.provenance.attribute !== 'for'
  ) {
    return false;
  }
  const provenance = value.provenance;
  const destinationAttribute =
    value.destination.status === 'unresolved' ||
    value.destination.status === 'ambiguous'
      ? value.destination.attribute
      : undefined;
  if (value.kind === 'native-label') {
    if (
      provenance.basis !== 'native-html' ||
      !hasOnlyKeys(provenance, ['basis', 'attribute', 'authoredReference']) ||
      (provenance.attribute !== undefined && provenance.attribute !== 'for') ||
      (provenance.authoredReference !== undefined &&
        !isBoundedString(provenance.authoredReference)) ||
      (provenance.attribute === 'for' &&
        !isBoundedString(provenance.authoredReference)) ||
      (destinationAttribute !== undefined && destinationAttribute !== 'for') ||
      (value.destination.status === 'resolved' &&
        (!isRecord(value.destination.record) ||
          value.destination.record.recordType !== 'evidence')) ||
      (value.sourceResolution !== undefined &&
        provenance.attribute !== 'for')
    ) {
      return false;
    }
  } else if (
    value.kind === 'aria-labelledby' ||
    value.kind === 'aria-describedby'
  ) {
    if (
      provenance.basis !== 'aria-idref' ||
      !hasOnlyKeys(provenance, [
        'basis',
        'attribute',
        'authoredReference',
      ]) ||
      provenance.attribute !== value.kind ||
      !isBoundedString(provenance.authoredReference) ||
      (destinationAttribute !== undefined &&
        destinationAttribute !== value.kind) ||
      value.sourceResolution !== undefined
    ) {
      return false;
    }
  } else if (
    value.kind === 'structural-context' &&
    !(
      (provenance.basis === 'structural-html' ||
        provenance.basis === 'extraction-heuristic') &&
      hasOnlyKeys(provenance, ['basis', 'ruleId']) &&
      typeof provenance.ruleId === 'string' &&
      provenance.ruleId.length > 0 &&
      value.sourceResolution === undefined
    )
  ) {
    return false;
  }
  if (value.sourceResolution !== undefined) {
    const resolution = value.sourceResolution;
    if (
      !isRecord(resolution) ||
      resolution.status !== 'ambiguous' ||
      !isBoundedString(resolution.authoredId)
    ) {
      return false;
    }
    const authoredId = resolution.authoredId;
    const sourceId =
      isRecord(value.source) && typeof value.source.id === 'string'
        ? value.source.id
        : undefined;
    const hasAuthoredId = (id: string) => {
      const target = targets.get(id);
      return (
        target !== undefined &&
        isLabelableTarget(target) &&
        target.attributes.authoredId.status === 'present' &&
        target.attributes.authoredId.value.value === authoredId.value
      );
    };
    const matchingTargets = [...targets.values()].filter(
      (target) =>
        isLabelableTarget(target) &&
        target.attributes.authoredId.status === 'present' &&
        target.attributes.authoredId.value.value === authoredId.value,
    );
    const candidateIds = Array.isArray(resolution.candidates)
      ? resolution.candidates.map((candidate) =>
          isRecord(candidate) && typeof candidate.id === 'string'
            ? candidate.id
            : '',
        )
      : [];
    const hasTruncatedIdCollision = [...targets.values()].some(
      (target) =>
        isLabelableTarget(target) &&
        target.attributes.authoredId.status === 'present' &&
        target.attributes.authoredId.value.value === authoredId.value &&
        target.attributes.authoredId.value.truncated,
    );
    const candidateListIsVerifiable =
      !authoredId.truncated && !hasTruncatedIdCollision;
    if (
      !Array.isArray(resolution.candidates) ||
      resolution.candidates.length > MAX_ID_REFERENCE_TARGETS_PER_ID ||
      !resolution.candidates.every(
        (candidate) =>
          isRecord(candidate) &&
          candidate.recordType === 'target' &&
          typeof candidate.id === 'string' &&
          hasAuthoredId(candidate.id),
      ) ||
      !Number.isInteger(resolution.totalCandidateCount) ||
      typeof resolution.totalCandidateCount !== 'number' ||
      typeof resolution.additionalCandidateCount !== 'number' ||
      resolution.totalCandidateCount <= 1 ||
      resolution.candidates.length !==
        Math.min(
          resolution.totalCandidateCount,
          MAX_ID_REFERENCE_TARGETS_PER_ID,
        ) ||
      resolution.additionalCandidateCount !==
        resolution.totalCandidateCount - resolution.candidates.length ||
      new Set(
        resolution.candidates.map((candidate) =>
          isRecord(candidate) && typeof candidate.id === 'string'
            ? candidate.id
            : '',
        ),
      ).size !== resolution.candidates.length ||
      (candidateListIsVerifiable &&
        (resolution.totalCandidateCount !== matchingTargets.length ||
          candidateIds.some(
            (id, index) => id !== matchingTargets[index]?.id,
          ))) ||
      (!candidateListIsVerifiable &&
        resolution.totalCandidateCount > matchingTargets.length) ||
      (!resolution.candidates.some(
        (candidate) =>
          isRecord(candidate) &&
          candidate.recordType === 'target' &&
          candidate.id === sourceId,
      ) &&
        !(
          resolution.candidates.length === MAX_ID_REFERENCE_TARGETS_PER_ID &&
          resolution.additionalCandidateCount > 0
        )) ||
      typeof sourceId !== 'string' ||
      !hasAuthoredId(sourceId) ||
      (resolution.additionalCandidateCount > 0 &&
        resolution.candidates.length !== MAX_ID_REFERENCE_TARGETS_PER_ID) ||
      !isBoundedString(provenance.authoredReference) ||
      provenance.authoredReference.value !== authoredId.value
    ) {
      return false;
    }
  }
  const hasOmittedDestinationCandidates =
    isRecord(value.destination) &&
    value.destination.status === 'ambiguous' &&
    typeof value.destination.additionalCandidateCount === 'number' &&
    value.destination.additionalCandidateCount > 0;
  const hasOmittedSourceCandidates =
    isRecord(value.sourceResolution) &&
    typeof value.sourceResolution.additionalCandidateCount === 'number' &&
    value.sourceResolution.additionalCandidateCount > 0;
  if (
    (hasOmittedDestinationCandidates || hasOmittedSourceCandidates) &&
    value.completeness.status !== 'partial'
  ) {
    return false;
  }
  return true;
}

function isPartialSnapshot(
  snapshot: ContextSnapshot,
): snapshot is ContextSnapshot & {
  completeness: Extract<ContextCompleteness, { status: 'partial' }>;
} {
  return snapshot.completeness.status === 'partial';
}

function isCompleteSnapshot(
  snapshot: ContextSnapshot,
): snapshot is ContextSnapshot & {
  completeness: Extract<ContextCompleteness, { status: 'complete' }>;
} {
  return snapshot.completeness.status === 'complete';
}

function isValidSnapshot(value: unknown): value is ContextSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CONTEXT_SCHEMA_V2 ||
    !isDocumentContext(value.document) ||
    !Array.isArray(value.targets) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.relationships) ||
    value.targets.length + value.evidence.length > MAX_RECORDS ||
    !isSnapshotCompleteness(value.completeness)
  ) {
    return false;
  }

  const targets: EvaluationTarget[] = [];
  const evidence: SupportingEvidence[] = [];
  const targetMap = new Map<string, EvaluationTarget>();
  const evidenceMap = new Map<string, SupportingEvidence>();
  for (const rawTarget of value.targets) {
    if (!isValidTarget(rawTarget)) return false;
    const target = rawTarget;
    if (targetMap.has(target.id)) return false;
    if (
      target.sourceLocator !== undefined &&
      !isValidSourceLocator(target.sourceLocator)
    ) {
      return false;
    }
    targetMap.set(target.id, target);
    targets.push(target);
  }

  for (const rawEvidence of value.evidence) {
    if (
      !isRecord(rawEvidence) ||
      typeof rawEvidence.id !== 'string' ||
      rawEvidence.id.length === 0 ||
      rawEvidence.id.length > MAX_RECORD_ID_LENGTH ||
      targetMap.has(rawEvidence.id) ||
      evidenceMap.has(rawEvidence.id) ||
      !['native-label', 'aria-reference', 'structural-context'].includes(
        String(rawEvidence.kind),
      ) ||
      !isRecordCompleteness(rawEvidence.completeness) ||
      (rawEvidence.tagName !== undefined &&
        typeof rawEvidence.tagName !== 'string') ||
      (rawEvidence.text !== undefined &&
        !isBoundedString(rawEvidence.text)) ||
      (rawEvidence.sourceLocator !== undefined &&
        !isValidSourceLocator(rawEvidence.sourceLocator))
    ) {
      return false;
    }
    if (rawEvidence.attributes !== undefined) {
      if (!isRecord(rawEvidence.attributes)) return false;
      const attributes = rawEvidence.attributes;
      if (
        (attributes.authoredId !== undefined &&
          !isAttributeObservation(attributes.authoredId, isBoundedString)) ||
        (attributes.role !== undefined &&
          !isAttributeObservation(attributes.role, isBoundedString)) ||
        (attributes.aria !== undefined &&
          (!isRecord(attributes.aria) ||
            typeof attributes.aria.truncated !== 'boolean' ||
            !isRecord(attributes.aria.values) ||
            !Object.entries(attributes.aria.values).every(
              ([name, ariaValue]) =>
                ARIA_ATTRIBUTE_NAMES.includes(name as ContextAriaAttribute) &&
                isAriaValue(name as ContextAriaAttribute, ariaValue),
            )))
      ) {
        return false;
      }
    }
    const item = rawEvidence as unknown as SupportingEvidence;
    evidenceMap.set(item.id, item);
    evidence.push(item);
  }

  const relationshipIds = new Set<string>();
  for (const rawRelationship of value.relationships) {
    if (
      !isValidRelationship(rawRelationship, targetMap, evidenceMap) ||
      relationshipIds.has(rawRelationship.id)
    ) return false;
    relationshipIds.add(rawRelationship.id);
  }
  return isCompletenessConsistent(
    value.completeness,
    value.document,
    targets,
    evidence,
    value.relationships,
  );
}

function isCompletenessConsistent(
  completeness: ContextCompleteness,
  document: ContextSnapshot['document'],
  targets: EvaluationTarget[],
  evidence: SupportingEvidence[],
  relationships: ContextRelationship[],
): boolean {
  const truncations = completeness.truncations;
  const hasTruncation = (
    scope: string,
    limit: string,
    recordId?: string,
  ) =>
    truncations.some(
      (item) =>
        item.scope === scope &&
        item.limit === limit &&
        item.recordId === recordId,
    );
  const hasSnapshotRecordCap = hasTruncation('snapshot', 'record-count');
  const truncationKeys = new Set<string>();
  const targetIds = new Set(targets.map((target) => target.id));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const relationshipIds = new Set(relationships.map((item) => item.id));

  for (const truncation of truncations) {
    const key = `${truncation.scope}:${truncation.limit}:${truncation.recordId ?? ''}`;
    if (truncationKeys.has(key)) return false;
    truncationKeys.add(key);
    if (truncation.scope === 'snapshot') {
      if (
        !['record-count', 'text-length', 'attribute-value-length'].includes(
          truncation.limit,
        ) ||
        truncation.recordId !== undefined ||
        (truncation.limit === 'record-count' &&
          truncation.omittedCount !== undefined)
      ) {
        return false;
      }
      if (
        (truncation.limit === 'record-count' &&
          targets.length + evidence.length !== MAX_RECORDS) ||
        (truncation.limit === 'text-length' &&
          !(document.title.status === 'present' && document.title.truncated)) ||
        (truncation.limit === 'attribute-value-length' &&
          !(document.language.status === 'present' &&
            document.language.truncated))
      ) {
        return false;
      }
    } else if (truncation.scope === 'target') {
      const target = targets.find((item) => item.id === truncation.recordId);
      const recordLimit =
        truncation.limit === 'text-length'
          ? 'text-limit'
          : truncation.limit === 'attribute-value-length'
            ? 'attribute-value-limit'
            : truncation.limit === 'aria-attribute-count'
              ? 'aria-attribute-limit'
              : undefined;
      if (
        !truncation.recordId ||
        !target ||
        !targetIds.has(truncation.recordId) ||
        target.completeness.status !== 'partial' ||
        !recordLimit ||
        !target.completeness.truncations.includes(recordLimit) ||
        ![
          'text-length',
          'attribute-value-length',
          'aria-attribute-count',
        ].includes(truncation.limit) ||
        truncation.omittedCount !== undefined
      ) {
        return false;
      }
    } else if (truncation.scope === 'evidence') {
      const record = evidence.find((item) => item.id === truncation.recordId);
      const recordLimit =
        truncation.limit === 'text-length'
          ? 'text-limit'
          : truncation.limit === 'attribute-value-length'
            ? 'attribute-value-limit'
            : truncation.limit === 'aria-attribute-count'
              ? 'aria-attribute-limit'
              : undefined;
      if (
        !truncation.recordId ||
        !record ||
        !evidenceIds.has(truncation.recordId) ||
        record.completeness.status !== 'partial' ||
        !recordLimit ||
        !record.completeness.truncations.includes(recordLimit) ||
        ![
          'text-length',
          'attribute-value-length',
          'aria-attribute-count',
        ].includes(truncation.limit) ||
        truncation.omittedCount !== undefined
      ) {
        return false;
      }
    } else if (truncation.limit === 'duplicate-id-candidates') {
      if (
        !truncation.recordId ||
        !relationshipIds.has(truncation.recordId) ||
        !Number.isInteger(truncation.omittedCount) ||
        (truncation.omittedCount ?? 0) <= 0
      ) {
        return false;
      }
    } else {
      const idrefMatch = /^([a-zA-Z0-9_-]+):(aria-labelledby|aria-describedby)$/.exec(
        truncation.recordId ?? '',
      );
      if (
        !idrefMatch ||
        !targetIds.has(idrefMatch[1] ?? '') ||
        !['idref-character-count', 'idref-token-count'].includes(
          truncation.limit,
        ) ||
        truncation.omittedCount !== undefined
      ) {
        return false;
      }
    }
  }

  for (const target of targets) {
    if (target.completeness.status === 'complete') continue;
    for (const recordTruncation of target.completeness.truncations) {
      const limit =
        recordTruncation === 'text-limit'
          ? 'text-length'
          : recordTruncation === 'attribute-value-limit'
            ? 'attribute-value-length'
            : 'aria-attribute-count';
      if (!hasTruncation('target', limit, target.id)) return false;
    }
  }

  for (const item of evidence) {
    if (item.completeness.status === 'complete') continue;
    for (const recordTruncation of item.completeness.truncations) {
      const limit =
        recordTruncation === 'text-limit'
          ? 'text-length'
          : recordTruncation === 'attribute-value-limit'
            ? 'attribute-value-length'
            : 'aria-attribute-count';
      if (!hasTruncation('evidence', limit, item.id)) return false;
    }
  }

  for (const relationship of relationships) {
    if (relationship.kind === 'parent-child') continue;
    const hasOmittedCandidates =
      (relationship.destination.status === 'ambiguous' &&
        relationship.destination.additionalCandidateCount > 0) ||
      (relationship.sourceResolution?.additionalCandidateCount ?? 0) > 0;
    const hasCandidateCapMetadata = hasTruncation(
      'relationship',
      'duplicate-id-candidates',
      relationship.id,
    );
    const hasCandidateOverflow =
      (relationship.destination.status === 'ambiguous' &&
        relationship.destination.totalCandidateCount >
          MAX_ID_REFERENCE_TARGETS_PER_ID) ||
      (relationship.sourceResolution?.totalCandidateCount ?? 0) >
        MAX_ID_REFERENCE_TARGETS_PER_ID;
    if (hasCandidateOverflow !== hasCandidateCapMetadata) return false;
    if (hasCandidateCapMetadata) {
      const expectedOmittedCount =
        relationship.destination.status === 'ambiguous'
          ? relationship.destination.totalCandidateCount -
            MAX_ID_REFERENCE_TARGETS_PER_ID
          : (relationship.sourceResolution?.totalCandidateCount ?? 0) -
            MAX_ID_REFERENCE_TARGETS_PER_ID;
      const truncation = truncations.find(
        (item) =>
          item.scope === 'relationship' &&
          item.limit === 'duplicate-id-candidates' &&
          item.recordId === relationship.id,
      );
      if (truncation?.omittedCount !== expectedOmittedCount) return false;
    }
    if (hasOmittedCandidates && relationship.completeness.status !== 'partial') {
      return false;
    }
    if (relationship.completeness.status === 'partial') {
      const hasRelationshipCandidateLimit = hasTruncation(
        'relationship',
        'duplicate-id-candidates',
        relationship.id,
      );
      if (!hasRelationshipCandidateLimit && !hasSnapshotRecordCap) {
        return false;
      }
    }
  }

  if (
    (document.title.status === 'present' &&
      document.title.truncated &&
      !hasTruncation('snapshot', 'text-length')) ||
    (document.language.status === 'present' &&
      document.language.truncated &&
      !hasTruncation('snapshot', 'attribute-value-length'))
  ) {
    return false;
  }

  const isComplete = completeness.status === 'complete';
  return (
    !isComplete ||
    (!targets.some((target) => target.completeness.status === 'partial') &&
      !evidence.some((item) => item.completeness.status === 'partial') &&
      !relationships.some(
        (relationship) => relationship.completeness.status === 'partial',
      ) &&
      !(
        (document.title.status === 'present' && document.title.truncated) ||
        (document.language.status === 'present' &&
          document.language.truncated)
      ))
  );
}

function resolvedEvidenceIds(
  relationship: TargetEvidenceRelationship,
): string[] {
  const destination = relationship.destination;
  if (destination.status === 'resolved' &&
      destination.record.recordType === 'evidence') {
    return [destination.record.id];
  }
  if (destination.status === 'ambiguous') {
    return destination.candidates
      .filter((candidate) => candidate.recordType === 'evidence')
      .map((candidate) => candidate.id);
  }
  return [];
}

function projection(
  relationship: TargetEvidenceRelationship,
  focalTargetId: string,
): TargetRelationshipProjection {
  if (relationship.source.id !== focalTargetId) {
    throw new Error('Relationship source does not match focal target.');
  }
  return {
    relationshipId: relationship.id,
    focalTargetId,
    kind: relationship.kind,
    destination: relationship.destination,
    direction: relationship.direction,
    provenance: relationship.provenance,
    completeness: relationship.completeness,
  };
}

function makeUnit(
  target: EvaluationTarget,
  relationships: TargetEvidenceRelationship[],
  evidenceById: Map<string, SupportingEvidence>,
): TargetContextInputUnit | undefined {
  const representableRelationships = relationships.filter((item) => {
    if (item.sourceResolution !== undefined) return false;
    if (item.destination.status === 'resolved') {
      return (
        item.destination.record.recordType !== 'target' ||
        item.destination.record.id === target.id
      );
    }
    if (item.destination.status === 'ambiguous') {
      return item.destination.candidates.every((candidate) =>
        candidate.recordType === 'target'
          ? candidate.id === target.id
          : evidenceById.has(candidate.id),
      );
    }
    return true;
  });
  const omittedRelationshipCount =
    relationships.length - representableRelationships.length;
  const relationshipProjections = representableRelationships.map((item) =>
    projection(item, target.id),
  );
  const idsInOrder: string[] = [];
  for (const relationship of relationships) {
    for (const id of resolvedEvidenceIds(relationship)) {
      if (!idsInOrder.includes(id)) idsInOrder.push(id);
    }
  }

  const omittedIds: string[] = [];
  const selectedIds = idsInOrder.slice(0, MAX_V2_ASSOCIATED_EVIDENCE_RECORDS);
  omittedIds.push(...idsInOrder.slice(MAX_V2_ASSOCIATED_EVIDENCE_RECORDS));

  const includedRelationships = relationshipProjections.filter((item) => {
    const destination = item.destination;
    if (destination.status === 'resolved') {
      return destination.record.recordType !== 'evidence' ||
        selectedIds.includes(destination.record.id);
    }
    if (destination.status === 'ambiguous') {
      return destination.candidates
        .filter((candidate) => candidate.recordType === 'evidence')
        .every((candidate) => selectedIds.includes(candidate.id));
    }
    return true;
  });
  let associatedEvidence = selectedIds
    .map((id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) return undefined;
      const links = includedRelationships.filter((item) => {
        const destination = item.destination;
        return (
          (destination.status === 'resolved' &&
            destination.record.recordType === 'evidence' &&
            destination.record.id === id) ||
          (destination.status === 'ambiguous' &&
            destination.candidates.some(
              (candidate) =>
                candidate.recordType === 'evidence' &&
                candidate.id === id,
            ))
        );
      });
      return links.length ? { evidence, relationships: links } : undefined;
    })
    .filter(
      (item): item is NonNullable<typeof item> => item !== undefined,
    );
  omittedIds.length = idsInOrder.length - associatedEvidence.length;

  const truncations: Array<
    | 'associated-evidence-count'
    | 'evidence-character-budget'
    | 'serialized-size-budget'
    | 'relationship-omitted'
  > = [];
  if (omittedIds.length) truncations.push('associated-evidence-count');
  if (omittedRelationshipCount) truncations.push('relationship-omitted');

  let remainingCharacters = MAX_V2_GROUP_EVIDENCE_CHARACTERS;
  associatedEvidence = associatedEvidence.map((item) => {
    const text = item.evidence.text;
    if (!text) return item;
    const value = text.value.slice(0, remainingCharacters);
    remainingCharacters -= value.length;
    if (value.length < text.value.length) {
      truncations.push('evidence-character-budget');
      return {
        ...item,
        evidence: {
          ...item.evidence,
          text: { value, truncated: true },
          completeness: {
            status: 'partial' as const,
            truncations: ['text-limit' as const],
          },
        },
      };
    }
    return item;
  });

  const unit: TargetContextInputUnit = {
    focal: target,
    associatedEvidence,
    relationships: includedRelationships,
    completeness: truncations.length
      ? {
          status: 'partial',
          truncations: [...new Set(truncations)] as [
            | 'associated-evidence-count'
            | 'evidence-character-budget'
            | 'serialized-size-budget'
            | 'relationship-omitted',
            ...(
              | 'associated-evidence-count'
              | 'evidence-character-budget'
              | 'serialized-size-budget'
              | 'relationship-omitted'
            )[],
          ],
          omittedEvidenceCount: omittedIds.length,
        }
      : { status: 'complete', truncations: [] },
  };

  while (JSON.stringify(unit).length > MAX_V2_GROUP_SERIALIZED_CHARACTERS) {
    if (unit.relationships.length) {
      const removed = unit.relationships.pop();
      if (removed) {
        const previousEvidenceCount = unit.associatedEvidence.length;
        unit.associatedEvidence = unit.associatedEvidence
          .map((item) => ({
            ...item,
            relationships: item.relationships.filter(
              (relationship) =>
                relationship.relationshipId !== removed.relationshipId,
            ),
          }))
          .filter((item) => item.relationships.length > 0);
        const removedEvidenceCount =
          previousEvidenceCount - unit.associatedEvidence.length;
        if (unit.completeness.status === 'complete') {
          unit.completeness = {
            status: 'partial',
            truncations: ['serialized-size-budget'],
            omittedEvidenceCount: removedEvidenceCount,
          };
        } else {
          unit.completeness.omittedEvidenceCount += removedEvidenceCount;
          if (
            !unit.completeness.truncations.includes('serialized-size-budget')
          ) {
            unit.completeness.truncations.push('serialized-size-budget');
          }
        }
      }
      continue;
    }

    const last = unit.associatedEvidence.pop();
    if (!last) return undefined;
    omittedIds.push(last.evidence.id);
    if (unit.completeness.status === 'complete') {
      unit.completeness = {
        status: 'partial',
        truncations: ['serialized-size-budget'],
        omittedEvidenceCount: 1,
      };
    } else {
      unit.completeness.omittedEvidenceCount += 1;
      if (!unit.completeness.truncations.includes('serialized-size-budget')) {
        unit.completeness.truncations.push('serialized-size-budget');
      }
    }
  }
  return unit;
}

function isValidAdaptedUnit(
  unit: TargetContextInputUnit,
  targetsById: Map<string, EvaluationTarget>,
  evidenceById: Map<string, SupportingEvidence>,
  sourceRelationships: Map<string, TargetEvidenceRelationship>,
): boolean {
  const focal = targetsById.get(unit.focal.id);
  if (
    !focal ||
    unit.focal.id !== focal.id ||
    unit.associatedEvidence.length > MAX_V2_ASSOCIATED_EVIDENCE_RECORDS
  ) {
    return false;
  }
  const associatedIds = new Set<string>();
  for (const associated of unit.associatedEvidence) {
    if (
      !evidenceById.has(associated.evidence.id) ||
      associatedIds.has(associated.evidence.id)
    ) {
      return false;
    }
    associatedIds.add(associated.evidence.id);
  }
  const projectionsById = new Map<string, TargetRelationshipProjection>();
  for (const relationship of unit.relationships) {
    const source = sourceRelationships.get(relationship.relationshipId);
    if (
      !source ||
      source.source.id !== unit.focal.id ||
      relationship.focalTargetId !== unit.focal.id ||
      relationship.kind !== source.kind ||
      relationship.direction !== source.direction ||
      JSON.stringify(relationship.destination) !==
        JSON.stringify(source.destination) ||
      JSON.stringify(relationship.provenance) !==
        JSON.stringify(source.provenance) ||
      JSON.stringify(relationship.completeness) !==
        JSON.stringify(source.completeness) ||
      projectionsById.has(relationship.relationshipId)
    ) {
      return false;
    }
    const destination = relationship.destination;
    if (destination.status === 'resolved') {
      if (!isValidRef(destination.record, targetsById, evidenceById)) {
        return false;
      }
      if (
        destination.record.recordType === 'target' &&
        destination.record.id !== unit.focal.id
      ) {
        return false;
      }
      if (
        destination.record.recordType === 'evidence' &&
        !associatedIds.has(destination.record.id)
      ) {
        return false;
      }
    } else if (destination.status === 'ambiguous') {
      if (
        !destination.candidates.every(
          (candidate) =>
            isValidRef(candidate, targetsById, evidenceById) &&
            (candidate.recordType !== 'target' ||
              candidate.id === unit.focal.id) &&
            (candidate.recordType !== 'evidence' ||
              associatedIds.has(candidate.id)),
        )
      ) {
        return false;
      }
    }
    projectionsById.set(relationship.relationshipId, relationship);
  }
  return unit.associatedEvidence.every((associated) =>
    associated.relationships.every((relationship) => {
      const projection = projectionsById.get(relationship.relationshipId);
      if (!projection || relationship.focalTargetId !== unit.focal.id) {
        return false;
      }
      const destination = projection.destination;
      return (
        (destination.status === 'resolved' &&
          destination.record.recordType === 'evidence' &&
          destination.record.id === associated.evidence.id) ||
        (destination.status === 'ambiguous' &&
          destination.candidates.some(
            (candidate) =>
              candidate.recordType === 'evidence' &&
              candidate.id === associated.evidence.id,
          ))
      );
    }),
  );
}

function adaptContextSnapshotV2Unsafe(
  extraction:
    | { status: 'available'; snapshot: ContextSnapshot }
    | { status: 'unavailable'; reason: ContextUnavailableReason }
    | ContextSnapshot
    | null
    | undefined,
): ContextAdapterResult {
  if (extraction === null || extraction === undefined) {
    return { status: 'unavailable', reason: 'not-requested' };
  }
  if ('status' in extraction && extraction.status === 'unavailable') {
    return { status: 'unavailable', reason: extraction.reason };
  }
  const snapshot =
    'status' in extraction ? extraction.snapshot : extraction;
  if (!isValidSnapshot(snapshot)) {
    return { status: 'error', errorCode: 'invalid-snapshot' };
  }
  if (snapshot.targets.length === 0) {
    if (isPartialSnapshot(snapshot)) {
      return {
        status: 'partial',
        input: {
          document: snapshot.document,
          units: [],
          extractionCompleteness: snapshot.completeness,
          adapterCompleteness: { status: 'complete', truncations: [] },
        },
      };
    }
    if (!isCompleteSnapshot(snapshot)) {
      return { status: 'error', errorCode: 'invalid-snapshot' };
    }
    return {
      status: 'empty',
      input: {
        document: snapshot.document,
        units: [],
        extractionCompleteness: snapshot.completeness,
        adapterCompleteness: { status: 'complete', truncations: [] },
      },
    };
  }

  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const targetsById = new Map(snapshot.targets.map((item) => [item.id, item]));
  const relationshipsByTarget = new Map<string, TargetEvidenceRelationship[]>();
  const sourceRelationships = new Map<string, TargetEvidenceRelationship>();
  for (const relationship of snapshot.relationships) {
    if (relationship.kind === 'parent-child') {
      // Structural relationships are retained in the snapshot but excluded from the initial target-evidence input contract.
      continue;
    }
    const values = relationshipsByTarget.get(relationship.source.id) ?? [];
    values.push(relationship);
    relationshipsByTarget.set(relationship.source.id, values);
    sourceRelationships.set(relationship.id, relationship);
  }

  const units: TargetContextInputUnit[] = [];
  for (const target of snapshot.targets) {
    const unit = makeUnit(
      target,
      relationshipsByTarget.get(target.id) ?? [],
      evidenceById,
    );
    if (!unit) return { status: 'error', errorCode: 'group-size-limit' };
    if (unit.focal.id !== target.id) {
      return { status: 'error', errorCode: 'invalid-snapshot' };
    }
    if (!isValidAdaptedUnit(unit, targetsById, evidenceById, sourceRelationships)) {
      return { status: 'error', errorCode: 'invalid-snapshot' };
    }
    units.push(unit);
  }

  const partialUnits = units.filter(
    (unit) => unit.completeness.status === 'partial',
  );
  const anyAdapterPartial = partialUnits.length > 0;
  const adapterTruncations = partialUnits.flatMap((unit) =>
      unit.completeness.status === 'partial'
        ? unit.completeness.truncations
        : [],
    );
  const omittedUnitEvidenceCount = partialUnits.reduce(
      (sum, unit) =>
        sum +
        (unit.completeness.status === 'partial'
          ? unit.completeness.omittedEvidenceCount
          : 0),
      0,
    );
  const partialAdapterCompleteness = anyAdapterPartial
    ? {
        status: 'partial' as const,
        truncations: [...new Set(adapterTruncations)] as [
          AdapterUnitTruncation,
          ...AdapterUnitTruncation[],
        ],
        omittedUnitEvidenceCount,
      }
    : { status: 'complete' as const, truncations: [] as [] };

  if (isPartialSnapshot(snapshot)) {
    return {
      status: 'partial',
      input: {
        document: snapshot.document,
        units,
        extractionCompleteness: snapshot.completeness,
        adapterCompleteness: partialAdapterCompleteness,
      },
    };
  }

  if (!isCompleteSnapshot(snapshot)) {
    return { status: 'error', errorCode: 'invalid-snapshot' };
  }
  if (anyAdapterPartial) {
    const adapterCompleteness = {
      status: 'partial' as const,
      truncations: [...new Set(adapterTruncations)] as [
        AdapterUnitTruncation,
        ...AdapterUnitTruncation[],
      ],
      omittedUnitEvidenceCount,
    };
    return {
      status: 'partial',
      input: {
        document: snapshot.document,
        units,
        extractionCompleteness: snapshot.completeness,
        adapterCompleteness,
      },
    };
  }

  return {
    status: 'ready',
    input: {
      document: snapshot.document,
      units: units as [TargetContextInputUnit, ...TargetContextInputUnit[]],
      extractionCompleteness: snapshot.completeness,
      adapterCompleteness: { status: 'complete', truncations: [] },
    },
  };
}

export function adaptContextSnapshotV2(
  extraction:
    | { status: 'available'; snapshot: ContextSnapshot }
    | { status: 'unavailable'; reason: ContextUnavailableReason }
    | ContextSnapshot
    | null
    | undefined,
): ContextAdapterResult {
  try {
    return adaptContextSnapshotV2Unsafe(extraction);
  } catch {
    return { status: 'error', errorCode: 'invalid-snapshot' };
  }
}
