import {
  ErrorCodes,
  parse,
  type DefaultTreeAdapterTypes,
  type ParserError,
} from 'parse5';
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
import type {
  AuthoredNameInput,
  ProjectContextCategory,
  ProjectContextDocument,
  ProjectContextRecord,
  ProjectEvidence,
  ProjectLinkReference,
  ProjectRecordRef,
  ProjectRelationship,
  ProjectTargetEvidence,
} from '../types/contextProject.js';
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
  'link',
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
  'aria-errormessage',
  'aria-hidden',
  'aria-level',
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-pressed',
  'aria-disabled',
  'aria-required',
  'aria-invalid',
  'aria-live',
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
      if (isInsideEditableRegion(node)) continue;
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
    if (
      isElement(node) &&
      (SKIPPED_TEXT_TAGS.has(node.tagName) ||
        FORM_TAGS.has(node.tagName) ||
        isInEditableRegion(node))
    ) {
      continue;
    }
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
  if (FORM_TAGS.has(element.tagName) || isInEditableRegion(element)) {
    return { value: '', truncated: false };
  }
  return collectText(element.childNodes, MAX_TEXT_LENGTH);
}

function isInEditableRegion(element: HtmlElement): boolean {
  let current: HtmlElement | undefined = element;
  while (current) {
    if (hasAttribute(current, 'contenteditable')) {
      const state = getAttribute(current, 'contenteditable')
        ?.trim()
        .toLowerCase();
      if (state === 'false') return false;
      if (state === '' || state === 'true' || state === 'plaintext-only') {
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

function headingLevel(element: HtmlElement): number | undefined {
  const native = /^h([1-6])$/.exec(element.tagName)?.[1];
  const raw = native ?? getAttribute(element, 'aria-level');
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
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
          src: attributeObservation(element, 'src'),
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
          ...(getAttribute(element, 'autocomplete') !== undefined
            ? { autoComplete: attributeObservation(element, 'autocomplete') }
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
        attributes: {
          ...attrs,
          ...(classification.basis.role === 'link'
            ? { href: attributeObservation(element, 'href') }
            : {}),
        },
      };
    default:
      throw new Error(`Unsupported evaluation target classification: ${id}`);
  }
}

function markTargetAttributesUnavailable(target: EvaluationTarget): void {
  const unavailable = () =>
    ({ status: 'unavailable', reason: 'parser-normalized-duplicate' }) as const;
  const attributes = target.attributes;
  attributes.authoredId = unavailable();
  attributes.role = unavailable();
  attributes.title = unavailable();
  attributes.tabIndex = unavailable();
  attributes.hidden = 'unavailable';
  attributes.inert = 'unavailable';
  attributes.aria.truncated = false;
  for (const name of ARIA_ATTRIBUTE_NAMES) {
    Object.assign(attributes.aria.values, { [name]: unavailable() });
  }
  switch (target.kind) {
    case 'image':
      target.attributes.alt = unavailable();
      target.attributes.src = unavailable();
      if (target.attributes.inputType) target.attributes.inputType = unavailable();
      break;
    case 'link':
      target.attributes.href = unavailable();
      break;
    case 'button':
      target.attributes.disabled = 'unavailable';
      if (target.attributes.inputType) target.attributes.inputType = unavailable();
      if (target.attributes.value) target.attributes.value = unavailable();
      break;
    case 'form-control':
      target.attributes.name = unavailable();
      target.attributes.required = 'unavailable';
      target.attributes.disabled = 'unavailable';
      if (target.attributes.inputType) target.attributes.inputType = unavailable();
      if (target.attributes.placeholder) {
        target.attributes.placeholder = unavailable();
      }
      if (target.attributes.autoComplete) {
        target.attributes.autoComplete = unavailable();
      }
      if (target.attributes.checked) target.attributes.checked = 'unavailable';
      if (target.attributes.selected) target.attributes.selected = 'unavailable';
      break;
    case 'heading':
    case 'custom-widget':
    case 'other':
      if (target.kind === 'custom-widget' && target.attributes.href) {
        target.attributes.href = unavailable();
      }
      break;
  }
  target.completeness = {
    status: 'partial',
    truncations: ['parser-diagnostic'],
  };
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

const PROJECT_CONTEXT_TAGS = new Map<string, ProjectContextCategory>([
  ['p', 'text'],
  ['blockquote', 'text'],
  ['pre', 'text'],
  ['label', 'label'],
  ['legend', 'group'],
  ['form', 'form'],
  ['fieldset', 'group'],
  ['section', 'section'],
  ['article', 'section'],
  ['main', 'landmark'],
  ['nav', 'landmark'],
  ['header', 'landmark'],
  ['footer', 'landmark'],
  ['aside', 'landmark'],
  ['ul', 'list'],
  ['ol', 'list'],
  ['dl', 'list'],
  ['li', 'list-item'],
  ['dt', 'list-item'],
  ['dd', 'list-item'],
  ['table', 'table'],
  ['caption', 'caption'],
  ['th', 'table-cell'],
  ['td', 'table-cell'],
  ['figcaption', 'caption'],
  ['figure', 'figure'],
  ['summary', 'text'],
  ['title', 'text'],
]);

const PROJECT_CONTEXT_ATTRIBUTES = [
  'id',
  'role',
  'title',
  'alt',
  'src',
  'href',
  'for',
  'form',
  'type',
  'name',
  'placeholder',
  'action',
  'method',
  'autocomplete',
  'hidden',
  'disabled',
  'required',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-errormessage',
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
  'aria-live',
  'aria-atomic',
  'aria-relevant',
  'aria-busy',
] as const;

const MAX_PROJECT_CONTEXT_RECORDS = 500;

function collectDirectText(nodes: HtmlNode[], limit: number): BoundedText {
  let value = '';
  let truncated = false;
  for (const node of nodes) {
    if (node.nodeName !== '#text' || !('value' in node)) continue;
    const segment = node.value.replace(/\s+/g, ' ').trim();
    if (!segment) continue;
    const separator = value ? ' ' : '';
    const remaining = limit - value.length - separator.length;
    if (segment.length > remaining) {
      value += separator + segment.slice(0, Math.max(remaining, 0));
      truncated = true;
      break;
    }
    value += separator + segment;
  }
  return { value, truncated };
}

function projectEvidence<T>(value: T | undefined): ProjectEvidence<T> {
  return value === undefined
    ? { status: 'confirmed-absent' }
    : { status: 'present', value };
}

function projectContextCategory(
  element: HtmlElement,
  text: BoundedText,
): ProjectContextCategory | undefined {
  const nativeHeading = /^h[1-6]$/.test(element.tagName);
  const ariaHeading =
    getAttribute(element, 'role')?.trim().toLowerCase().split(/\s+/)[0] ===
    'heading';
  if (nativeHeading || ariaHeading) return 'heading';
  const knownCategory = PROJECT_CONTEXT_TAGS.get(element.tagName);
  if (knownCategory) return knownCategory;
  return text.value ? 'text' : undefined;
}

function recordRefForElement(
  element: HtmlElement,
  state: MutableState,
  contextIdByElement: Map<HtmlElement, string>,
  documentId: string,
): ProjectRecordRef | undefined {
  const target = state.targetByElement.get(element);
  if (target) {
    return { documentId, recordType: 'target', id: target.id };
  }
  const evidence = state.evidenceByElement.get(element);
  if (evidence) {
    return { documentId, recordType: 'evidence', id: evidence.id };
  }
  const contextId = contextIdByElement.get(element);
  return contextId
    ? { documentId, recordType: 'context', id: contextId }
    : undefined;
}

function createProjectDocument(
  snapshot: ContextSnapshot,
  elements: HtmlElement[],
  state: MutableState,
  html: string,
  documentId: string,
  filePath: string,
): ProjectContextDocument {
  const contextRecords: ProjectContextRecord[] = [];
  const contextIdByElement = new Map<HtmlElement, string>();
  const omittedContextElements = new Set<HtmlElement>();

  for (const element of elements) {
    if (
      state.targetByElement.has(element) ||
      state.evidenceByElement.has(element) ||
      SKIPPED_TEXT_TAGS.has(element.tagName)
    ) {
      continue;
    }

    const knownCategory = PROJECT_CONTEXT_TAGS.get(element.tagName);
    const text = isInEditableRegion(element)
      ? { value: '', truncated: false }
      : knownCategory
        ? collectText(element.childNodes, MAX_TEXT_LENGTH)
        : collectDirectText(element.childNodes, MAX_TEXT_LENGTH);
    const category = projectContextCategory(element, text);
    if (!category) continue;
    if (contextRecords.length >= MAX_PROJECT_CONTEXT_RECORDS) {
      omittedContextElements.add(element);
      continue;
    }

    const id = `c-${contextRecords.length + 1}`;
    contextIdByElement.set(element, id);
    const attributes: ProjectContextRecord['attributes'] = {};
    const truncatedAttributes: string[] = [];
    const duplicateAttributes = state.duplicateAttributeElements.has(element);
    for (const name of PROJECT_CONTEXT_ATTRIBUTES) {
      const value = getAttribute(element, name);
      if (duplicateAttributes) {
        attributes[name] = {
          status: 'unknown',
          reason: 'A duplicate-attribute parser error affects this element.',
        };
      } else if (value !== undefined) {
        const isBoolean = ['hidden', 'disabled', 'required'].includes(name);
        const truncatedValue = !isBoolean && value.length > MAX_ATTRIBUTE_VALUE_LENGTH;
        if (truncatedValue) truncatedAttributes.push(name);
        attributes[name] = {
          status: 'present',
          value: isBoolean ? true : bounded(value).value,
          ...(truncatedValue ? { truncated: true } : {}),
        };
      } else {
        attributes[name] = { status: 'confirmed-absent' };
      }
    }
    const textEvidence: ProjectEvidence<BoundedText> = isInEditableRegion(element)
      ? {
          status: 'not-captured',
          reason: 'Editable-region text is intentionally excluded.',
        }
      : text.value
        ? {
            status: 'present',
            value: text,
            completeness: text.truncated ? 'partial' : 'complete',
            truncated: text.truncated,
          }
        : { status: 'confirmed-absent' };
    const rawAuthoredId = getAttribute(element, 'id');
    const rawRole = getAttribute(element, 'role');
    const truncated =
      text.truncated ||
      truncatedAttributes.length > 0;
    contextRecords.push({
      id,
      tagName: element.tagName,
      category,
      sourceLocator: sourceLocator(element, html),
      authoredId: duplicateAttributes
        ? {
            status: 'unknown',
            reason: 'A duplicate-attribute parser error affects this element.',
          }
        : rawAuthoredId === undefined
          ? { status: 'confirmed-absent' }
          : {
              status: 'present',
              value: bounded(rawAuthoredId).value,
              ...(rawAuthoredId.length > MAX_ATTRIBUTE_VALUE_LENGTH
                ? { truncated: true }
                : {}),
            },
      role: duplicateAttributes
        ? {
            status: 'unknown',
            reason: 'A duplicate-attribute parser error affects this element.',
          }
        : rawRole === undefined
          ? { status: 'confirmed-absent' }
          : {
              status: 'present',
              value: bounded(rawRole).value,
              ...(rawRole.length > MAX_ATTRIBUTE_VALUE_LENGTH
                ? { truncated: true }
                : {}),
            },
      text: textEvidence,
      attributes,
      truncatedAttributes,
      completeness: truncated ? 'partial' : 'complete',
    });
  }

  const recordRefs = new Map<HtmlElement, ProjectRecordRef>();
  for (const element of elements) {
    const ref = recordRefForElement(
      element,
      state,
      contextIdByElement,
      documentId,
    );
    if (ref) recordRefs.set(element, ref);
  }

  const relationships: ProjectRelationship[] = [];
  const addRelationship = (
    kind: ProjectRelationship['kind'],
    source: ProjectRecordRef,
    destination: ProjectRelationship['destination'],
    provenance: ProjectRelationship['provenance'],
  ): void => {
    relationships.push({
      id: `pr-${relationships.length + 1}`,
      kind,
      source,
      destination,
      provenance,
    });
  };

  for (const [element, childRef] of recordRefs) {
    let ancestor = parentElement(element);
    while (ancestor && !recordRefs.has(ancestor)) {
      ancestor = parentElement(ancestor);
    }
    const parentRef = ancestor ? recordRefs.get(ancestor) : undefined;
    if (parentRef) {
      addRelationship(
        'dom-parent-child',
        parentRef,
        { status: 'resolved', record: childRef },
        'html-structure',
      );
    }
  }

  for (const element of elements) {
    const ref = recordRefs.get(element);
    if (!ref) continue;

    if (element.tagName === 'figcaption') {
      let figure = parentElement(element);
      while (figure && figure.tagName !== 'figure') {
        figure = parentElement(figure);
      }
      const figureRef = figure ? recordRefs.get(figure) : undefined;
      if (figureRef) {
        addRelationship(
          'figure-caption',
          figureRef,
          { status: 'resolved', record: ref },
          'html-structure',
        );
      }
    }

    if (element.tagName === 'caption') {
      let table = parentElement(element);
      while (table && table.tagName !== 'table') table = parentElement(table);
      const tableRef = table ? recordRefs.get(table) : undefined;
      if (tableRef) {
        addRelationship(
          'table-caption',
          tableRef,
          { status: 'resolved', record: ref },
          'html-structure',
        );
      }
    }
  }

  for (const [element, target] of state.targetByElement) {
    const source = recordRefs.get(element);
    if (!source) continue;

    if (target.kind === 'heading' && target.headingLevel !== undefined) {
      const headingIndex = elements.indexOf(element);
      for (let index = headingIndex + 1; index < elements.length; index += 1) {
        const candidate = elements[index];
        if (!candidate) continue;
        const candidateTarget = state.targetByElement.get(candidate);
        if (candidateTarget?.kind === 'heading') {
          if (
            candidateTarget.headingLevel === undefined ||
            candidateTarget.headingLevel <= target.headingLevel
          ) {
            break;
          }
        }
        const destination = recordRefs.get(candidate);
        if (destination) {
          addRelationship(
            'heading-section-content',
            source,
            { status: 'resolved', record: destination },
            'html-structure',
          );
        }
      }
    }

    if (target.kind === 'form-control') {
      let current = parentElement(element);
      while (current && current.tagName !== 'fieldset') {
        current = parentElement(current);
      }
      const groupRef = current ? recordRefs.get(current) : undefined;
      if (groupRef) {
        addRelationship(
          'field-group',
          groupRef,
          { status: 'resolved', record: source },
          'native-html',
        );
      }
    }

    const parent = element.parentNode;
    if (parent && 'childNodes' in parent) {
      const siblings = parent.childNodes;
      const index = siblings.indexOf(element);
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const sibling = siblings[cursor];
        if (sibling && isElement(sibling)) {
          const destination = recordRefs.get(sibling);
          if (destination) {
            addRelationship(
              'adjacent-before',
              source,
              { status: 'resolved', record: destination },
              'html-structure',
            );
          }
          break;
        }
      }
      for (let cursor = index + 1; cursor < siblings.length; cursor += 1) {
        const sibling = siblings[cursor];
        if (sibling && isElement(sibling)) {
          const destination = recordRefs.get(sibling);
          if (destination) {
            addRelationship(
              'adjacent-after',
              source,
              { status: 'resolved', record: destination },
              'html-structure',
            );
          }
          break;
        }
      }
    }

    if (target.kind === 'form-control') {
      if (state.duplicateAttributeElements.size > 0) {
        addRelationship(
          'form-owner',
          source,
          {
            status: 'unknown',
            reason: 'A parser diagnostic may affect form owner attributes.',
          },
          'native-html',
        );
        continue;
      }
      const explicitFormId = getAttribute(element, 'form');
      let forms: HtmlElement[] = [];
      if (explicitFormId !== undefined) {
        forms = elements.filter(
          (candidate) =>
            candidate.tagName === 'form' &&
            getAttribute(candidate, 'id') === explicitFormId,
        );
      } else {
        let current = parentElement(element);
        while (current && current.tagName !== 'form') {
          current = parentElement(current);
        }
        if (current?.tagName === 'form') forms = [current];
      }
      const formRefs = forms
        .map((form) => recordRefs.get(form))
        .filter((ref): ref is ProjectRecordRef => ref !== undefined);
      addRelationship(
        'form-owner',
        source,
        formRefs.length === 1
          ? { status: 'resolved', record: formRefs[0]! }
          : formRefs.length > 1
            ? {
                status: 'ambiguous',
                reason: 'The authored form ID matches multiple forms.',
                candidates: formRefs,
              }
          : {
              status: 'unresolved',
              reason:
                explicitFormId !== undefined
                ? `No supplied form matches the authored form ID "${bounded(explicitFormId).value}".`
                  : 'No ancestor form is present in the parsed document.',
            },
        'native-html',
      );
    }
  }

  const refForSnapshotRecord = (
    record: ContextRecordRef,
  ): ProjectRecordRef => ({
    documentId,
    recordType: record.recordType,
    id: record.id,
  });
  for (const relationship of snapshot.relationships) {
    if (
      !('direction' in relationship) ||
      relationship.direction !== 'target-to-associated-record' ||
      (relationship.kind !== 'native-label' &&
        relationship.kind !== 'aria-labelledby' &&
        relationship.kind !== 'aria-describedby' &&
        relationship.kind !== 'aria-errormessage')
    ) {
      continue;
    }
    const source = refForSnapshotRecord(relationship.source);
    const kind =
      relationship.kind === 'native-label'
        ? 'native-label'
        : relationship.kind;
    const destination =
      relationship.destination.status === 'resolved'
        ? 'sourceResolution' in relationship &&
          relationship.sourceResolution?.status === 'ambiguous'
          ? {
              status: 'ambiguous' as const,
              reason: 'The label ID matches multiple labelable controls.',
              candidates: relationship.sourceResolution.candidates.map(
                (record) => ({ documentId, ...record }),
              ),
            }
          : {
              status: 'resolved' as const,
              record: refForSnapshotRecord(relationship.destination.record),
            }
        : relationship.destination.status === 'ambiguous'
          ? {
              status: 'ambiguous' as const,
              reason: `The authored reference matched ${relationship.destination.totalCandidateCount} records.`,
              candidates: relationship.destination.candidates.map(
                (record) => refForSnapshotRecord(record),
              ),
            }
        : relationship.destination.status === 'unknown'
          ? {
              status: 'unknown' as const,
              reason: 'The referenced ID is affected by parser uncertainty.',
            }
        : {
            status: 'unresolved' as const,
            reason: relationship.destination.reason,
          };
    addRelationship(
      kind,
      source,
      destination,
      relationship.kind === 'native-label' ? 'native-html' : 'aria-idref',
    );
  }

  const links: ProjectLinkReference[] = snapshot.targets
    .filter(
      (target) =>
        target.kind === 'link' ||
        (target.kind === 'custom-widget' &&
          target.basis.role === 'link'),
    )
    .map((target) => {
      const href =
        target.kind === 'link'
          ? target.attributes.href
          : target.kind === 'custom-widget'
            ? target.attributes.href ?? { status: 'absent' as const }
            : { status: 'absent' as const };
      const source: ProjectRecordRef = {
        documentId,
        recordType: 'target',
        id: target.id,
      };
      return {
        source,
        href:
          href.status === 'present' && !href.value.truncated
            ? projectEvidence(href.value.value)
            : href.status === 'present'
              ? {
                  status: 'omitted-incomplete',
                  reason: 'The authored href was truncated in Phase 3 V2.',
                }
            : href.status === 'absent'
              ? { status: 'confirmed-absent' }
              : href.status === 'unavailable'
                ? {
                    status: 'unknown',
                    reason: 'A parser diagnostic makes the authored href unavailable.',
                  }
              : {
                  status: 'omitted-incomplete',
                  reason: `The href attribute is ${href.status} in Phase 3 V2.`,
                },
        destination: { status: 'unknown', reason: 'Not resolved yet.' },
      };
    });
  const baseElement = elements.find(
    (element) => element.tagName === 'base' && hasAttribute(element, 'href'),
  );
  const baseHref: ProjectContextDocument['baseHref'] =
    baseElement && state.duplicateAttributeElements.has(baseElement)
      ? {
          status: 'unknown',
          reason: 'A duplicate-attribute parser error affects the base URL.',
        }
      : baseElement
        ? {
            status: 'present',
            value: bounded(getAttribute(baseElement, 'href') ?? '').value,
            ...(bounded(getAttribute(baseElement, 'href') ?? '').truncated
              ? { truncated: true }
              : {}),
          }
        : { status: 'confirmed-absent' };

  const contextRecordById = new Map(
    contextRecords.map((record) => [record.id, record]),
  );
  const descendantNameRecords = new Map<HtmlElement, ProjectRecordRef[]>();
  for (const element of elements) {
    let ancestor = parentElement(element);
    while (ancestor && !state.targetByElement.has(ancestor)) {
      ancestor = parentElement(ancestor);
    }
    if (!ancestor) continue;
    const ancestorTarget = state.targetByElement.get(ancestor);
    if (!ancestorTarget || ancestorTarget.text?.value) continue;
    const record = recordRefs.get(element);
    if (!record) continue;

    let hasNameContent = false;
    if (record.recordType === 'target') {
      const descendant = state.targetByElement.get(element);
      hasNameContent = Boolean(
        descendant?.text?.value ||
          (descendant?.kind === 'image' &&
            descendant.attributes.alt.status === 'present'),
      );
    } else if (record.recordType === 'evidence') {
      hasNameContent = Boolean(state.evidenceByElement.get(element)?.text?.value);
    } else {
      hasNameContent =
        contextRecordById.get(record.id)?.text.status === 'present';
    }
    if (!hasNameContent) continue;
    const records = descendantNameRecords.get(ancestor) ?? [];
    records.push(record);
    descendantNameRecords.set(ancestor, records);
  }

  const targetEvidence: ProjectTargetEvidence[] = snapshot.targets.map(
    (target) => {
      const targetRef: ProjectRecordRef = {
        documentId,
        recordType: 'target',
        id: target.id,
      };
      const targetElement = [...state.targetByElement.entries()].find(
        ([, candidate]) => candidate.id === target.id,
      )?.[0];
      const targetDomText: ProjectTargetEvidence['targetDomText'] =
        target.text?.value
          ? {
              status: 'present',
              value: target.text,
              completeness: target.text.truncated ? 'partial' : 'complete',
            }
          : target.kind === 'form-control' ||
              (targetElement !== undefined && isInEditableRegion(targetElement))
            ? {
                status: 'not-captured',
                reason:
                  target.kind === 'form-control'
                    ? 'Form-control values/text are not extracted as surrounding text.'
                    : 'Editable-region text is intentionally excluded.',
              }
            : { status: 'confirmed-absent' };
      const authoredNameInputs: AuthoredNameInput[] = [];
      const nameInputUncertainties: string[] = [];
      const parserAffected =
        targetElement !== undefined &&
        state.duplicateAttributeElements.has(targetElement);
      const ariaLabel = target.attributes.aria.values['aria-label'];
      if (ariaLabel?.status === 'present') {
        authoredNameInputs.push({
          source: 'aria-label',
          value: ariaLabel.value.value,
          truncated: ariaLabel.value.truncated,
        });
      } else if (ariaLabel?.status === 'invalid') {
        authoredNameInputs.push({
          source: 'aria-label',
          value: ariaLabel.raw.value,
        });
      } else if (ariaLabel?.status === 'unavailable') {
        nameInputUncertainties.push('The aria-label value is unavailable.');
      } else if (ariaLabel?.status === 'ambiguous') {
        nameInputUncertainties.push('The aria-label value is ambiguous.');
      }
      const labelledBy = target.attributes.aria.values['aria-labelledby'];
      if (labelledBy?.status === 'present') {
        let labelledByAmbiguous = false;
        const labelRelationships = snapshot.relationships
          .filter(
            (relationship) =>
              'direction' in relationship &&
              relationship.direction === 'target-to-associated-record' &&
              relationship.source.id === target.id
          )
          .filter((relationship) => relationship.kind === 'aria-labelledby');
        const refs = labelRelationships.flatMap((relationship) => {
          if (relationship.destination.status === 'resolved') {
            return [{ documentId, ...relationship.destination.record }];
          }
          if (relationship.destination.status === 'ambiguous') {
            labelledByAmbiguous = true;
            nameInputUncertainties.push(
              'One or more aria-labelledby references are ambiguous.',
            );
            return relationship.destination.candidates.map((record) => ({
              documentId,
              ...record,
            }));
          }
          nameInputUncertainties.push(
            'One or more aria-labelledby references could not be resolved completely.',
          );
          return [];
        });
        authoredNameInputs.push({
          source: 'aria-labelledby',
          value: labelledBy.value.value,
          truncated: labelledBy.value.truncated,
          referencedRecords: refs,
          ...(labelledByAmbiguous
            ? { certainty: 'ambiguous' as const }
            : {}),
        });
      } else if (labelledBy?.status === 'invalid') {
        authoredNameInputs.push({
          source: 'aria-labelledby',
          value: labelledBy.raw.value,
        });
      } else if (labelledBy?.status === 'unavailable') {
        nameInputUncertainties.push(
          'The aria-labelledby value is unavailable.',
        );
      } else if (labelledBy?.status === 'ambiguous') {
        nameInputUncertainties.push(
          'The aria-labelledby value is ambiguous.',
        );
      }

      const labelRelations = snapshot.relationships.filter(
        (relationship) =>
          'direction' in relationship &&
          relationship.direction === 'target-to-associated-record' &&
          relationship.source.id === target.id &&
          relationship.kind === 'native-label',
      );
      const labelRecords = labelRelations.flatMap((relationship) =>
        'direction' in relationship &&
        relationship.direction === 'target-to-associated-record' &&
        relationship.destination.status === 'resolved'
          ? [{ documentId, ...relationship.destination.record }]
          : [],
      );
      const ambiguousLabelRelation = labelRelations.some(
        (relationship) =>
          'sourceResolution' in relationship &&
          relationship.sourceResolution?.status === 'ambiguous',
      );
      const ambiguousLabelCandidates = labelRelations.flatMap((relationship) =>
        'sourceResolution' in relationship &&
        relationship.sourceResolution?.status === 'ambiguous'
          ? relationship.sourceResolution.candidates.map((record) => ({
              documentId,
              ...record,
            }))
          : [],
      );
      if (labelRecords.length) {
        authoredNameInputs.push({
          source: 'native-label',
          referencedRecords: labelRecords,
          ...(ambiguousLabelRelation ? { certainty: 'ambiguous' as const } : {}),
        });
      }
      if (ambiguousLabelRelation) {
        nameInputUncertainties.push(
          'A native label may be associated with multiple controls because of duplicate IDs.',
        );
      }
      const visibleText = target.text?.value;
      if (visibleText) {
        authoredNameInputs.push({
          source: 'text-content',
          value: visibleText,
          truncated: target.text?.truncated ?? false,
        });
      }
      if (!target.text?.value && targetElement) {
        const descendantRecords =
          descendantNameRecords.get(targetElement) ?? [];
        if (descendantRecords.length) {
          authoredNameInputs.push({
            source: 'descendant-content',
            referencedRecords: descendantRecords,
          });
        }
      }
      if (target.kind === 'image' && target.attributes.alt.status === 'present') {
        authoredNameInputs.push({
          source: 'alt',
          value: target.attributes.alt.value.value,
          truncated: target.attributes.alt.value.truncated,
        });
      }
      if (target.attributes.title.status === 'present') {
        authoredNameInputs.push({
          source: 'title',
          value: target.attributes.title.value.value,
          truncated: target.attributes.title.value.truncated,
        });
      }
      if (
        target.kind === 'button' &&
        target.attributes.value?.status === 'present'
      ) {
        authoredNameInputs.push({
          source: 'value-attribute',
          value: target.attributes.value.value.value,
          truncated: target.attributes.value.value.truncated,
        });
      }
      if (
        target.kind === 'form-control' &&
        target.attributes.placeholder?.status === 'present'
      ) {
        authoredNameInputs.push({
          source: 'placeholder',
          value: target.attributes.placeholder.value.value,
          truncated: target.attributes.placeholder.value.truncated,
        });
      }
      if (parserAffected) {
        nameInputUncertainties.push(
          'A duplicate-attribute parser error makes authored attributes uncertain.',
        );
      }

      const contextRefs = relationships
        .filter(
          (relationship) =>
            relationship.destination.status === 'resolved' &&
            relationship.destination.record.documentId === documentId &&
            relationship.destination.record.id === target.id &&
            relationship.source.recordType === 'context',
        )
        .map((relationship) => relationship.source);
      const contextAncestorIds = new Set(contextRefs.map((record) => record.id));
      const headingRefs = relationships
        .filter(
          (relationship) =>
            relationship.kind === 'heading-section-content' &&
            relationship.destination.status === 'resolved' &&
            relationship.destination.record.recordType === 'target' &&
            relationship.destination.record.id === target.id &&
            relationship.source.recordType === 'target',
        )
        .map((relationship) => relationship.source);
      const associatedStructuralRefs = relationships
        .filter(
          (relationship) =>
            relationship.source.recordType === 'context' &&
            contextAncestorIds.has(relationship.source.id) &&
            [
              'figure-caption',
              'table-caption',
              'heading-section-content',
            ].includes(relationship.kind) &&
            relationship.destination.status === 'resolved' &&
            relationship.destination.record.documentId === documentId,
        )
        .flatMap((relationship) =>
          relationship.destination.status === 'resolved'
            ? [relationship.destination.record]
            : [],
        );
      const adjacentRefs = relationships
        .filter(
          (relationship) =>
            relationship.source.recordType === 'target' &&
            relationship.source.id === target.id &&
            (relationship.kind === 'adjacent-before' ||
              relationship.kind === 'adjacent-after') &&
            relationship.destination.status === 'resolved' &&
            relationship.destination.record.recordType === 'context',
        )
        .flatMap((relationship) =>
          relationship.destination.status === 'resolved' &&
          relationship.destination.record.recordType === 'context'
            ? [relationship.destination.record]
            : [],
        );
      const surroundingRecords = [
        ...new Map(
          [...contextRefs, ...adjacentRefs, ...headingRefs].map((record) => [
            record.id,
            record,
          ]),
        ).values(),
      ];
      for (const record of associatedStructuralRefs) {
        if (!surroundingRecords.some((existing) => existing.id === record.id)) {
          surroundingRecords.push(record);
        }
      }
      const associationIncomplete =
        omittedContextElements.size > 0 ||
        snapshot.completeness.status === 'partial' ||
        state.duplicateAttributeElements.size > 0;
      const nativeLabels: ProjectTargetEvidence['nativeLabels'] =
        parserAffected
          ? {
              status: 'unknown',
              reason: 'A parser diagnostic affects attributes on this target.',
            }
          : ambiguousLabelRelation
          ? {
              status: 'ambiguous',
              reason: 'Duplicate authored IDs make the native-label association ambiguous.',
              candidates: ambiguousLabelCandidates,
            }
          : labelRecords.length
          ? {
              status: 'present',
              value: labelRecords,
              completeness: associationIncomplete ? 'partial' : 'complete',
            }
          : associationIncomplete
            ? {
                status: 'omitted-incomplete',
                reason: 'Extraction limits may have omitted label evidence.',
              }
            : { status: 'confirmed-absent' };
      const surroundingDomText: ProjectTargetEvidence['surroundingDomText'] =
        surroundingRecords.length
          ? {
              status: 'present',
              value: surroundingRecords,
              completeness: associationIncomplete ? 'partial' : 'complete',
            }
          : associationIncomplete
            ? {
                status: 'omitted-incomplete',
                reason: 'Extraction limits may have omitted surrounding DOM context.',
              }
            : contextRecords.some((record) => record.text.status === 'present') ||
                snapshot.targets.some(
                  (other) =>
                    other.id !== target.id && Boolean(other.text?.value),
                ) ||
                snapshot.evidence.some((record) => Boolean(record.text?.value))
              ? {
                  status: 'unknown',
                  reason: 'Text exists in the document but no reliable structural association to this target was established.',
                }
              : { status: 'confirmed-absent' };

      return {
        target: targetRef,
        targetDomText,
        authoredNameInputs:
          authoredNameInputs.length > 0
            ? {
                status: 'present',
                value: authoredNameInputs,
                completeness:
                  associationIncomplete || nameInputUncertainties.length
                    ? 'partial'
                    : 'complete',
                ...(nameInputUncertainties.length
                  ? { uncertainties: nameInputUncertainties }
                  : {}),
              }
            : ambiguousLabelRelation
              ? {
                  status: 'ambiguous',
                  reason: 'Authored native-label text exists but its target association is ambiguous.',
                  candidates: ambiguousLabelCandidates,
                }
            : parserAffected
              ? {
                  status: 'unknown',
                  reason: 'A duplicate-attribute parser error prevents confirming authored naming inputs.',
                }
            : associationIncomplete
              ? {
                  status: 'omitted-incomplete',
                  reason: 'Extraction limits may have omitted authored naming inputs.',
                }
              : { status: 'confirmed-absent' },
        nativeLabels,
        surroundingDomText,
        computedAccessibleName: {
          status: 'not-captured',
          reason: 'Static HTML extraction does not compute browser accessible names.',
        },
        renderedVisibleText: {
          status: 'not-captured',
          reason: 'Static HTML extraction does not determine rendered visibility.',
        },
        actionBehavior: {
          status: 'not-captured',
          reason: 'Static HTML extraction does not execute or inspect handlers.',
        },
      };
    },
  );
  const partialRecordIds = contextRecords
    .filter((record) => record.completeness === 'partial')
    .map((record) => record.id);
  for (const record of [...snapshot.targets, ...snapshot.evidence]) {
    if (
      record.completeness.status === 'partial' &&
      !partialRecordIds.includes(record.id)
    ) {
      partialRecordIds.push(record.id);
    }
  }
  for (const element of state.duplicateAttributeElements) {
    const ref = recordRefs.get(element);
    if (ref && !partialRecordIds.includes(ref.id)) partialRecordIds.push(ref.id);
  }
  const parserDiagnostics = state.parserDiagnostics.map((error) => {
    const affectsExtraction =
      error.code !== ErrorCodes.missingDoctype &&
      error.code !== ErrorCodes.nonConformingDoctype;
    const affectedElements = affectsExtraction
      ? elements.filter((element) => {
          const location = element.sourceCodeLocation?.startTag;
          return (
            location != null &&
            error.startOffset >= location.startOffset &&
            error.startOffset <= location.endOffset
          );
        })
      : [];
    const affectedRecords = affectedElements.flatMap((element) => {
      const ref = recordRefs.get(element);
      return ref ? [ref] : [];
    });
    return {
      code: error.code,
      startOffset: error.startOffset,
      endOffset: error.endOffset,
      affectsExtraction,
      affectedRecords,
    };
  });
  const contextCompletenessPartial =
    omittedContextElements.size > 0 ||
    partialRecordIds.length > 0 ||
    snapshot.completeness.status === 'partial';
  const contextPartial =
    contextCompletenessPartial;
  return {
    documentId,
    filePath,
    snapshot,
    contextRecords,
    targetEvidence,
    relationships,
    links,
    baseHref,
    ...(baseElement
      ? { baseHrefSourceLocator: sourceLocator(baseElement, html) }
      : {}),
    parserDiagnostics,
    contextCompleteness: {
      status: contextCompletenessPartial ? 'partial' : 'complete',
      omittedRecordCount: omittedContextElements.size,
      partialRecordIds,
    },
    evidenceAvailability: {
      surroundingText: contextPartial ? 'omitted-incomplete' : 'present',
      computedAccessibleName: 'not-captured',
      renderedVisibility: 'not-captured',
      actionBehavior: 'not-captured',
      imagePixels: 'not-captured',
      routeAndComponentIdentity: 'not-captured',
    },
  };
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
  duplicateAttributeElements: Set<HtmlElement>;
  parserDiagnostics: ParserError[];
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
  if (state.duplicateAttributeElements.has(element)) {
    const unavailable = () =>
      ({ status: 'unavailable', reason: 'parser-normalized-duplicate' }) as const;
    if (evidence.attributes) {
      evidence.attributes.authoredId = unavailable();
      evidence.attributes.role = unavailable();
      evidence.attributes.aria = {
        values: Object.fromEntries(
          ARIA_ATTRIBUTE_NAMES.map((name) => [name, unavailable()]),
        ) as AriaAttributes,
        truncated: false,
      };
    }
    evidence.completeness = {
      status: 'partial',
      truncations: ['parser-diagnostic'],
    };
    noteTruncation(state, {
      scope: 'evidence',
      limit: 'parser-diagnostic',
      recordId: id,
    });
  }
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
  attribute:
    | 'for'
    | 'aria-labelledby'
    | 'aria-describedby'
    | 'aria-errormessage',
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
  attribute:
    | 'for'
    | 'aria-labelledby'
    | 'aria-describedby'
    | 'aria-errormessage',
  matches: HtmlElement[],
  state: MutableState,
  html: string,
): {
  destination: RelationshipDestination;
  partial: boolean;
} {
  if (state.duplicateAttributeElements.size > 0) {
    return {
      destination: {
        status: 'unknown',
        authoredId: bounded(id),
        attribute,
        reason: 'parser-diagnostic',
      },
      partial: true,
    };
  }
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
  for (const attribute of [
    'aria-labelledby',
    'aria-describedby',
    'aria-errormessage',
  ] as const) {
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
  const labels = elements.filter(
    (element) =>
      element.tagName === 'label' &&
      !state.duplicateAttributeElements.has(element),
  );
  for (const label of labels) {
    const forId = getAttribute(label, 'for');
    if (forId !== undefined && state.duplicateAttributeElements.size > 0) {
      continue;
    }
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

function extractHtmlContextV2Internal(html: string): {
  snapshot: ContextSnapshot;
  elements: HtmlElement[];
  state: MutableState;
} {
  const parserDiagnostics: ParserError[] = [];
  const parsedDocument = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parserDiagnostics.push(error),
  });
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

  const duplicateAttributeErrors = parserDiagnostics.filter(
    (error) => error.code === ErrorCodes.duplicateAttribute,
  );
  const duplicateAttributeElements = new Set(
    elements.filter((element) => {
      const startTag = element.sourceCodeLocation?.startTag;
      return (
        startTag !== undefined &&
        duplicateAttributeErrors.some(
          (error) =>
            error.startOffset >= startTag.startOffset &&
            error.startOffset <= startTag.endOffset,
        )
      );
    }),
  );
  const allElementsById = new Map<string, HtmlElement[]>();
  for (const element of elements) {
    if (duplicateAttributeElements.has(element)) continue;
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
    duplicateAttributeElements,
    parserDiagnostics,
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
    if (duplicateAttributeElements.has(element)) {
      markTargetAttributesUnavailable(target);
      noteTruncation(state, {
        scope: 'target',
        limit: 'parser-diagnostic',
        recordId: id,
      });
    }
    state.targets.push(target);
    state.targetByElement.set(element, target);
    state.recordIdByElement.set(element, { recordType: 'target', id });
    const attributeTruncated = [
      target.attributes.authoredId,
      target.attributes.role,
      target.attributes.title,
      ...Object.values(target.attributes.aria.values),
      ...('alt' in target.attributes ? [target.attributes.alt] : []),
      ...('src' in target.attributes ? [target.attributes.src] : []),
      ...('href' in target.attributes ? [target.attributes.href] : []),
      ...('inputType' in target.attributes && target.attributes.inputType
        ? [target.attributes.inputType]
        : []),
      ...('name' in target.attributes ? [target.attributes.name] : []),
      ...('placeholder' in target.attributes
        ? [target.attributes.placeholder]
        : []),
      ...('autoComplete' in target.attributes && target.attributes.autoComplete
        ? [target.attributes.autoComplete]
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
    if (state.duplicateAttributeElements.has(element)) {
      targetTruncations.push('parser-diagnostic');
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
              : truncation === 'parser-diagnostic'
                ? 'parser-diagnostic'
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
    if (state.duplicateAttributeElements.has(element)) continue;
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
  const unknownCount = state.relationships.filter(
    (relationship) =>
      'destination' in relationship &&
      relationship.destination.status === 'unknown',
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
  for (const error of state.parserDiagnostics) {
    if (
      error.code === ErrorCodes.missingDoctype ||
      error.code === ErrorCodes.nonConformingDoctype
    ) {
      continue;
    }
    noteTruncation(state, {
      scope: 'snapshot',
      limit: 'parser-diagnostic',
      recordId: `${error.code}@${error.startOffset}`,
    });
  }
  const completeness: ContextCompleteness =
    state.truncations.length === 0
      ? {
          status: 'complete',
          truncations: [],
          policyOmissions,
          relationshipResolution: { unresolvedCount, ambiguousCount, unknownCount },
        }
      : {
          status: 'partial',
          truncations: state.truncations as [
            ExtractionTruncation,
            ...ExtractionTruncation[],
          ],
          policyOmissions,
          relationshipResolution: {
            unresolvedCount,
            ambiguousCount,
            ...(unknownCount ? { unknownCount } : {}),
          },
        };

  const snapshot: ContextSnapshot = {
    schemaVersion: CONTEXT_SCHEMA_V2,
    document: documentContextValue,
    targets: state.targets,
    evidence: state.evidence,
    relationships: state.relationships,
    parserDiagnostics: parserDiagnostics.map((error) => ({
      code: error.code,
      startOffset: error.startOffset,
      endOffset: error.endOffset,
    })),
    completeness,
  };
  return { snapshot, elements, state };
}

export function extractHtmlContextV2(html: string): ContextSnapshot {
  return extractHtmlContextV2Internal(html).snapshot;
}

export function extractHtmlContextDocumentV2(
  html: string,
  documentId: string,
  filePath: string,
): ProjectContextDocument {
  const extracted = extractHtmlContextV2Internal(html);
  return createProjectDocument(
    extracted.snapshot,
    extracted.elements,
    extracted.state,
    html,
    documentId,
    filePath,
  );
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
