import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type {
  ContextKind,
  ContextSnapshot,
  ElementContext,
  NameEvidenceSource,
} from '../types/context.js';

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;

const MAX_CONTEXT_ELEMENTS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_NEARBY_TEXT_LENGTH = 200;
const MAX_ATTRIBUTE_VALUE_LENGTH = 250;
const MAX_ATTRIBUTE_NAME_LENGTH = 100;
const MAX_ARIA_ATTRIBUTES = 20;
// Cap IDREF tokenization and duplicate-ID expansion independently of captured attributes.
const MAX_ID_REFERENCE_ATTRIBUTE_LENGTH = 10_000;
const MAX_ID_REFERENCE_TOKENS = 50;
const MAX_ID_REFERENCE_TARGETS_PER_ID = 20;

const HEADING_TAG = /^h([1-6])$/;
const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const LABELABLE_TAGS = new Set([
  'button',
  'input',
  'meter',
  'output',
  'progress',
  'select',
  'textarea',
]);
const FORM_CONTROL_ROLES = new Set([
  'checkbox',
  'combobox',
  'listbox',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);
const SKIPPED_TEXT_TAGS = new Set([
  'iframe',
  'noscript',
  'object',
  'script',
  'style',
  'template',
]);
const NON_TEXT_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

interface BoundedText {
  value: string;
  truncated: boolean;
}

interface BoundedIdReferences {
  ids: string[];
  truncated: boolean;
}

interface ElementIdReferences {
  labelledBy: BoundedIdReferences;
  describedBy: BoundedIdReferences;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function getAttribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function hasAttribute(element: HtmlElement, name: string): boolean {
  return element.attrs.some((attribute) => attribute.name === name);
}

function getRole(element: HtmlElement): string | undefined {
  return getAttribute(element, 'role')?.trim().split(/\s+/)[0]?.toLowerCase();
}

function getInputType(element: HtmlElement): string | undefined {
  return element.tagName === 'input'
    ? (getAttribute(element, 'type')?.toLowerCase() ?? 'text')
    : undefined;
}

function getKind(element: HtmlElement): ContextKind {
  const { tagName } = element;
  const role = getRole(element);
  const inputType = getInputType(element);

  if (
    tagName === 'img' ||
    inputType === 'image' ||
    role === 'img' ||
    role === 'graphics-document' ||
    role === 'graphics-object' ||
    role === 'graphics-symbol'
  ) {
    return 'image';
  }
  if (
    (tagName === 'a' || tagName === 'area') &&
    (hasAttribute(element, 'href') || role === 'link')
  ) {
    return 'link';
  }
  if (
    tagName === 'button' ||
    (tagName === 'input' && BUTTON_INPUT_TYPES.has(inputType ?? '')) ||
    role === 'button'
  ) {
    return 'button';
  }
  if (FORM_CONTROL_TAGS.has(tagName) || FORM_CONTROL_ROLES.has(role ?? '')) {
    return 'form-control';
  }
  if (HEADING_TAG.test(tagName) || role === 'heading') {
    return 'heading';
  }

  return 'other';
}

function isRelevant(element: HtmlElement): boolean {
  const { tagName } = element;
  const inputType = getInputType(element);
  const semantic =
    tagName === 'img' ||
    ((tagName === 'a' || tagName === 'area') && hasAttribute(element, 'href')) ||
    tagName === 'button' ||
    FORM_CONTROL_TAGS.has(tagName) ||
    (tagName === 'input' &&
      (BUTTON_INPUT_TYPES.has(inputType ?? '') || inputType === 'image')) ||
    tagName === 'h1' ||
    tagName === 'h2' ||
    tagName === 'h3' ||
    tagName === 'h4' ||
    tagName === 'h5' ||
    tagName === 'h6';
  const hasAria = element.attrs.some(
    ({ name }) => name === 'role' || name.startsWith('aria-'),
  );

  return semantic || hasAria;
}

function boundedText(value: string, limit: number): BoundedText {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return {
    value: normalized.slice(0, limit),
    truncated: normalized.length > limit,
  };
}

function isInEditableRegion(element: HtmlElement): boolean {
  let current: HtmlElement | undefined = element;
  while (current) {
    if (hasAttribute(current, 'contenteditable')) {
      const contentEditable = getAttribute(current, 'contenteditable')
        ?.trim()
        .toLowerCase();
      if (contentEditable === 'false') {
        return false;
      }
      if (
        contentEditable === '' ||
        contentEditable === 'true' ||
        contentEditable === 'plaintext-only'
      ) {
        return true;
      }
    }
    current = parentElement(current);
  }
  return false;
}

function isInsideEditableRegion(node: HtmlNode): boolean {
  let current: HtmlNode | null = node;
  while (current && !isElement(current)) {
    current = 'parentNode' in current ? current.parentNode : null;
  }
  return current ? isInEditableRegion(current) : false;
}

function collectText(nodes: HtmlNode[], limit: number): BoundedText {
  const pending = [...nodes].reverse();
  let value = '';
  let truncated = false;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (current.nodeName === '#text') {
      if ('value' in current && !isInsideEditableRegion(current)) {
        const segment = current.value.replace(/\s+/g, ' ').trim();
        if (segment) {
          if (value.length >= limit) {
            truncated = true;
            break;
          }
          const separator = value ? ' ' : '';
          const remaining = limit - value.length - separator.length;
          if (segment.length > remaining) {
            value += separator + segment.slice(0, Math.max(remaining, 0));
            truncated = true;
            break;
          }
          value += separator + segment;
        }
      }
      continue;
    }
    if (isElement(current)) {
      if (
        SKIPPED_TEXT_TAGS.has(current.tagName) ||
        NON_TEXT_CONTROL_TAGS.has(current.tagName) ||
        isInEditableRegion(current)
      ) {
        continue;
      }
    }
    if ('childNodes' in current) {
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        const child = current.childNodes[index];
        if (child) {
          pending.push(child);
        }
      }
    }
  }
  return { value, truncated };
}

function elementText(element: HtmlElement): BoundedText {
  if (
    NON_TEXT_CONTROL_TAGS.has(element.tagName) ||
    isInEditableRegion(element)
  ) {
    return { value: '', truncated: false };
  }
  return collectText(element.childNodes, MAX_TEXT_LENGTH);
}

function nearbyText(element: HtmlElement): BoundedText {
  const parent = element.parentNode;
  if (!parent || !('childNodes' in parent)) {
    return { value: '', truncated: false };
  }

  const siblings = parent.childNodes;
  const index = siblings.indexOf(element);
  const neighbors = [
    ...siblings.slice(Math.max(0, index - 1), index),
    ...siblings.slice(index + 1, index + 2),
  ];
  return collectText(neighbors, MAX_NEARBY_TEXT_LENGTH);
}

function getElementText(element: HtmlElement): {
  ownText: BoundedText;
  nearbyText: BoundedText;
} {
  const ownText = elementText(element);
  const value = getAttribute(element, 'value');
  if (
    !ownText.value &&
    element.tagName === 'input' &&
    BUTTON_INPUT_TYPES.has(getInputType(element) ?? '') &&
    value
  ) {
    return {
      ownText: boundedText(value, MAX_TEXT_LENGTH),
      nearbyText: nearbyText(element),
    };
  }

  return { ownText, nearbyText: nearbyText(element) };
}

function idReferences(
  element: HtmlElement,
  attribute: string,
): BoundedIdReferences {
  const raw = getAttribute(element, attribute) ?? '';
  const rawTruncated = raw.length > MAX_ID_REFERENCE_ATTRIBUTE_LENGTH;
  const bounded = raw.slice(0, MAX_ID_REFERENCE_ATTRIBUTE_LENGTH);
  const refs: string[] = [];
  const tokenPattern = /\S+/g;
  let truncated = rawTruncated;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(bounded)) !== null) {
    if (refs.length === MAX_ID_REFERENCE_TOKENS) {
      truncated = true;
      break;
    }

    const token = match[0];
    const tokenEnd = match.index + token.length;
    if (rawTruncated && tokenEnd === bounded.length) {
      truncated = true;
      break;
    }

    refs.push(token);
  }

  return { ids: refs, truncated };
}

function isLabelable(element: HtmlElement): boolean {
  if (!LABELABLE_TAGS.has(element.tagName)) {
    return false;
  }
  return !(
    element.tagName === 'input' &&
    getInputType(element) === 'hidden'
  );
}

function firstLabelableDescendant(
  label: HtmlElement,
): HtmlElement | undefined {
  const pending = [...label.childNodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (isElement(node)) {
      if (isLabelable(node)) {
        return node;
      }
      if (node.tagName === 'label') {
        continue;
      }
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) {
          pending.push(child);
        }
      }
    }
  }
  return undefined;
}

function nativeLabelsFor(
  element: HtmlElement,
  labels: HtmlElement[],
  elementsById: Map<string, HtmlElement[]>,
): { explicit: HtmlElement[]; wrapping: HtmlElement[] } {
  if (!isLabelable(element)) {
    return { explicit: [], wrapping: [] };
  }

  const explicit = labels.filter((label) => {
    if (!hasAttribute(label, 'for')) {
      return false;
    }
    const targetId = getAttribute(label, 'for');
    if (!targetId) {
      return false;
    }
    const firstMatchingElement = elementsById.get(targetId)?.[0];
    return firstMatchingElement === element;
  });
  const wrapping = labels.filter(
    (label) =>
      !hasAttribute(label, 'for') &&
      firstLabelableDescendant(label) === element,
  );

  return { explicit, wrapping };
}

function hrefKind(value: string | undefined): ElementContext['attributes']['hrefKind'] {
  if (value === undefined) {
    return 'missing';
  }
  if (value.trim().startsWith('#')) {
    return 'fragment';
  }

  if (value.trim().startsWith('//')) {
    return 'external';
  }
  try {
    new URL(value);
    return 'external';
  } catch {
    return 'same-document';
  }
}

function attributeValue(element: HtmlElement, name: string): string | undefined {
  const value = getAttribute(element, name);
  return value === undefined
    ? undefined
    : value.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
}

function createAttributes(element: HtmlElement): ElementContext['attributes'] {
  const attributes: ElementContext['attributes'] = { aria: {} };
  const id = getAttribute(element, 'id');
  const role = getAttribute(element, 'role');
  const alt = getAttribute(element, 'alt');
  const title = getAttribute(element, 'title');
  const name = getAttribute(element, 'name');
  const placeholder = getAttribute(element, 'placeholder');
  const inputType = getInputType(element);

  if (id !== undefined) {
    attributes.authoredId = id.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  if (role !== undefined) {
    attributes.role = role.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  for (const { name: attributeName, value } of element.attrs) {
    if (
      attributeName.startsWith('aria-') &&
      attributeName.length <= MAX_ATTRIBUTE_NAME_LENGTH &&
      Object.keys(attributes.aria).length < MAX_ARIA_ATTRIBUTES
    ) {
      attributes.aria[attributeName] = value.slice(
        0,
        MAX_ATTRIBUTE_VALUE_LENGTH,
      );
    }
  }
  if (alt !== undefined) {
    attributes.alt = alt.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  if (title !== undefined) {
    attributes.title = title.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  if (inputType !== undefined) {
    attributes.inputType = inputType.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  if (name !== undefined) {
    attributes.name = name.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  if (placeholder !== undefined) {
    attributes.placeholder = placeholder.slice(
      0,
      MAX_ATTRIBUTE_VALUE_LENGTH,
    );
  }
  if (hasAttribute(element, 'required')) {
    attributes.required = true;
  }
  if (hasAttribute(element, 'disabled')) {
    attributes.disabled = true;
  }
  if (element.tagName === 'a' || element.tagName === 'area') {
    attributes.hrefKind = hrefKind(getAttribute(element, 'href'));
  }

  return attributes;
}

function getHeadingLevel(element: HtmlElement): ElementContext['headingLevel'] {
  const match = HEADING_TAG.exec(element.tagName);
  const level =
    match?.[1] ??
    (getRole(element) === 'heading'
      ? getAttribute(element, 'aria-level')
      : undefined);
  const parsedLevel = Number(level);

  return Number.isInteger(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 6
    ? (parsedLevel as 1 | 2 | 3 | 4 | 5 | 6)
    : undefined;
}

function isTextContext(element: HtmlElement): boolean {
  return (
    !['input', 'select', 'textarea'].includes(element.tagName) &&
    !(element.tagName === 'script' || element.tagName === 'style')
  );
}

function addEvidence(
  evidence: ElementContext['nameEvidence'],
  source: NameEvidenceSource,
  targetContextIds?: string[],
): void {
  evidence.push(
    targetContextIds
      ? { source, targetContextIds }
      : { source },
  );
}

function parentElement(element: HtmlElement): HtmlElement | undefined {
  const parent = element.parentNode;
  return parent && isElement(parent) ? parent : undefined;
}

/**
 * Extract bounded structural facts from HTML. This does not compute accessible
 * names or determine whether any element violates an accessibility rule.
 * Parsing and initial document traversal still process the full HTML input.
 */
export function extractHtmlContext(html: string): ContextSnapshot {
  const document = parse(html);
  const elements: HtmlElement[] = [];
  const elementsById = new Map<string, HtmlElement[]>();

  const pending: HtmlNode[] = [document];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (isElement(node)) {
      elements.push(node);
      const id = getAttribute(node, 'id');
      if (id !== undefined) {
        const matches = elementsById.get(id) ?? [];
        if (matches.length <= MAX_ID_REFERENCE_TARGETS_PER_ID) {
          matches.push(node);
          elementsById.set(id, matches);
        }
      }
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) {
          pending.push(child);
        }
      }
    }
  }

  const labels = elements.filter(({ tagName }) => tagName === 'label');
  const included = new Set<HtmlElement>();
  const omittedByElementCap = new Set<HtmlElement>();
  const queue: HtmlElement[] = [];
  const referencesByElement = new Map<HtmlElement, ElementIdReferences>();
  let elementsTruncated = false;

  function referencesFor(element: HtmlElement): ElementIdReferences {
    let references = referencesByElement.get(element);
    if (!references) {
      references = {
        labelledBy: idReferences(element, 'aria-labelledby'),
        describedBy: idReferences(element, 'aria-describedby'),
      };
      referencesByElement.set(element, references);
    }
    return references;
  }

  function include(element: HtmlElement): void {
    if (included.has(element) || SKIPPED_TEXT_TAGS.has(element.tagName)) {
      return;
    }
    if (included.size >= MAX_CONTEXT_ELEMENTS) {
      elementsTruncated = true;
      omittedByElementCap.add(element);
      return;
    }
    included.add(element);
    queue.push(element);
  }

  for (const element of elements) {
    if (isRelevant(element)) {
      include(element);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const element = queue[cursor];
    if (!element) {
      continue;
    }

    const { explicit, wrapping } = nativeLabelsFor(
      element,
      labels,
      elementsById,
    );
    for (const label of [...explicit, ...wrapping]) {
      include(label);
    }

    const references = referencesFor(element);
    for (const reference of [
      ...references.labelledBy.ids,
      ...references.describedBy.ids,
    ]) {
      const targets = elementsById.get(reference) ?? [];
      for (const target of targets.slice(0, MAX_ID_REFERENCE_TARGETS_PER_ID)) {
        include(target);
      }
    }
  }

  const includedInDocumentOrder = elements.filter((element) =>
    included.has(element),
  );
  const contextIdByElement = new Map<HtmlElement, string>();
  includedInDocumentOrder.forEach((element, index) => {
    contextIdByElement.set(element, `ctx-${index + 1}`);
  });

  const contexts: ElementContext[] = includedInDocumentOrder.map((element) => {
    const text = getElementText(element);
    const attributes = createAttributes(element);
    const references = referencesFor(element);
    const { explicit, wrapping } = nativeLabelsFor(
      element,
      labels,
      elementsById,
    );
    const labelledBy = [
      ...new Set(
        references.labelledBy.ids
          .flatMap((id) =>
            (elementsById.get(id) ?? []).slice(
              0,
              MAX_ID_REFERENCE_TARGETS_PER_ID,
            ),
          )
          .map((target) => contextIdByElement.get(target))
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const describedBy = [
      ...new Set(
        references.describedBy.ids
          .flatMap((id) =>
            (elementsById.get(id) ?? []).slice(
              0,
              MAX_ID_REFERENCE_TARGETS_PER_ID,
            ),
          )
          .map((target) => contextIdByElement.get(target))
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const hasOmittedTargets = (references: BoundedIdReferences): boolean =>
      references.ids.some((id) =>
        (elementsById.get(id) ?? [])
          .slice(0, MAX_ID_REFERENCE_TARGETS_PER_ID)
          .some((target) => omittedByElementCap.has(target)),
      );
    const nameEvidence: ElementContext['nameEvidence'] = [];
    const selfContextId = contextIdByElement.get(element);
    const explicitLabelIds = explicit
      .map((label) => contextIdByElement.get(label))
      .filter((id): id is string => id !== undefined);
    const wrappingLabelIds = wrapping
      .map((label) => contextIdByElement.get(label))
      .filter((id): id is string => id !== undefined);
    if (hasAttribute(element, 'aria-label')) {
      addEvidence(nameEvidence, 'aria-label');
    }
    if (hasAttribute(element, 'aria-labelledby')) {
      addEvidence(nameEvidence, 'aria-labelledby', labelledBy);
    }
    if (explicitLabelIds.length > 0) {
      addEvidence(nameEvidence, 'explicit-label', explicitLabelIds);
    }
    if (wrappingLabelIds.length > 0) {
      addEvidence(nameEvidence, 'wrapping-label', wrappingLabelIds);
    }
    if (hasAttribute(element, 'alt')) {
      addEvidence(nameEvidence, 'alt');
    }
    if (hasAttribute(element, 'title')) {
      addEvidence(nameEvidence, 'title');
    }
    if (isTextContext(element) && text.ownText.value) {
      addEvidence(nameEvidence, 'text-content');
    }
    if (
      element.tagName === 'input' &&
      BUTTON_INPUT_TYPES.has(getInputType(element) ?? '') &&
      Boolean(getAttribute(element, 'value'))
    ) {
      addEvidence(nameEvidence, 'value-attribute');
    }

    const parentId = (() => {
      let ancestor = parentElement(element);
      while (ancestor) {
        const contextId = contextIdByElement.get(ancestor);
        if (contextId) {
          return contextId;
        }
        ancestor = parentElement(ancestor);
      }
      return undefined;
    })();

    const context: ElementContext = {
      contextId: selfContextId ?? '',
      tagName: element.tagName,
      kind: getKind(element),
      attributes,
      nameEvidence,
      relationships: {
        childContextIds: [],
        labelContextIds: [...new Set([...explicitLabelIds, ...wrappingLabelIds])],
        labelledByContextIds: [...new Set(labelledBy)],
        describedByContextIds: [...new Set(describedBy)],
      },
    };
    if (references.labelledBy.truncated) {
      context.relationships.labelledByReferencesTruncated = true;
    }
    if (references.describedBy.truncated) {
      context.relationships.describedByReferencesTruncated = true;
    }
    if (
      references.labelledBy.ids.some(
        (id) =>
          (elementsById.get(id)?.length ?? 0) >
          MAX_ID_REFERENCE_TARGETS_PER_ID,
      )
    ) {
      context.relationships.labelledByTargetsTruncated = true;
    }
    if (
      references.describedBy.ids.some(
        (id) =>
          (elementsById.get(id)?.length ?? 0) >
          MAX_ID_REFERENCE_TARGETS_PER_ID,
      )
    ) {
      context.relationships.describedByTargetsTruncated = true;
    }
    if (hasOmittedTargets(references.labelledBy)) {
      context.relationships.labelledByTargetsOmitted = true;
    }
    if (hasOmittedTargets(references.describedBy)) {
      context.relationships.describedByTargetsOmitted = true;
    }
    if (
      [...explicit, ...wrapping].some((label) =>
        omittedByElementCap.has(label),
      )
    ) {
      context.relationships.labelTargetsOmitted = true;
    }
    const headingLevel = getHeadingLevel(element);
    if (headingLevel !== undefined) {
      context.headingLevel = headingLevel;
    }
    if (parentId) {
      context.relationships.parentContextId = parentId;
    }

    const textFields: NonNullable<ElementContext['text']> = {
      truncated: text.ownText.truncated || text.nearbyText.truncated,
    };
    if (isTextContext(element) && text.ownText.value) {
      textFields.ownText = text.ownText.value;
    }
    if (text.nearbyText.value) {
      textFields.nearbyText = text.nearbyText.value;
    }
    if (textFields.ownText || textFields.nearbyText || textFields.truncated) {
      context.text = textFields;
    }

    return context;
  });

  const contextById = new Map(contexts.map((context) => [context.contextId, context]));
  for (const context of contexts) {
    const parentId = context.relationships.parentContextId;
    if (parentId) {
      contextById.get(parentId)?.relationships.childContextIds.push(
        context.contextId,
      );
    }
  }

  return {
    schemaVersion: 1,
    elementsTruncated,
    elements: contexts,
  };
}
