import type {
  ContextSnapshot,
  ElementContext,
} from '../types/context.js';
import type {
  ContextAdapterResult,
  ContextElementEvidence,
  ContextEvidenceRecord,
  ContextGroupCompleteness,
  ContextInputUnit,
  ContextRelationshipDirection,
  ContextRelationshipProvenance,
  ContextRelationshipType,
} from '../types/contextAdapter.js';

/** Limit related records so each focal unit remains locally interpretable. */
export const MAX_ASSOCIATED_CONTEXT_RECORDS = 8;
/** Maximum JSON.stringify(unit).length, measured in UTF-16 code units. */
export const MAX_GROUP_SERIALIZED_CHARACTERS = 8_000;
/** Shared budget for copied text, attribute values, and DOM-path evidence. */
export const MAX_GROUP_EVIDENCE_CHARACTERS = 2_400;
const MAX_REPORTED_OMITTED_CONTEXT_IDS = 32;
const MAX_CONTEXT_ID_LENGTH = 64;

interface Association {
  contextId: string;
  provenance: ContextRelationshipProvenance[];
}

interface EvidenceBudget {
  remaining: number;
  truncated: boolean;
  relationshipTruncated: boolean;
}

const RELATIONSHIP_ORDER: ContextRelationshipType[] = [
  'native-label',
  'aria-labelledby',
  'aria-describedby',
  'parent',
  'child',
];
const DIRECTION_ORDER: ContextRelationshipDirection[] = [
  'outgoing',
  'incoming',
];
const NAME_EVIDENCE_SOURCES = new Set([
  'aria-label',
  'aria-labelledby',
  'explicit-label',
  'wrapping-label',
  'alt',
  'title',
  'text-content',
  'value-attribute',
]);
const CONTEXT_KINDS = new Set([
  'image',
  'link',
  'button',
  'form-control',
  'heading',
  'other',
]);
const HREF_KINDS = new Set([
  'fragment',
  'same-document',
  'external',
  'missing',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  );
}

function isValidElement(value: unknown): value is ElementContext {
  if (
    !isRecord(value) ||
    !isRecord(value.attributes) ||
    !isRecord(value.relationships)
  ) {
    return false;
  }
  const { attributes, relationships } = value;
  if (
    typeof value.contextId !== 'string' ||
    value.contextId.length === 0 ||
    value.contextId.length > MAX_CONTEXT_ID_LENGTH ||
    typeof value.tagName !== 'string' ||
    value.tagName.length > 32 ||
    typeof value.kind !== 'string' ||
    !CONTEXT_KINDS.has(value.kind) ||
    !isRecord(attributes.aria) ||
    Object.keys(attributes.aria).length > 20 ||
    Object.keys(attributes.aria).some((name) => name.length > 100) ||
    !Object.values(attributes.aria).every((item) => typeof item === 'string') ||
    !isStringArray(relationships.childContextIds) ||
    !isStringArray(relationships.labelContextIds) ||
    !isStringArray(relationships.labelledByContextIds) ||
    !isStringArray(relationships.describedByContextIds) ||
    relationships.childContextIds.length > 500 ||
    relationships.labelContextIds.length > 500 ||
    relationships.labelledByContextIds.length > 500 ||
    relationships.describedByContextIds.length > 500 ||
    (relationships.parentContextId !== undefined &&
      typeof relationships.parentContextId !== 'string') ||
    (value.domPath !== undefined && typeof value.domPath !== 'string') ||
    (value.headingLevel !== undefined &&
      (typeof value.headingLevel !== 'number' ||
        ![1, 2, 3, 4, 5, 6].includes(value.headingLevel))) ||
    ![
      'labelledByReferencesTruncated',
      'describedByReferencesTruncated',
      'labelledByTargetsTruncated',
      'describedByTargetsTruncated',
      'labelledByTargetsOmitted',
      'describedByTargetsOmitted',
      'labelTargetsOmitted',
    ].every(
      (key) =>
        relationships[key] === undefined ||
        typeof relationships[key] === 'boolean',
    ) ||
    (attributes.required !== undefined &&
      typeof attributes.required !== 'boolean') ||
    (attributes.disabled !== undefined &&
      typeof attributes.disabled !== 'boolean') ||
    (attributes.hrefKind !== undefined &&
      (typeof attributes.hrefKind !== 'string' ||
        !HREF_KINDS.has(attributes.hrefKind)))
  ) {
    return false;
  }
  if (
    [
      ...relationships.childContextIds,
      ...relationships.labelContextIds,
      ...relationships.labelledByContextIds,
      ...relationships.describedByContextIds,
      ...(relationships.parentContextId
        ? [relationships.parentContextId]
        : []),
    ].some((id) => id.length > MAX_CONTEXT_ID_LENGTH)
  ) {
    return false;
  }
  if (
    value.text !== undefined &&
    (!isRecord(value.text) ||
      typeof value.text.truncated !== 'boolean' ||
      (value.text.ownText !== undefined &&
        typeof value.text.ownText !== 'string') ||
      (value.text.nearbyText !== undefined &&
        typeof value.text.nearbyText !== 'string'))
  ) {
    return false;
  }
  if (
    !Array.isArray(value.nameEvidence) ||
    value.nameEvidence.length > 8 ||
    !value.nameEvidence.every(
      (evidence) =>
        isRecord(evidence) &&
        typeof evidence.source === 'string' &&
        NAME_EVIDENCE_SOURCES.has(evidence.source) &&
        (evidence.targetContextIds === undefined ||
          (isStringArray(evidence.targetContextIds) &&
            evidence.targetContextIds.length <= 500 &&
            evidence.targetContextIds.every(
              (id) => id.length <= MAX_CONTEXT_ID_LENGTH,
            ))),
    )
  ) {
    return false;
  }
  for (const key of [
    'authoredId',
    'role',
    'alt',
    'title',
    'inputType',
    'name',
    'placeholder',
  ]) {
    if (
      attributes[key] !== undefined &&
      typeof attributes[key] !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

function isValidSnapshot(value: unknown): value is ContextSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.elementsTruncated !== 'boolean' ||
    !Array.isArray(value.elements) ||
    value.elements.length > 500 ||
    !value.elements.every(isValidElement)
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const element of value.elements) {
    if (ids.has(element.contextId)) {
      return false;
    }
    ids.add(element.contextId);
  }
  return true;
}

function addAssociation(
  associations: Map<string, Map<string, ContextRelationshipProvenance[]>>,
  sourceContextId: string,
  targetContextId: string,
  relationship: ContextRelationshipType,
): void {
  const sourceAssociations =
    associations.get(sourceContextId) ?? new Map<string, ContextRelationshipProvenance[]>();
  associations.set(sourceContextId, sourceAssociations);
  const sourceProvenance = sourceAssociations.get(targetContextId) ?? [];
  sourceAssociations.set(targetContextId, sourceProvenance);
  const outgoing: ContextRelationshipProvenance = {
    relationship,
    direction: 'outgoing',
    sourceContextId,
    targetContextId,
  };
  if (
    !sourceProvenance.some(
      (item) =>
        item.relationship === relationship &&
        item.direction === outgoing.direction &&
        item.sourceContextId === sourceContextId &&
        item.targetContextId === targetContextId,
    )
  ) {
    sourceProvenance.push(outgoing);
  }

  const targetAssociations =
    associations.get(targetContextId) ?? new Map<string, ContextRelationshipProvenance[]>();
  associations.set(targetContextId, targetAssociations);
  const targetProvenance = targetAssociations.get(sourceContextId) ?? [];
  targetAssociations.set(sourceContextId, targetProvenance);
  const incoming: ContextRelationshipProvenance = {
    relationship,
    direction: 'incoming',
    sourceContextId,
    targetContextId,
  };
  if (
    !targetProvenance.some(
      (item) =>
        item.relationship === relationship &&
        item.direction === incoming.direction &&
        item.sourceContextId === sourceContextId &&
        item.targetContextId === targetContextId,
    )
  ) {
    targetProvenance.push(incoming);
  }
}

function sortProvenance(
  provenance: ContextRelationshipProvenance[],
): ContextRelationshipProvenance[] {
  return [...provenance].sort(
    (left, right) =>
      RELATIONSHIP_ORDER.indexOf(left.relationship) -
        RELATIONSHIP_ORDER.indexOf(right.relationship) ||
      DIRECTION_ORDER.indexOf(left.direction) -
        DIRECTION_ORDER.indexOf(right.direction) ||
      left.sourceContextId.localeCompare(right.sourceContextId) ||
      left.targetContextId.localeCompare(right.targetContextId),
  );
}

function copyEvidenceString(
  value: string | undefined,
  budget: EvidenceBudget,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const copied = value.slice(0, budget.remaining);
  budget.remaining -= copied.length;
  if (copied.length < value.length) {
    budget.truncated = true;
  }
  return copied;
}

function copyElementEvidence(
  element: ElementContext,
  budget: EvidenceBudget,
): ContextElementEvidence {
  const attributes: ContextElementEvidence['attributes'] = {
    aria: {},
  };
  for (const key of [
    'authoredId',
    'role',
    'alt',
    'title',
    'inputType',
    'name',
    'placeholder',
  ] as const) {
    const value = copyEvidenceString(element.attributes[key], budget);
    if (value !== undefined) {
      attributes[key] = value;
    }
  }
  for (const key of Object.keys(element.attributes.aria).sort()) {
    const value = copyEvidenceString(element.attributes.aria[key], budget);
    if (value !== undefined) {
      attributes.aria[key] = value;
    }
  }
  if (element.attributes.required !== undefined) {
    attributes.required = element.attributes.required;
  }
  if (element.attributes.disabled !== undefined) {
    attributes.disabled = element.attributes.disabled;
  }
  if (element.attributes.hrefKind !== undefined) {
    attributes.hrefKind = element.attributes.hrefKind;
  }

  const evidence: ContextElementEvidence = {
    contextId: element.contextId,
    tagName: element.tagName,
    kind: element.kind,
    attributes,
    nameEvidence: element.nameEvidence.map((item) => {
      if (
        item.targetContextIds &&
        item.targetContextIds.length > MAX_ASSOCIATED_CONTEXT_RECORDS
      ) {
        budget.relationshipTruncated = true;
      }
      return {
        source: item.source,
        ...(item.targetContextIds
          ? {
              targetContextIds: item.targetContextIds.slice(
                0,
                MAX_ASSOCIATED_CONTEXT_RECORDS,
              ),
            }
          : {}),
      };
    }),
  };
  if (element.headingLevel !== undefined) {
    evidence.headingLevel = element.headingLevel;
  }
  if (element.domPath !== undefined) {
    const domPath = copyEvidenceString(element.domPath, budget);
    if (domPath !== undefined) {
      evidence.domPath = domPath;
    }
  }
  if (element.text !== undefined) {
    const ownText = copyEvidenceString(element.text.ownText, budget);
    const nearbyText = copyEvidenceString(element.text.nearbyText, budget);
    evidence.text = {
      truncated:
        element.text.truncated ||
        (ownText !== undefined &&
          ownText.length !== element.text.ownText?.length) ||
        (nearbyText !== undefined &&
          nearbyText.length !== element.text.nearbyText?.length),
      ...(ownText !== undefined ? { ownText } : {}),
      ...(nearbyText !== undefined ? { nearbyText } : {}),
    };
  }
  return evidence;
}

function sourceCompleteness(
  element: ElementContext,
): Pick<
  ContextGroupCompleteness,
  | 'sourceTextTruncated'
  | 'labelledByReferencesTruncated'
  | 'describedByReferencesTruncated'
  | 'labelledByTargetsTruncated'
  | 'describedByTargetsTruncated'
  | 'labelledByTargetsOmitted'
  | 'describedByTargetsOmitted'
  | 'nativeLabelTargetsOmitted'
> {
  return {
    sourceTextTruncated: element.text?.truncated ?? false,
    labelledByReferencesTruncated:
      element.relationships.labelledByReferencesTruncated ?? false,
    describedByReferencesTruncated:
      element.relationships.describedByReferencesTruncated ?? false,
    labelledByTargetsTruncated:
      element.relationships.labelledByTargetsTruncated ?? false,
    describedByTargetsTruncated:
      element.relationships.describedByTargetsTruncated ?? false,
    labelledByTargetsOmitted:
      element.relationships.labelledByTargetsOmitted ?? false,
    describedByTargetsOmitted:
      element.relationships.describedByTargetsOmitted ?? false,
    nativeLabelTargetsOmitted:
      element.relationships.labelTargetsOmitted ?? false,
  };
}

function mergeCompleteness(
  elements: ElementContext[],
  snapshotElementsTruncated: boolean,
  unresolvedRelationshipReferences: boolean,
): Omit<
  ContextGroupCompleteness,
  | 'status'
  | 'associatedRecordsTruncated'
  | 'associatedRecordsOmitted'
  | 'omittedAssociatedContextIds'
  | 'omittedAssociatedContextIdsTruncated'
  | 'evidenceTruncated'
  | 'serializedSizeTruncated'
  | 'relationshipEvidenceTruncated'
> {
  const flags = elements.map(sourceCompleteness);
  return {
    snapshotElementsTruncated,
    sourceTextTruncated: flags.some((item) => item.sourceTextTruncated),
    labelledByReferencesTruncated: flags.some(
      (item) => item.labelledByReferencesTruncated,
    ),
    describedByReferencesTruncated: flags.some(
      (item) => item.describedByReferencesTruncated,
    ),
    labelledByTargetsTruncated: flags.some(
      (item) => item.labelledByTargetsTruncated,
    ),
    describedByTargetsTruncated: flags.some(
      (item) => item.describedByTargetsTruncated,
    ),
    labelledByTargetsOmitted: flags.some(
      (item) => item.labelledByTargetsOmitted,
    ),
    describedByTargetsOmitted: flags.some(
      (item) => item.describedByTargetsOmitted,
    ),
    nativeLabelTargetsOmitted: flags.some(
      (item) => item.nativeLabelTargetsOmitted,
    ),
    unresolvedRelationshipReferences,
  };
}

function buildUnit(
  focal: ElementContext,
  candidateAssociations: Association[],
  focalProvenance: ContextRelationshipProvenance[],
  elementsById: Map<string, ElementContext>,
  snapshotElementsTruncated: boolean,
  unresolvedSources: Set<string>,
): ContextInputUnit | undefined {
  const selectedCount = Math.min(
    candidateAssociations.length,
    MAX_ASSOCIATED_CONTEXT_RECORDS,
  );
  const sourceElements = [
    focal,
    ...candidateAssociations.map((item) => elementsById.get(item.contextId)!),
  ];
  const baseCompleteness = mergeCompleteness(
    sourceElements,
    snapshotElementsTruncated,
    sourceElements.some((item) => unresolvedSources.has(item.contextId)),
  );
  const omittedAssociations = candidateAssociations.slice(selectedCount);
  const omittedIds = omittedAssociations.map((item) => item.contextId);
  function candidate(
    associatedCount: number,
    evidenceLimit: number,
    serializedSizeTruncated: boolean,
  ): ContextInputUnit {
    const budget: EvidenceBudget = {
      remaining: evidenceLimit,
      truncated: false,
      relationshipTruncated: false,
    };
    const focalRecord: ContextEvidenceRecord = {
      contextId: focal.contextId,
      evidence: copyElementEvidence(focal, budget),
      relationshipProvenance: sortProvenance(focalProvenance),
    };
    const associated = candidateAssociations
      .filter((item) => item.contextId !== focal.contextId)
      .slice(0, associatedCount)
      .map((item) => {
        const element = elementsById.get(item.contextId);
        if (!element) {
          return undefined;
        }
        return {
          contextId: item.contextId,
          evidence: copyElementEvidence(element, budget),
          relationshipProvenance: sortProvenance(item.provenance),
        };
      }      )
      .filter(
        (item): item is ContextEvidenceRecord => item !== undefined,
      );
    const omitted = [
      ...omittedIds,
      ...candidateAssociations
        .slice(associatedCount, selectedCount)
        .map((item) => item.contextId),
    ];
    const completeness: ContextGroupCompleteness = {
      ...baseCompleteness,
      status:
        snapshotElementsTruncated ||
        Object.entries(baseCompleteness).some(
          ([key, value]) => key !== 'snapshotElementsTruncated' && value,
        ) ||
        omitted.length > 0 ||
        budget.truncated ||
        serializedSizeTruncated
          ? 'partial'
          : 'complete',
      associatedRecordsTruncated: omitted.length > 0,
      associatedRecordsOmitted: omitted.length,
      omittedAssociatedContextIds: omitted.slice(
        0,
        MAX_REPORTED_OMITTED_CONTEXT_IDS,
      ),
      omittedAssociatedContextIdsTruncated:
        omitted.length > MAX_REPORTED_OMITTED_CONTEXT_IDS,
      evidenceTruncated: budget.truncated,
      serializedSizeTruncated,
      relationshipEvidenceTruncated: budget.relationshipTruncated,
    };
    if (budget.relationshipTruncated) {
      completeness.status = 'partial';
    }
    return { focal: focalRecord, associated, completeness };
  }

  for (
    let associatedCount = selectedCount;
    associatedCount >= 0;
    associatedCount -= 1
  ) {
    const fullEvidence = candidate(
      associatedCount,
      MAX_GROUP_EVIDENCE_CHARACTERS,
      false,
    );
    if (JSON.stringify(fullEvidence).length <= MAX_GROUP_SERIALIZED_CHARACTERS) {
      return fullEvidence;
    }

    let low = 0;
    let high = MAX_GROUP_EVIDENCE_CHARACTERS;
    let best: ContextInputUnit | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const sizedCandidate = candidate(associatedCount, middle, true);
      if (
        JSON.stringify(sizedCandidate).length <=
        MAX_GROUP_SERIALIZED_CHARACTERS
      ) {
        best = sizedCandidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best) {
      return best;
    }
  }
  return undefined;
}

/**
 * Converts an extracted snapshot into deterministic, bounded evidence groups.
 * Pass undefined when extraction was unavailable or failed; do not substitute
 * an empty snapshot, which represents a successful extraction with no records.
 */
export function adaptContextSnapshot(
  snapshot: ContextSnapshot | null | undefined,
): ContextAdapterResult {
  if (snapshot === undefined || snapshot === null) {
    return { status: 'unavailable', units: [] };
  }
  if (!isValidSnapshot(snapshot)) {
    return {
      status: 'error',
      errorCode: 'invalid-snapshot',
      units: [],
    };
  }
  if (snapshot.elements.length === 0 && !snapshot.elementsTruncated) {
    return {
      status: 'empty',
      units: [],
      snapshotElementsTruncated: false,
    };
  }

  const elementsById = new Map(
    snapshot.elements.map((element) => [element.contextId, element]),
  );
  const associations = new Map<
    string,
    Map<string, ContextRelationshipProvenance[]>
  >();
  const unresolvedSources = new Set<string>();

  function connect(
    sourceContextId: string,
    targetContextId: string,
    relationship: ContextRelationshipType,
  ): void {
    if (!elementsById.has(targetContextId)) {
      unresolvedSources.add(sourceContextId);
      return;
    }
    if (sourceContextId === targetContextId) {
      const selfMap =
        associations.get(sourceContextId) ??
        new Map<string, ContextRelationshipProvenance[]>();
      associations.set(sourceContextId, selfMap);
      const provenance = selfMap.get(targetContextId) ?? [];
      selfMap.set(targetContextId, provenance);
      const selfProvenance: ContextRelationshipProvenance = {
        relationship,
        direction: 'outgoing',
        sourceContextId,
        targetContextId,
      };
      if (
        !provenance.some(
          (item) =>
            item.relationship === relationship &&
            item.direction === selfProvenance.direction &&
            item.sourceContextId === sourceContextId &&
            item.targetContextId === targetContextId,
        )
      ) {
        provenance.push(selfProvenance);
      }
      return;
    }
    addAssociation(
      associations,
      sourceContextId,
      targetContextId,
      relationship,
    );
  }

  for (const element of snapshot.elements) {
    const { relationships } = element;
    for (const target of relationships.labelContextIds) {
      connect(element.contextId, target, 'native-label');
    }
    for (const target of relationships.labelledByContextIds) {
      connect(element.contextId, target, 'aria-labelledby');
    }
    for (const target of relationships.describedByContextIds) {
      connect(element.contextId, target, 'aria-describedby');
    }
    if (relationships.parentContextId) {
      connect(element.contextId, relationships.parentContextId, 'parent');
    }
    for (const target of relationships.childContextIds) {
      connect(element.contextId, target, 'child');
    }
    for (const evidence of element.nameEvidence) {
      const relationship =
        evidence.source === 'aria-labelledby'
          ? 'aria-labelledby'
          : evidence.source === 'explicit-label' ||
              evidence.source === 'wrapping-label'
            ? 'native-label'
            : undefined;
      if (relationship && evidence.targetContextIds) {
        for (const target of evidence.targetContextIds) {
          connect(element.contextId, target, relationship);
        }
      }
    }
  }

  const units: ContextInputUnit[] = [];
  const elementIndex = new Map(
    snapshot.elements.map((element, index) => [element.contextId, index]),
  );
  for (const focal of snapshot.elements) {
    const neighbors = associations.get(focal.contextId);
    const candidateAssociations: Association[] = [];
    if (neighbors) {
      for (const [contextId, provenance] of neighbors) {
        if (contextId === focal.contextId) {
          continue;
        }
        candidateAssociations.push({
          contextId,
          provenance: sortProvenance(provenance),
        });
      }
    }
    candidateAssociations.sort(
      (left, right) =>
        (elementIndex.get(left.contextId) ?? Number.MAX_SAFE_INTEGER) -
          (elementIndex.get(right.contextId) ?? Number.MAX_SAFE_INTEGER) ||
        left.contextId.localeCompare(right.contextId),
    );
    const unit = buildUnit(
      focal,
      candidateAssociations,
      neighbors?.get(focal.contextId) ?? [],
      elementsById,
      snapshot.elementsTruncated,
      unresolvedSources,
    );
    if (!unit) {
      return {
        status: 'error',
        errorCode: 'group-size-limit',
        units: [],
      };
    }
    units.push(unit);
  }

  const partial =
    snapshot.elementsTruncated ||
    units.some((unit) => unit.completeness.status === 'partial');
  return {
    status: partial ? 'partial' : 'ready',
    units,
    snapshotElementsTruncated: snapshot.elementsTruncated,
  };
}
