import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type {
  AriaAttributes,
  AttributeObservation,
  BoundedString,
  BoundedText,
  ContextAriaAttribute,
  ContextCompleteness,
  ContextRecordRef,
  ContextRelationship,
  ContextSnapshot,
  ContextUnavailableReason,
  CustomWidgetRole,
  DocumentContext,
  EvaluationTarget,
  ExtractionTruncation,
  RecordCompleteness,
  RecordTruncation,
  RelationshipDestination,
  RelationshipProvenance,
  SourceLocator,
  SupportingEvidence,
} from '../types/contextV2.js';
import { CONTEXT_SCHEMA_V2 } from '../types/contextV2.js';

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

const MAX_CONTEXT_ELEMENTS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_ATTRIBUTE_VALUE_LENGTH = 250;
const MAX_ATTRIBUTE_NAME_LENGTH = 100;
const MAX_ARIA_ATTRIBUTES = 20;
const MAX_ID_REFERENCE_ATTRIBUTE_LENGTH = 10_000;
const MAX_ID_REFERENCE_TOKENS = 50;
const MAX_ID_REFERENCE_TARGETS_PER_ID = 20;

const SKIPPED_TEXT_TAGS = new Set([
  'iframe',
  'noscript',
  'object',
  'script',
  'style',
  'template',
]);
const FORM_TAGS = new Set(['input', 'select', 'textarea']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const INPUT_PLACEHOLDER_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
]);
const CUSTOM_WIDGET_ROLES = new Set<CustomWidgetRole>([
  'button',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'textbox',
  'combobox',
  'listbox',
  'searchbox',
  'spinbutton',
]);
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

type ElementClassification =
  | { kind: 'image'; basis: { type: 'native-html' } }
  | { kind: 'link'; basis: { type: 'native-html' } }
  | { kind: 'button'; basis: { type: 'native-html' } }
  | { kind: 'form-control'; basis: { type: 'native-html' } }
  | {
      kind: 'heading';
      basis: { type: 'native-html' } | { type: 'aria-heading' };
    }
  | {
      kind: 'custom-widget';
      basis: { type: 'aria-widget'; role: CustomWidgetRole };
    };

interface ParsedIdReferences {
  ids: string[];
  truncated: boolean;
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

function bounded(value: string, limit = MAX_ATTRIBUTE_VALUE_LENGTH): BoundedString {
  return { value: value.slice(0, limit), truncated: value.length > limit };
}

function attributeObservation(
  element: HtmlElement,
  name: string,
): AttributeObservation<BoundedString> {
  const value = getAttribute(element, name);
  return value === undefined
    ? { status: 'absent' }
    : { status: 'present', value: bounded(value) };
}

function observationHasTruncatedValue(observation: unknown): boolean {
  if (
    typeof observation !== 'object' ||
    observation === null ||
    !('status' in observation) ||
    observation.status !== 'present' ||
    !('value' in observation)
  ) {
    return false;
  }
  const value = observation.value;
  return (
    typeof value === 'object' &&
    value !== null &&
    'truncated' in value &&
    value.truncated === true
  );
}

function booleanAttribute(element: HtmlElement, name: string):
  | 'present'
  | 'absent' {
  return hasAttribute(element, name) ? 'present' : 'absent';
}

function boundedText(value: string, limit: number): BoundedText {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return {
    value: normalized.slice(0, limit),
    truncated: normalized.length > limit,
  };
}

function collectText(nodes: HtmlNode[], limit: number): BoundedText {
  const pending = [...nodes].reverse();
  let value = '';
  let truncated = false;

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node.nodeName === '#text' && 'value' in node) {
      const segment = node.value.replace(/\s+/g, ' ').trim();
      if (!segment) continue;
      const separator = value ? ' ' : '';
      const remaining = limit - value.length - separator.length;
      if (remaining <= 0 || segment.length > remaining) {
        value += separator + segment.slice(0, Math.max(remaining, 0));
        truncated = true;
        break;
      }
      value += separator + segment;
      continue;
    }
    if (isElement(node) && SKIPPED_TEXT_TAGS.has(node.tagName)) continue;
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return { value, truncated };
}

function elementText(element: HtmlElement): BoundedText {
  if (FORM_TAGS.has(element.tagName)) {
    return { value: '', truncated: false };
  }
  return collectText(element.childNodes, MAX_TEXT_LENGTH);
}

function parentElement(element: HtmlElement): HtmlElement | undefined {
  const parent = element.parentNode;
  return parent && isElement(parent) ? parent : undefined;
}

function selectHasSelection(select: HtmlElement): boolean {
  const pending = [...select.childNodes].reverse();
  const options: HtmlElement[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (isElement(node)) {
      if (node.tagName === 'select') continue;
      if (node.tagName === 'option') {
        options.push(node);
        if (hasAttribute(node, 'selected')) return true;
        continue;
      }
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  if (
    hasAttribute(select, 'multiple') ||
    (Number(getAttribute(select, 'size') ?? '1') || 1) > 1
  ) {
    return false;
  }
  return options.some(
    (option) =>
      !hasAttribute(option, 'disabled') &&
      !(
        parentElement(option)?.tagName === 'optgroup' &&
        parentElement(option) &&
        hasAttribute(parentElement(option)!, 'disabled')
      ),
  );
}

function classify(element: HtmlElement): ElementClassification | undefined {
  const { tagName } = element;
  const role = getAttribute(element, 'role')?.trim().toLowerCase().split(/\s+/)[0];
  const inputType =
    tagName === 'input'
      ? (getAttribute(element, 'type')?.trim().toLowerCase() ?? 'text')
      : undefined;

  if (tagName === 'input' && inputType === 'hidden') return undefined;
  if (tagName === 'img' || inputType === 'image') {
    return { kind: 'image', basis: { type: 'native-html' } };
  }
  if ((tagName === 'a' || tagName === 'area') && hasAttribute(element, 'href')) {
    return { kind: 'link', basis: { type: 'native-html' } };
  }
  if (
    tagName === 'button' ||
    (tagName === 'input' && BUTTON_INPUT_TYPES.has(inputType ?? ''))
  ) {
    return { kind: 'button', basis: { type: 'native-html' } };
  }
  if (FORM_TAGS.has(tagName) && !(tagName === 'input' && inputType === 'hidden')) {
    return { kind: 'form-control', basis: { type: 'native-html' } };
  }
  if (/^h[1-6]$/.test(tagName)) {
    return { kind: 'heading', basis: { type: 'native-html' } };
  }
  if (role === 'heading') {
    return { kind: 'heading', basis: { type: 'aria-heading' } };
  }
  if (role && CUSTOM_WIDGET_ROLES.has(role as CustomWidgetRole)) {
    return {
      kind: 'custom-widget',
      basis: { type: 'aria-widget', role: role as CustomWidgetRole },
    };
  }
  return undefined;
}

function ariaBoolean(value: string): AttributeObservation<boolean> {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return { status: 'present', value: true };
  if (normalized === 'false') return { status: 'present', value: false };
  return { status: 'invalid', raw: bounded(value) };
}

function ariaNumber(value: string): AttributeObservation<number> {
  const normalized = value.trim();
  if (
    !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
  ) {
    return { status: 'invalid', raw: bounded(value) };
  }
  const number = Number(normalized);
  return Number.isFinite(number)
    ? { status: 'present', value: number }
    : { status: 'invalid', raw: bounded(value) };
}

function ariaString(value: string): AttributeObservation<BoundedString> {
  return { status: 'present', value: bounded(value) };
}

function ariaValue(
  name: ContextAriaAttribute,
  value: string,
): AriaAttributes[ContextAriaAttribute] {
  if (
    [
      'aria-hidden',
      'aria-selected',
      'aria-expanded',
      'aria-disabled',
      'aria-required',
    ].includes(name)
  ) {
    return ariaBoolean(value);
  }
  if (name === 'aria-checked' || name === 'aria-pressed') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'mixed') return { status: 'present', value: 'mixed' };
    return ariaBoolean(value);
  }
  if (name === 'aria-invalid') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'grammar' || normalized === 'spelling') {
      return { status: 'present', value: normalized };
    }
    return ariaBoolean(value);
  }
  if (name === 'aria-level') {
    const level = ariaNumber(value);
    return level.status === 'present' &&
      Number.isInteger(level.value) &&
      level.value > 0
      ? level
      : { status: 'invalid', raw: bounded(value) };
  }
  if (name.startsWith('aria-value')) {
    if (name === 'aria-valuetext') return ariaString(value);
    return ariaNumber(value);
  }
  if (name === 'aria-orientation') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'horizontal' || normalized === 'vertical'
      ? { status: 'present', value: normalized }
      : { status: 'invalid', raw: bounded(value) };
  }
  if (name === 'aria-haspopup') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      return { status: 'present', value: normalized === 'true' };
    }
    if (['menu', 'listbox', 'tree', 'grid', 'dialog'].includes(normalized)) {
      return {
        status: 'present',
        value: normalized as 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog',
      };
    }
    return { status: 'invalid', raw: bounded(value) };
  }
  return ariaString(value);
}

function createAria(element: HtmlElement): {
  values: AriaAttributes;
  truncated: boolean;
} {
  const values: AriaAttributes = {};
  const captured = element.attrs.filter(
    (attribute) =>
      attribute.name.startsWith('aria-') &&
      attribute.name.length <= MAX_ATTRIBUTE_NAME_LENGTH,
  );
  let truncated = captured.length > MAX_ARIA_ATTRIBUTES;
  for (const { name, value } of captured.slice(0, MAX_ARIA_ATTRIBUTES)) {
    if (!ARIA_ATTRIBUTE_NAMES.includes(name as ContextAriaAttribute)) continue;
    const typed = ariaValue(name as ContextAriaAttribute, value);
    Object.assign(values, { [name]: typed });
    if (observationHasTruncatedValue(typed)) truncated = true;
  }
  return { values, truncated };
}

function booleanOrUnavailable(element: HtmlElement, name: string):
  | 'present'
  | 'absent' {
  return booleanAttribute(element, name);
}

function hrefKind(value: string): 'fragment' | 'same-document' | 'external' {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return 'fragment';
  if (trimmed.startsWith('//')) return 'external';
  try {
    new URL(trimmed);
    return 'external';
  } catch {
    return 'same-document';
  }
}

function headingLevel(element: HtmlElement): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  const native = /^h([1-6])$/.exec(element.tagName)?.[1];
  const raw = native ?? getAttribute(element, 'aria-level');
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6
    ? (parsed as 1 | 2 | 3 | 4 | 5 | 6)
    : undefined;
}

function createCommonAttributes(element: HtmlElement) {
  const rawTabIndex = getAttribute(element, 'tabindex');
  const parsedTabIndex = rawTabIndex === undefined ? undefined : Number(rawTabIndex);
  return {
    authoredId: attributeObservation(element, 'id'),
    role: attributeObservation(element, 'role'),
    aria: createAria(element),
    title: attributeObservation(element, 'title'),
    hidden: booleanOrUnavailable(element, 'hidden'),
    inert: booleanOrUnavailable(element, 'inert'),
    tabIndex:
      rawTabIndex === undefined
        ? ({ status: 'absent' } as const)
        : parsedTabIndex !== undefined && Number.isInteger(parsedTabIndex)
          ? ({ status: 'present', value: parsedTabIndex } as const)
          : ({ status: 'invalid', raw: bounded(rawTabIndex) } as const),
  };
}

function createTarget(
  element: HtmlElement,
  id: string,
  classification: ElementClassification,
  sourceLocator?: SourceLocator,
): EvaluationTarget {
  const common = createCommonAttributes(element);
  const base = {
    id,
    tagName: element.tagName,
    text: elementText(element),
    ...(sourceLocator ? { sourceLocator } : {}),
    completeness: { status: 'complete' as const },
  };
  const attrs = common;

  switch (classification.kind) {
    case 'image':
      return {
        ...base,
        kind: 'image',
        basis: classification.basis,
        attributes: {
          ...attrs,
          alt: attributeObservation(element, 'alt'),
          ...(element.tagName === 'input'
            ? { inputType: attributeObservation(element, 'type') }
            : {}),
        },
      };
    case 'link': {
      const href = attributeObservation(element, 'href');
      return {
        ...base,
        kind: 'link',
        basis: classification.basis,
        attributes: {
          ...attrs,
          href,
          ...(href.status === 'present'
            ? { hrefKind: hrefKind(href.value.value) }
            : {}),
        },
      };
    }
    case 'button': {
      const inputType = element.tagName === 'input'
        ? attributeObservation(element, 'type')
        : undefined;
      const value = element.tagName === 'input'
        ? attributeObservation(element, 'value')
        : undefined;
      return {
        ...base,
        kind: 'button',
        basis: classification.basis,
        attributes: {
          ...attrs,
          disabled: booleanOrUnavailable(element, 'disabled'),
          ...(inputType ? { inputType } : {}),
          ...(value ? { value } : {}),
        },
      };
    }
    case 'form-control':
      {
        const typeObservation = element.tagName === 'input'
          ? attributeObservation(element, 'type')
          : undefined;
        const inputType =
          typeObservation?.status === 'present'
            ? typeObservation.value.value.toLowerCase()
            : 'text';
        const attributes = {
          ...attrs,
          name: attributeObservation(element, 'name'),
          required: booleanOrUnavailable(element, 'required'),
          disabled: booleanOrUnavailable(element, 'disabled'),
          ...(element.tagName === 'input' && typeObservation
            ? { inputType: typeObservation }
            : {}),
          ...(element.tagName === 'input' &&
          (inputType === 'checkbox' || inputType === 'radio')
            ? { checked: booleanOrUnavailable(element, 'checked') }
            : {}),
          ...(element.tagName === 'select'
            ? { selected: selectHasSelection(element) ? 'present' as const : 'absent' as const }
            : {}),
          ...(element.tagName === 'textarea' ||
          (element.tagName === 'input' &&
            INPUT_PLACEHOLDER_TYPES.has(inputType))
            ? { placeholder: attributeObservation(element, 'placeholder') }
            : {}),
        };
      return {
        ...base,
        kind: 'form-control',
        basis: classification.basis,
        attributes,
      };
      }
    case 'heading':
      return {
        ...base,
        kind: 'heading',
        basis: classification.basis,
        headingLevel: headingLevel(element),
        attributes: attrs,
      };
    case 'custom-widget':
      return {
        ...base,
        kind: 'custom-widget',
        basis: classification.basis,
        attributes: attrs,
      };
    default:
      throw new Error(`Unsupported evaluation target classification: ${id}`);
  }
}

function sourceLocator(
  element: HtmlElement,
  html: string,
): SourceLocator | undefined {
  const location = element.sourceCodeLocation;
  if (
    location &&
    typeof location.startOffset === 'number' &&
    typeof location.endOffset === 'number' &&
    location.startOffset >= 0 &&
    location.endOffset >= location.startOffset &&
    location.endOffset <= html.length
  ) {
    return {
      kind: 'html-source-range',
      startOffset: location.startOffset,
      endOffset: location.endOffset,
      sourceLanguage: 'html',
      offsetUnit: 'utf16-code-unit',
    };
  }
  const pathParts: string[] = [];
  let current: HtmlElement | undefined = element;
  while (current) {
    const parent = parentElement(current);
    const sameTagSiblings = parent
      ? parent.childNodes.filter(
          (node): node is HtmlElement =>
            isElement(node) && node.tagName === current?.tagName,
        )
      : [current];
    const index = sameTagSiblings.indexOf(current);
    pathParts.unshift(`${current.tagName}[${index + 1}]`);
    current = parent;
  }
  return pathParts.length
    ? {
        kind: 'dom-path',
        format: 'element-index-path-v1',
        path: `/${pathParts.join('/')}`,
      }
    : undefined;
}

function parseIdReferences(value: string | undefined): ParsedIdReferences {
  if (value === undefined) return { ids: [], truncated: false };
  const boundedValue = value.slice(0, MAX_ID_REFERENCE_ATTRIBUTE_LENGTH);
  const tokens = boundedValue.match(/\S+/g) ?? [];
  const truncated =
    value.length > MAX_ID_REFERENCE_ATTRIBUTE_LENGTH ||
    tokens.length > MAX_ID_REFERENCE_TOKENS;
  return {
    ids: tokens.slice(0, MAX_ID_REFERENCE_TOKENS),
    truncated,
  };
}

function field(value: string | undefined, limit = MAX_TEXT_LENGTH):
  | { status: 'present'; value: string; truncated: boolean }
  | { status: 'absent' }
  | { status: 'invalid'; raw?: BoundedString; reason: 'empty' } {
  if (value === undefined) return { status: 'absent' };
  const normalized = value.trim();
  if (!normalized) return { status: 'invalid', raw: bounded(value), reason: 'empty' };
  const result = bounded(normalized, limit);
  return { status: 'present', value: result.value, truncated: result.truncated };
}

function documentContext(
  elements: HtmlElement[],
  addTruncation: (truncation: ExtractionTruncation) => void,
): DocumentContext {
  const htmlElement = elements.find((element) => element.tagName === 'html');
  const titleElement = elements.find((element) => element.tagName === 'title');
  const titleText = titleElement
    ? collectText(titleElement.childNodes, MAX_TEXT_LENGTH)
    : undefined;
  const titleField = field(titleText?.value);
  const title =
    titleField.status === 'present' && titleText?.truncated
      ? { ...titleField, truncated: true }
      : titleField;
  if (
    (title.status === 'present' && title.truncated) ||
    (titleText?.truncated ?? false)
  ) {
    addTruncation({ scope: 'snapshot', limit: 'text-length' });
  }
  const language = field(
    htmlElement ? getAttribute(htmlElement, 'lang') : undefined,
    MAX_ATTRIBUTE_VALUE_LENGTH,
  );
  if (language.status === 'present' && language.truncated) {
    addTruncation({
      scope: 'snapshot',
      limit: 'attribute-value-length',
    });
  }
  return {
    title,
    language,
  };
}

interface MutableState {
  targets: EvaluationTarget[];
  evidence: SupportingEvidence[];
  relationships: ContextRelationship[];
  truncations: ExtractionTruncation[];
  policyOmissions: Map<string, number>;
  omittedByCap: Set<HtmlElement>;
  recordIdByElement: Map<HtmlElement, ContextRecordRef>;
  targetByElement: Map<HtmlElement, EvaluationTarget>;
  evidenceByElement: Map<HtmlElement, SupportingEvidence>;
}

function notePolicyOmission(state: MutableState, category: string): void {
  state.policyOmissions.set(
    category,
    (state.policyOmissions.get(category) ?? 0) + 1,
  );
}

function noteTruncation(
  state: MutableState,
  truncation: ExtractionTruncation,
): void {
  const existing = state.truncations.find(
    (item) =>
      item.scope === truncation.scope &&
      item.limit === truncation.limit &&
      item.recordId === truncation.recordId,
  );
  if (!existing) {
    state.truncations.push(truncation);
    return;
  }
  if (truncation.omittedCount !== undefined) {
    existing.omittedCount = Math.max(
      existing.omittedCount ?? 0,
      truncation.omittedCount,
    );
  }
}

function includeEvidence(
  element: HtmlElement,
  kind: SupportingEvidence['kind'],
  state: MutableState,
  html: string,
  prefix = 'e',
): SupportingEvidence | undefined {
  const prior = state.evidenceByElement.get(element);
  if (prior) return prior;
  if (SKIPPED_TEXT_TAGS.has(element.tagName)) {
    notePolicyOmission(state, 'script-or-style-content');
    return undefined;
  }
  if (state.targets.length + state.evidence.length >= MAX_CONTEXT_ELEMENTS) {
    state.omittedByCap.add(element);
    noteTruncation(state, { scope: 'snapshot', limit: 'record-count' });
    return undefined;
  }
  const id = `${prefix}-${state.evidence.length + 1}`;
  const text = collectText(element.childNodes, MAX_TEXT_LENGTH);
  const aria = createAria(element);
  const evidenceTruncations: RecordTruncation[] = [];
  if (text.truncated) evidenceTruncations.push('text-limit');
  if (aria.truncated) evidenceTruncations.push('aria-attribute-limit');
  if (
    [
      attributeObservation(element, 'id'),
      attributeObservation(element, 'role'),
      ...Object.values(aria.values),
    ].some(observationHasTruncatedValue)
  ) {
    evidenceTruncations.push('attribute-value-limit');
  }
  const completeness: RecordCompleteness = evidenceTruncations.length
    ? {
        status: 'partial',
        truncations: [...new Set(evidenceTruncations)] as [
          RecordTruncation,
          ...RecordTruncation[],
        ],
      }
    : { status: 'complete' };
  const evidence: SupportingEvidence = {
    id,
    kind,
    tagName: element.tagName,
    text,
    attributes: {
      authoredId: attributeObservation(element, 'id'),
      role: attributeObservation(element, 'role'),
      aria,
    },
    sourceLocator: sourceLocator(element, html),
    completeness,
  };
  state.evidence.push(evidence);
  state.evidenceByElement.set(element, evidence);
  state.recordIdByElement.set(element, { recordType: 'evidence', id });
  if (text.truncated) {
    noteTruncation(state, {
      scope: 'evidence',
      limit: 'text-length',
      recordId: id,
    });
  }
  if (evidence.attributes?.aria?.truncated) {
    noteTruncation(state, {
      scope: 'evidence',
      limit: 'aria-attribute-count',
      recordId: id,
    });
  }
  if (evidenceTruncations.includes('attribute-value-limit')) {
    noteTruncation(state, {
      scope: 'evidence',
      limit: 'attribute-value-length',
      recordId: id,
    });
  }
  return evidence;
}

function makeProvenance(
  attribute: 'for' | 'aria-labelledby' | 'aria-describedby',
  value: string,
): RelationshipProvenance {
  return attribute === 'for'
    ? {
        basis: 'native-html',
        attribute: 'for',
        authoredReference: bounded(value),
      }
    : {
        basis: 'aria-idref',
        attribute,
        authoredReference: bounded(value),
      };
}

function relationshipDestination(
  id: string,
  attribute: 'for' | 'aria-labelledby' | 'aria-describedby',
  matches: HtmlElement[],
  state: MutableState,
  html: string,
): {
  destination: RelationshipDestination;
  partial: boolean;
} {
  if (!matches.length) {
    return {
      destination: {
        status: 'unresolved',
        authoredId: bounded(id),
        attribute,
        reason: 'not-found',
      },
      partial: false,
    };
  }

  const candidates = matches.slice(0, MAX_ID_REFERENCE_TARGETS_PER_ID);
  const refs: ContextRecordRef[] = [];
  for (const candidate of candidates) {
    let ref = state.recordIdByElement.get(candidate);
    if (!ref && !SKIPPED_TEXT_TAGS.has(candidate.tagName)) {
      const evidence = includeEvidence(candidate, 'aria-reference', state, html);
      if (evidence) ref = { recordType: 'evidence', id: evidence.id };
    }
    if (ref) refs.push(ref);
  }

  const totalCandidateCount = matches.length;
  const partial =
    totalCandidateCount > MAX_ID_REFERENCE_TARGETS_PER_ID ||
    refs.length < candidates.length;
  if (totalCandidateCount === 1 && refs[0]) {
    return { destination: { status: 'resolved', record: refs[0] }, partial };
  }
  if (totalCandidateCount === 1 && !refs[0]) {
    return {
      destination: {
        status: 'unresolved',
        authoredId: bounded(id),
        attribute,
        reason: state.omittedByCap.has(matches[0]!)
          ? 'truncated'
          : 'excluded-by-policy',
      },
      partial,
    };
  }
  return {
    destination: {
      status: 'ambiguous',
      authoredId: bounded(id),
      attribute,
      candidates: refs,
      totalCandidateCount,
      additionalCandidateCount: Math.max(0, totalCandidateCount - refs.length),
    },
    partial,
  };
}

function addTargetReferenceRelationships(
  target: EvaluationTarget,
  element: HtmlElement,
  allElementsById: Map<string, HtmlElement[]>,
  state: MutableState,
  html: string,
): void {
  for (const attribute of ['aria-labelledby', 'aria-describedby'] as const) {
    const raw = getAttribute(element, attribute);
    if (raw === undefined) continue;
    const parsed = parseIdReferences(raw);
    if (parsed.truncated) {
      noteTruncation(state, {
        scope: 'relationship',
        limit:
          raw.length > MAX_ID_REFERENCE_ATTRIBUTE_LENGTH
            ? 'idref-character-count'
            : 'idref-token-count',
        recordId: `${target.id}:${attribute}`,
      });
    }
    for (const id of parsed.ids) {
      const result = relationshipDestination(
        id,
        attribute,
        allElementsById.get(id) ?? [],
        state,
        html,
      );
      const relationshipId = `r-${state.relationships.length + 1}`;
      if (result.destination.status === 'ambiguous' &&
          result.destination.totalCandidateCount >
            MAX_ID_REFERENCE_TARGETS_PER_ID) {
        noteTruncation(state, {
          scope: 'relationship',
          limit: 'duplicate-id-candidates',
          recordId: relationshipId,
          omittedCount:
            result.destination.totalCandidateCount -
            MAX_ID_REFERENCE_TARGETS_PER_ID,
        });
      }
      state.relationships.push({
        id: relationshipId,
        kind: attribute,
        source: { recordType: 'target', id: target.id },
        destination: result.destination,
        direction: 'target-to-associated-record',
        provenance: makeProvenance(attribute, raw),
        completeness: result.partial
          ? { status: 'partial', reason: 'candidate-list-limit' }
          : { status: 'complete' },
      });
    }
  }
}

function isLabelable(element: HtmlElement): boolean {
  if (!['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'].includes(element.tagName)) {
    return false;
  }
  return !(element.tagName === 'input' && getAttribute(element, 'type')?.toLowerCase() === 'hidden');
}

function firstLabelableDescendant(label: HtmlElement): HtmlElement | undefined {
  const pending = [...label.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (isElement(node)) {
      if (isLabelable(node)) return node;
      if (node.tagName === 'label') continue;
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return undefined;
}

function addNativeLabelRelationships(
  elements: HtmlElement[],
  allElementsById: Map<string, HtmlElement[]>,
  state: MutableState,
  html: string,
): void {
  const labels = elements.filter((element) => element.tagName === 'label');
  for (const label of labels) {
    const forId = getAttribute(label, 'for');
    let associated: HtmlElement[] = [];
    if (forId !== undefined && forId) {
      associated = (allElementsById.get(forId) ?? []).filter(
        (element) => isLabelable(element) && state.targetByElement.has(element),
      );
    } else if (forId === undefined) {
      const wrapped = firstLabelableDescendant(label);
      if (wrapped && state.targetByElement.has(wrapped)) associated = [wrapped];
    }
    if (!associated.length) continue;
    const evidence = includeEvidence(label, 'native-label', state, html);
    if (!evidence) continue;
    for (const element of associated) {
      const target = state.targetByElement.get(element);
      if (!target) continue;
      const allMatches = forId ? allElementsById.get(forId) ?? [] : [element];
      const candidateTargets = allMatches.filter(
        (candidate) =>
          isLabelable(candidate) && state.targetByElement.has(candidate),
      );
      const duplicateCandidates = candidateTargets
        .map((candidate) => ({
          recordType: 'target' as const,
          id: state.targetByElement.get(candidate)!.id,
        }));
      const ambiguous = Boolean(forId && candidateTargets.length > 1);
      const candidateListTruncated =
        ambiguous &&
        candidateTargets.length > MAX_ID_REFERENCE_TARGETS_PER_ID;
      const relationshipId = `r-${state.relationships.length + 1}`;
      if (candidateListTruncated) {
        noteTruncation(state, {
          scope: 'relationship',
          limit: 'duplicate-id-candidates',
          recordId: relationshipId,
          omittedCount:
            candidateTargets.length - MAX_ID_REFERENCE_TARGETS_PER_ID,
        });
      }
      state.relationships.push({
        id: relationshipId,
        kind: 'native-label',
        source: { recordType: 'target', id: target.id },
        destination: {
          status: 'resolved',
          record: { recordType: 'evidence', id: evidence.id },
        },
        direction: 'target-to-associated-record',
        provenance: forId
          ? makeProvenance('for', forId)
          : { basis: 'native-html' },
        completeness: candidateListTruncated
          ? { status: 'partial', reason: 'candidate-list-limit' }
          : { status: 'complete' },
        ...(ambiguous
          ? {
              sourceResolution: {
                status: 'ambiguous' as const,
                authoredId: bounded(forId!),
                candidates: duplicateCandidates.slice(
                  0,
                  MAX_ID_REFERENCE_TARGETS_PER_ID,
                ),
                totalCandidateCount: candidateTargets.length,
                additionalCandidateCount: Math.max(
                  0,
                  candidateTargets.length -
                    Math.min(duplicateCandidates.length, MAX_ID_REFERENCE_TARGETS_PER_ID),
                ),
              },
            }
          : {}),
      });
    }
  }
}

function addStructuralRelationships(state: MutableState): void {
  const refs = state.recordIdByElement;
  for (const [element, childRef] of refs) {
    let ancestor = parentElement(element);
    while (ancestor && !refs.has(ancestor)) ancestor = parentElement(ancestor);
    if (!ancestor) continue;
    const parentRef = refs.get(ancestor);
    if (!parentRef) continue;
    state.relationships.push({
      id: `r-${state.relationships.length + 1}`,
      kind: 'parent-child',
      source: parentRef,
      destination: { status: 'resolved', record: childRef },
      direction: 'parent-to-child',
      provenance: { basis: 'structural-html', ruleId: 'nearest-included-parent' },
      completeness: { status: 'complete' },
    });
  }
}

export function extractHtmlContextV2(html: string): ContextSnapshot {
  const parsedDocument = parse(html, { sourceCodeLocationInfo: true });
  const elements: HtmlElement[] = [];
  const pending: HtmlNode[] = [parsedDocument];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (isElement(node)) elements.push(node);
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }

  const allElementsById = new Map<string, HtmlElement[]>();
  for (const element of elements) {
    const id = getAttribute(element, 'id');
    if (id !== undefined) {
      const matches = allElementsById.get(id) ?? [];
      matches.push(element);
      allElementsById.set(id, matches);
    }
  }

  const state: MutableState = {
    targets: [],
    evidence: [],
    relationships: [],
    truncations: [],
    policyOmissions: new Map(),
    omittedByCap: new Set(),
    recordIdByElement: new Map(),
    targetByElement: new Map(),
    evidenceByElement: new Map(),
  };

  for (const element of elements) {
    if (SKIPPED_TEXT_TAGS.has(element.tagName)) {
      notePolicyOmission(state, 'script-or-style-content');
      continue;
    }
    const classification = classify(element);
    if (!classification) {
      const isHiddenInput =
        element.tagName === 'input' &&
        (getAttribute(element, 'type')?.trim().toLowerCase() ?? 'text') ===
          'hidden';
      notePolicyOmission(
        state,
        getAttribute(element, 'role') && !isHiddenInput
          ? 'unsupported-role'
          : 'non-target-node',
      );
      continue;
    }
    if (state.targets.length + state.evidence.length >= MAX_CONTEXT_ELEMENTS) {
      state.omittedByCap.add(element);
      noteTruncation(state, { scope: 'snapshot', limit: 'record-count' });
      continue;
    }
    const id = `t-${state.targets.length + 1}`;
    const locator = sourceLocator(element, html);
    const target = createTarget(element, id, classification, locator);
    state.targets.push(target);
    state.targetByElement.set(element, target);
    state.recordIdByElement.set(element, { recordType: 'target', id });
    const attributeTruncated = [
      target.attributes.authoredId,
      target.attributes.role,
      target.attributes.title,
      ...Object.values(target.attributes.aria.values),
      ...('alt' in target.attributes ? [target.attributes.alt] : []),
      ...('href' in target.attributes ? [target.attributes.href] : []),
      ...('inputType' in target.attributes && target.attributes.inputType
        ? [target.attributes.inputType]
        : []),
      ...('name' in target.attributes ? [target.attributes.name] : []),
      ...('placeholder' in target.attributes
        ? [target.attributes.placeholder]
        : []),
      ...('value' in target.attributes && target.attributes.value
        ? [target.attributes.value]
        : []),
    ].some(
      observationHasTruncatedValue,
    );
    const targetTruncations: RecordTruncation[] = [];
    if (attributeTruncated) targetTruncations.push('attribute-value-limit');
    if (target.text?.truncated) targetTruncations.push('text-limit');
    if (target.attributes.aria.truncated) {
      targetTruncations.push('aria-attribute-limit');
    }
    if (targetTruncations.length) {
      target.completeness = {
        status: 'partial',
        truncations: [...new Set(targetTruncations)] as [
          RecordTruncation,
          ...RecordTruncation[],
        ],
      };
      for (const truncation of targetTruncations) {
        const limit: ExtractionTruncation['limit'] =
          truncation === 'text-limit'
            ? 'text-length'
            : truncation === 'aria-attribute-limit'
              ? 'aria-attribute-count'
              : 'attribute-value-length';
        noteTruncation(state, {
          scope: 'target',
          limit,
          recordId: target.id,
        });
      }
    }
  }

  for (const [element, target] of state.targetByElement) {
    addTargetReferenceRelationships(
      target,
      element,
      allElementsById,
      state,
      html,
    );
  }
  addNativeLabelRelationships(elements, allElementsById, state, html);
  addStructuralRelationships(state);
  const documentContextValue = documentContext(elements, (truncation) =>
    noteTruncation(state, truncation),
  );

  const unresolvedCount = state.relationships.filter(
    (relationship) =>
      'destination' in relationship &&
      relationship.destination.status === 'unresolved',
  ).length;
  const ambiguousCount = state.relationships.filter(
    (relationship) =>
      ('destination' in relationship &&
        relationship.destination.status === 'ambiguous') ||
      ('sourceResolution' in relationship &&
        relationship.sourceResolution?.status === 'ambiguous'),
  ).length;
  const policyOmissions = [...state.policyOmissions.entries()].map(
    ([category, count]) => ({
      category: category as
        | 'non-target-node'
        | 'unsupported-role'
        | 'unsupported-evidence-category'
        | 'script-or-style-content',
      count,
    }),
  );
  const completeness: ContextCompleteness =
    state.truncations.length === 0
      ? {
          status: 'complete',
          truncations: [],
          policyOmissions,
          relationshipResolution: { unresolvedCount, ambiguousCount },
        }
      : {
          status: 'partial',
          truncations: state.truncations as [
            ExtractionTruncation,
            ...ExtractionTruncation[],
          ],
          policyOmissions,
          relationshipResolution: { unresolvedCount, ambiguousCount },
        };

  return {
    schemaVersion: CONTEXT_SCHEMA_V2,
    document: documentContextValue,
    targets: state.targets,
    evidence: state.evidence,
    relationships: state.relationships,
    completeness,
  };
}

export function extractHtmlContextResultV2(html: string):
  | { status: 'available'; snapshot: ContextSnapshot }
  | { status: 'unavailable'; reason: ContextUnavailableReason } {
  try {
    return { status: 'available', snapshot: extractHtmlContextV2(html) };
  } catch {
    return { status: 'unavailable', reason: 'parser-failure' };
  }
}
