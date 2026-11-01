/**
 * @deprecated Compatibility projection over the V2 single-document extractor.
 * New consumers should use extractHtmlContextV2 or extractHtmlProjectContext.
 */
import type {
  ContextSnapshot,
  ElementContext,
  NameEvidenceSource,
} from '../types/context.js';
import type {
  AttributeObservation as V2AttributeObservation,
  BoundedString,
  ContextRecordRef,
  EvaluationTarget,
  SupportingEvidence,
} from '../types/contextV2.js';
import { extractHtmlContextDocumentV2 } from './contextExtractionV2.js';

type LegacyRecord =
  | { recordType: 'target'; record: EvaluationTarget }
  | { recordType: 'evidence'; record: SupportingEvidence };

function recordKey(record: ContextRecordRef): string {
  return `${record.recordType}:${record.id}`;
}

function boundedValue(
  observation: V2AttributeObservation<BoundedString> | undefined,
): string | undefined {
  if (!observation) return undefined;
  if (observation.status === 'present') return observation.value.value;
  if (observation.status === 'invalid') return observation.raw.value;
  return undefined;
}

function legacyAria(
  values: EvaluationTarget['attributes']['aria']['values'],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, observation] of Object.entries(values)) {
    if (!observation || observation.status !== 'present') continue;
    const value = observation.value;
    result[name] =
      typeof value === 'string'
        ? value
        : typeof value === 'object' &&
            value !== null &&
            'value' in value &&
            typeof value.value === 'string'
          ? value.value
          : String(value);
  }
  return result;
}

function legacyAttributes(
  record: LegacyRecord,
): ElementContext['attributes'] {
  const isTarget = record.recordType === 'target';
  const attributes: ElementContext['attributes'] = { aria: {} };

  if (isTarget) {
    const target = record.record;
    const authoredId = boundedValue(target.attributes.authoredId);
    const role = boundedValue(target.attributes.role);
    const title = boundedValue(target.attributes.title);
    if (authoredId !== undefined) attributes.authoredId = authoredId;
    if (role !== undefined) attributes.role = role;
    attributes.aria = legacyAria(target.attributes.aria.values);
    if (title !== undefined) attributes.title = title;

    if (target.kind === 'image') {
      const alt = boundedValue(target.attributes.alt);
      if (alt !== undefined) attributes.alt = alt;
      if (target.attributes.inputType?.status === 'present') {
        attributes.inputType = target.attributes.inputType.value.value;
      }
    } else if (target.kind === 'link') {
      if (target.attributes.href.status === 'absent') {
        attributes.hrefKind = 'missing';
      } else if (target.attributes.href.status === 'present') {
        attributes.hrefKind = target.attributes.hrefKind ?? 'same-document';
      }
    } else if (target.kind === 'button') {
      if (target.attributes.inputType?.status === 'present') {
        attributes.inputType = target.attributes.inputType.value.value;
      }
    } else if (target.kind === 'form-control') {
      const name = boundedValue(target.attributes.name);
      const placeholder = target.attributes.placeholder
        ? boundedValue(target.attributes.placeholder)
        : undefined;
      if (name !== undefined) attributes.name = name;
      if (placeholder !== undefined) attributes.placeholder = placeholder;
      if (target.attributes.inputType?.status === 'present') {
        attributes.inputType = target.attributes.inputType.value.value;
      }
      if (target.attributes.required !== 'unavailable') {
        attributes.required = target.attributes.required === 'present';
      }
      if (target.attributes.disabled !== 'unavailable') {
        attributes.disabled = target.attributes.disabled === 'present';
      }
    }
  } else {
    const evidence = record.record;
    const authoredId = boundedValue(evidence.attributes?.authoredId);
    const role = boundedValue(evidence.attributes?.role);
    if (authoredId !== undefined) attributes.authoredId = authoredId;
    if (role !== undefined) attributes.role = role;
    if (evidence.attributes?.aria) {
      attributes.aria = legacyAria(evidence.attributes.aria.values);
    }
  }
  return attributes;
}

function recordStart(record: LegacyRecord): number {
  const locator =
    record.recordType === 'target'
      ? record.record.sourceLocator
      : record.record.sourceLocator;
  return locator?.kind === 'html-source-range'
    ? locator.startOffset
    : Number.MAX_SAFE_INTEGER;
}

function recordText(record: LegacyRecord): string | undefined {
  if (record.recordType === 'target') {
    if (record.record.text?.value) return record.record.text.value;
    if (record.record.kind === 'button' && record.record.attributes.value?.status === 'present') {
      return record.record.attributes.value.value.value;
    }
    return undefined;
  }
  return record.record.text?.value || undefined;
}

function textForContext(
  recordId: string,
  document: ReturnType<typeof extractHtmlContextDocumentV2>,
): string | undefined {
  const record = document.contextRecords.find((item) => item.id === recordId);
  return record?.text.status === 'present' ? record.text.value.value : undefined;
}

function addNameEvidence(
  output: ElementContext['nameEvidence'],
  source: NameEvidenceSource,
  targetContextIds?: string[],
): void {
  output.push(
    targetContextIds ? { source, targetContextIds } : { source },
  );
}

export function extractHtmlContext(html: string): ContextSnapshot {
  const document = extractHtmlContextDocumentV2(html, 'single-document', 'input.html');
  const records: LegacyRecord[] = [
    ...document.snapshot.targets.map(
      (record): LegacyRecord => ({ recordType: 'target', record }),
    ),
    ...document.snapshot.evidence.map(
      (record): LegacyRecord => ({ recordType: 'evidence', record }),
    ),
  ].sort((left, right) => recordStart(left) - recordStart(right));
  const contextIdByKey = new Map(
    records.map((record, index) => [
      `${record.recordType}:${record.record.id}`,
      `ctx-${index + 1}`,
    ]),
  );
  const elements: ElementContext[] = records.map((entry) => {
    const isTarget = entry.recordType === 'target';
    const target = isTarget ? entry.record : undefined;
    const evidence = !isTarget ? entry.record : undefined;
    const id = contextIdByKey.get(`${entry.recordType}:${entry.record.id}`) ?? '';
    const sourceLocator = target?.sourceLocator ?? evidence?.sourceLocator;
    const ownText = recordText(entry);
    const element: ElementContext = {
      contextId: id,
      tagName: entry.record.tagName ?? 'unknown',
      kind:
        target && target.kind !== 'custom-widget'
          ? target.kind
          : target
            ? 'other'
            : 'other',
      attributes: legacyAttributes(entry),
      nameEvidence: [],
      relationships: {
        childContextIds: [],
        labelContextIds: [],
        labelledByContextIds: [],
        describedByContextIds: [],
      },
    };
    if (sourceLocator?.kind === 'dom-path') element.domPath = sourceLocator.path;
    if (target?.kind === 'heading' && target.headingLevel !== undefined) {
      switch (target.headingLevel) {
        case 1:
          element.headingLevel = 1;
          break;
        case 2:
          element.headingLevel = 2;
          break;
        case 3:
          element.headingLevel = 3;
          break;
        case 4:
          element.headingLevel = 4;
          break;
        case 5:
          element.headingLevel = 5;
          break;
        case 6:
          element.headingLevel = 6;
          break;
      }
    }
    if (ownText) {
      element.text = { ownText, truncated: entry.record.completeness.status === 'partial' };
    }
    return element;
  });

  const elementById = new Map(elements.map((element) => [element.contextId, element]));
  for (const relation of document.snapshot.relationships) {
    if ('direction' in relation && relation.direction === 'target-to-associated-record') {
      if (
        relation.kind === 'native-label' &&
        relation.sourceResolution?.status === 'ambiguous' &&
        relation.source.id !== relation.sourceResolution.candidates[0]?.id
      ) {
        continue;
      }
      const sourceId = contextIdByKey.get(recordKey(relation.source));
      const targetId =
        relation.destination.status === 'resolved'
          ? contextIdByKey.get(recordKey(relation.destination.record))
          : undefined;
      const source = sourceId ? elementById.get(sourceId) : undefined;
      if (!source || !targetId) continue;

      if (relation.kind === 'native-label') {
        source.relationships.labelContextIds.push(targetId);
        const labelSource: NameEvidenceSource =
          relation.provenance.basis === 'native-html' &&
          relation.provenance.attribute === 'for'
            ? 'explicit-label'
            : 'wrapping-label';
        addNameEvidence(source.nameEvidence, labelSource, [targetId]);
      } else if (relation.kind === 'aria-labelledby') {
        source.relationships.labelledByContextIds.push(targetId);
      } else if (relation.kind === 'aria-describedby') {
        source.relationships.describedByContextIds.push(targetId);
      }
    } else if ('direction' in relation && relation.direction === 'parent-to-child') {
      const parentId = contextIdByKey.get(recordKey(relation.source));
      const childId = contextIdByKey.get(recordKey(relation.destination.record));
      if (parentId && childId) {
        elementById.get(parentId)?.relationships.childContextIds.push(childId);
        elementById.get(childId)!.relationships.parentContextId = parentId;
      }
    }
  }

  for (const entry of records) {
    if (entry.recordType !== 'target') continue;
    const target = entry.record;
    const legacyId = contextIdByKey.get(`target:${target.id}`);
    const element = legacyId ? elementById.get(legacyId) : undefined;
    if (!element) continue;
    const attr = target.attributes;
    if (attr.aria.values['aria-label']?.status === 'present') {
      addNameEvidence(element.nameEvidence, 'aria-label');
    }
    if (attr.aria.values['aria-labelledby']?.status === 'present') {
      addNameEvidence(
        element.nameEvidence,
        'aria-labelledby',
        element.relationships.labelledByContextIds,
      );
    }
    if (target.kind === 'image') {
      if (target.attributes.alt.status === 'present') {
        addNameEvidence(element.nameEvidence, 'alt');
      }
    }
    if (attr.title.status === 'present') addNameEvidence(element.nameEvidence, 'title');
    if (
      target.kind === 'button' &&
      target.attributes.value?.status === 'present'
    ) {
      addNameEvidence(element.nameEvidence, 'value-attribute');
    } else if (target.text?.value) {
      addNameEvidence(element.nameEvidence, 'text-content');
    }

    const nearby = document.relationships
      .filter(
        (relationship) =>
          relationship.source.recordType === 'target' &&
          relationship.source.id === target.id &&
          (relationship.kind === 'adjacent-before' ||
            relationship.kind === 'adjacent-after') &&
          relationship.destination.status === 'resolved' &&
          relationship.destination.record.recordType === 'context',
      )
      .map((relationship) =>
        relationship.destination.status === 'resolved' &&
        relationship.destination.record.recordType === 'context'
          ? textForContext(relationship.destination.record.id, document)
          : undefined,
      )
      .filter((text): text is string => Boolean(text));
    if (nearby.length) {
      const nearbyText = nearby.join(' ').slice(0, 200);
      element.text = {
        ...(element.text ?? {}),
        nearbyText,
        truncated: (element.text?.truncated ?? false) || nearby.join(' ').length > 200,
      };
    }
  }

  return {
    schemaVersion: 1,
    elementsTruncated:
      document.snapshot.completeness.status === 'partial' ||
      document.evidenceAvailability.surroundingText === 'omitted-incomplete',
    elements,
  };
}
