/**
 * React source extractor — parses a single .jsx/.tsx file using @babel/parser
 * and extracts bounded, traceable accessibility-relevant evidence.
 *
 * Rules:
 * - Never evaluates, executes, imports, or runs the uploaded file.
 * - Uses AST-only parsing; no regex JSX parsing.
 * - Marks dynamic/unresolvable values explicitly.
 * - Applies strict size/element bounds.
 * - Treats uploaded source as untrusted data, not instructions.
 */

import { parse } from '@babel/parser';
import type {
  File,
  Node,
  JSXElement,
  JSXOpeningElement,
  JSXAttribute,
  JSXSpreadAttribute,
  JSXIdentifier,
  JSXMemberExpression,
  JSXNamespacedName,
  JSXExpressionContainer,
  StringLiteral,
  JSXText,
  JSXFragment,
} from '@babel/types';
import type {
  PropAvailability,
  ReactAncestorContext,
  ReactButtonTarget,
  ReactCustomWidgetTarget,
  ReactFormControlTarget,
  ReactHeadingTarget,
  ReactIdReference,
  ReactImageTarget,
  ReactLabelRecord,
  ReactLinkTarget,
  ReactLiteralChildren,
  ReactParseError,
  ReactCompletenessReason,
  ReactSnapshotCompleteness,
  ReactSourceExtractionResult,
  ReactSourceLocation,
  ReactSourceSnapshot,
  ReactTarget,
  ReactTextContentTarget,
} from '../types/reactSource.js';
import { REACT_SOURCE_SCHEMA_VERSION } from '../types/reactSource.js';

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 512_000; // 500 KB
const MAX_FILENAME_LENGTH = 255;
const MAX_ELEMENTS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_ATTRIBUTE_VALUE_LENGTH = 250;
const MAX_SOURCE_EXCERPT_LENGTH = 500;
const MAX_ANCESTORS = 4;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): { value: string; truncated: boolean } {
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max), truncated: true };
}

function getJsxName(
  nameNode: JSXIdentifier | JSXMemberExpression | JSXNamespacedName,
): string {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') {
    return `${getJsxName(nameNode.object)}.${nameNode.property.name}`;
  }
  // JSXNamespacedName
  return `${nameNode.namespace.name}:${nameNode.name.name}`;
}

function sourceLocFromNode(
  node: Node,
  filename: string,
): ReactSourceLocation {
  const loc = node.loc;
  const start = node.start ?? 0;
  const end = node.end ?? start;
  return {
    file: filename,
    startLine: loc?.start.line ?? 0,
    startColumn: loc?.start.column ?? 0,
    endLine: loc?.end.line ?? 0,
    endColumn: loc?.end.column ?? 0,
    startOffset: start,
    endOffset: end,
  };
}

function extractSourceExcerpt(
  source: string,
  startOffset: number,
  endOffset: number,
): { excerpt: string; truncated: boolean } {
  const raw = source.slice(startOffset, endOffset);
  const { value, truncated } = truncate(raw, MAX_SOURCE_EXCERPT_LENGTH);
  return { excerpt: value, truncated };
}

// ---------------------------------------------------------------------------
// Attribute extraction
// ---------------------------------------------------------------------------

function getAttributeName(attr: JSXAttribute): string {
  return attr.name.type === 'JSXIdentifier'
    ? attr.name.name
    : `${attr.name.namespace.name}:${attr.name.name.name}`;
}

function hasPropSpread(opening: JSXOpeningElement): boolean {
  return opening.attributes.some((a) => a.type === 'JSXSpreadAttribute');
}

function attrToAvailability(attr: JSXAttribute | undefined): PropAvailability {
  if (!attr) return { status: 'absent' };
  const value = attr.value;
  if (value === null || value === undefined) {
    // Boolean attribute with no value: treat as present with empty string
    return { status: 'present', value: '', truncated: false };
  }
  if (value.type === 'StringLiteral') {
    const { value: v, truncated } = truncate(value.value, MAX_ATTRIBUTE_VALUE_LENGTH);
    return { status: 'present', value: v, truncated };
  }
  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression;
    if (expr.type === 'StringLiteral') {
      const { value: v, truncated } = truncate(expr.value, MAX_ATTRIBUTE_VALUE_LENGTH);
      return { status: 'present', value: v, truncated };
    }
    if (expr.type === 'BooleanLiteral') {
      return { status: 'present', value: String(expr.value), truncated: false };
    }
    if (expr.type === 'JSXEmptyExpression') {
      return { status: 'absent' };
    }
    // Any other expression is dynamic
    return {
      status: 'dynamic',
      reason:
        expr.type === 'Identifier'
          ? 'identifier'
          : expr.type === 'ConditionalExpression'
            ? 'conditional'
            : expr.type === 'CallExpression'
              ? 'function-call'
              : 'expression',
    };
  }
  return { status: 'dynamic', reason: 'unknown' };
}

function booleanAttrToAvailability(attr: JSXAttribute | undefined): PropAvailability {
  if (!attr) return { status: 'absent' };
  if (attr.value?.type === 'JSXExpressionContainer' &&
      attr.value.expression.type === 'BooleanLiteral') {
    return attr.value.expression.value
      ? { status: 'present', value: 'true', truncated: false }
      : { status: 'absent' };
  }
  if (attr.value?.type === 'JSXExpressionContainer') {
    return { status: 'dynamic', reason: 'expression' };
  }
  return { status: 'present', value: 'true', truncated: false };
}

function getPropAvailability(
  opening: JSXOpeningElement,
  name: string,
  boolean = false,
): PropAvailability {
  let availability: PropAvailability = { status: 'absent' };
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      availability = { status: 'dynamic', reason: 'spread' };
    } else if (getAttributeName(attr) === name) {
      availability = boolean
        ? booleanAttrToAvailability(attr)
        : attrToAvailability(attr);
    }
  }
  return availability;
}

// ---------------------------------------------------------------------------
// Children text extraction
// ---------------------------------------------------------------------------

function extractLiteralChildren(
  children: JSXElement['children'],
): ReactLiteralChildren | undefined {
  let text = '';
  let hasDynamic = false;
  for (const child of children) {
    if (child.type === 'JSXText') {
      const normalized = child.value.replace(/\s+/g, ' ');
      text += normalized;
    } else if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'StringLiteral') {
        text += child.expression.value;
      } else if (child.expression.type !== 'JSXEmptyExpression') {
        hasDynamic = true;
      }
    } else if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
      // Recurse into nested JSX children
      const nested = extractLiteralChildren(
        child.type === 'JSXFragment' ? child.children : child.children,
      );
      if (nested) {
        text += nested.text;
        if (nested.hasDynamicChildren) hasDynamic = true;
      }
    }
  }
  const trimmed = text.trim();
  if (!trimmed && !hasDynamic) return undefined;
  const { value, truncated } = truncate(trimmed, MAX_TEXT_LENGTH);
  return { text: value, truncated, hasDynamicChildren: hasDynamic };
}

// ---------------------------------------------------------------------------
// ID registry for reference resolution
// ---------------------------------------------------------------------------

interface IdRegistryEntry {
  id: string;
  recordId: string;
  tagName: string;
  loc: ReactSourceLocation;
  text?: ReactLiteralChildren;
}

type IdRegistry = Map<string, IdRegistryEntry[]>;

function resolveMultiIdRef(
  idValue: PropAvailability,
  registry: IdRegistry,
): ReactIdReference | undefined {
  if (idValue.status !== 'present') {
    if (idValue.status === 'dynamic') return { status: 'dynamic' };
    return undefined;
  }
  if (idValue.truncated) {
    return { status: 'unresolved', reason: 'truncated' };
  }
  const tokens = idValue.value.trim().split(/\s+/);
  if (!tokens[0]) return undefined;
  const resolvedEntries: IdRegistryEntry[] = [];
  for (const token of tokens) {
    const entries = registry.get(token);
    if (!entries) return { status: 'unresolved', reason: 'not-found' };
    if (entries.length > 1) return { status: 'unresolved', reason: 'duplicate' };
    resolvedEntries.push(entries[0]!);
  }
  const first = resolvedEntries[0]!;
  return {
    status: 'resolved',
    targetId: first.id,
    targetRecordId: first.recordId,
    targets: resolvedEntries.map((entry) => ({
      targetId: entry.id,
      targetRecordId: entry.recordId,
      tagName: entry.tagName,
      loc: entry.loc,
      ...(entry.text ? { text: entry.text } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Ancestor context collection
// ---------------------------------------------------------------------------

function buildAncestorContext(
  ancestorStack: Array<{
    tagName: string;
    role?: string;
    literalChildren?: ReactLiteralChildren;
    loc: ReactSourceLocation;
    recordId: string;
  }>,
): ReactAncestorContext[] {
  return ancestorStack.slice(-MAX_ANCESTORS).reverse().map((a) => ({
    recordId: a.recordId,
    tagName: a.tagName,
    ...(a.role ? { role: a.role } : {}),
    ...(a.literalChildren ? { literalChildren: a.literalChildren } : {}),
    loc: a.loc,
  }));
}

// ---------------------------------------------------------------------------
// Heading detection
// ---------------------------------------------------------------------------

function getHeadingLevel(tagName: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const match = /^h([1-6])$/i.exec(tagName);
  if (!match) return null;
  return parseInt(match[1]!, 10) as 1 | 2 | 3 | 4 | 5 | 6;
}

// ---------------------------------------------------------------------------
// Known custom widget ARIA roles
// ---------------------------------------------------------------------------

const CUSTOM_WIDGET_ROLES = new Set([
  'dialog', 'alertdialog',
  'button', 'link', 'checkbox', 'radio', 'switch', 'slider',
  'textbox', 'combobox', 'listbox', 'searchbox', 'spinbutton',
  'tab', 'tabpanel', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'treeitem',
]);

// ---------------------------------------------------------------------------
// Main traversal
// ---------------------------------------------------------------------------

interface ExtractorState {
  filename: string;
  source: string;
  targets: ReactTarget[];
  labels: ReactLabelRecord[];
  idRegistry: IdRegistry;
  idCounter: number;
  elementCount: number;
  limitReached: boolean;
  textTruncated: boolean;
  attributeTruncated: boolean;
  sourceExcerptTruncated: boolean;
  componentStack: string[];
  ancestorStack: Array<{
    tagName: string;
    role?: string;
    literalChildren?: ReactLiteralChildren;
    loc: ReactSourceLocation;
    recordId: string;
  }>;
}

function nextId(state: ExtractorState): string {
  state.idCounter += 1;
  return `rs-${state.idCounter}`;
}

function isTruncatedAvailability(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'present' &&
    'truncated' in value &&
    value.truncated === true
  );
}

function addTarget(state: ExtractorState, target: ReactTarget): void {
  addTarget(state, target);
  if (Object.values(target).some(isTruncatedAvailability)) {
    state.attributeTruncated = true;
  }
}

function getAriaProps(opening: JSXOpeningElement) {
  return {
    ariaLabel: getPropAvailability(opening, 'aria-label'),
    ariaLabelledby: getPropAvailability(opening, 'aria-labelledby'),
    ariaDescribedby: getPropAvailability(opening, 'aria-describedby'),
    ariaErrormessage: getPropAvailability(opening, 'aria-errormessage'),
    ariaHidden: getPropAvailability(opening, 'aria-hidden'),
    ariaInvalid: getPropAvailability(opening, 'aria-invalid'),
    ariaLive: getPropAvailability(opening, 'aria-live'),
    role: getPropAvailability(opening, 'role'),
    idProp: getPropAvailability(opening, 'id'),
    title: getPropAvailability(opening, 'title'),
  };
}

function traverseNode(node: Node, state: ExtractorState): void {
  if (state.limitReached) return;

  if (node.type === 'JSXElement') {
    traverseJsxElement(node as JSXElement, state);
  } else if (node.type === 'JSXFragment') {
    const frag = node as JSXFragment;
    for (const child of frag.children) {
      traverseNode(child, state);
    }
  } else if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  ) {
    const name = node.id?.name;
    if (name) state.componentStack.push(name);
    traverseNodeChildren(node, state);
    if (name) state.componentStack.pop();
  } else if (
    node.type === 'VariableDeclarator' &&
    node.id.type === 'Identifier' &&
    node.init &&
    (node.init.type === 'ArrowFunctionExpression' ||
      node.init.type === 'FunctionExpression')
  ) {
    state.componentStack.push(node.id.name);
    traverseNode(node.init, state);
    state.componentStack.pop();
  } else if (node.type === 'ClassDeclaration') {
    const name = node.id?.name;
    if (name) state.componentStack.push(name);
    traverseNodeChildren(node, state);
    if (name) state.componentStack.pop();
  } else {
    traverseNodeChildren(node, state);
  }
}

function traverseNodeChildren(node: Node, state: ExtractorState): void {
  for (const key of Object.keys(node)) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            traverseNode(item as Node, state);
          }
        }
      } else if ('type' in (child as object)) {
        traverseNode(child as Node, state);
      }
    }
  }
}

function traverseJsxElement(el: JSXElement, state: ExtractorState): void {
  if (state.limitReached) return;
  if (state.elementCount >= MAX_ELEMENTS) {
    state.limitReached = true;
    return;
  }

  const opening = el.openingElement;
  const rawTagName = getJsxName(opening.name);
  // Only process known lowercase (native HTML) elements
  const tagName = rawTagName;
  const isNativeElement = /^[a-z][a-z0-9-]*$/.test(rawTagName);

  state.elementCount += 1;
  const recordId = nextId(state);
  const loc = sourceLocFromNode(el, state.filename);
  const sourceExcerpt = extractSourceExcerpt(state.source, el.start ?? 0, el.end ?? 0);
  if (sourceExcerpt.truncated) state.sourceExcerptTruncated = true;
  const literalChildren = extractLiteralChildren(el.children);
  if (literalChildren?.truncated) state.textTruncated = true;

  if (isNativeElement) {
    const ariaProps = getAriaProps(opening);
    const spread = hasPropSpread(opening);
    const ancestors = buildAncestorContext(state.ancestorStack);

    // Register id for reference resolution
    if (
      ariaProps.idProp.status === 'present' &&
      !ariaProps.idProp.truncated &&
      ariaProps.idProp.value
    ) {
      const entries = state.idRegistry.get(ariaProps.idProp.value) ?? [];
      entries.push({
        id: ariaProps.idProp.value,
        recordId,
        tagName,
        loc,
        ...(literalChildren ? { text: literalChildren } : {}),
      });
      state.idRegistry.set(ariaProps.idProp.value, entries);
    }

    const base = {
      id: recordId,
      tagName,
      loc,
      literalChildren: literalChildren ?? undefined,
      ancestors,
      hasPropSpread: spread,
      ...(state.componentStack.length > 0
        ? { componentName: state.componentStack[state.componentStack.length - 1] }
        : {}),
      className: getPropAvailability(opening, 'className'),
      sourceExcerpt: sourceExcerpt.excerpt,
      sourceExcerptTruncated: sourceExcerpt.truncated,
      ...ariaProps,
    };

    // ---- Image ----
    const typeProp = getPropAvailability(opening, 'type');
    if (tagName === 'img' || (tagName === 'input' && typeProp.status === 'present' && typeProp.value.toLowerCase() === 'image')) {
      const target: ReactImageTarget = {
        ...base,
        kind: 'image',
        alt: getPropAvailability(opening, 'alt'),
        src: getPropAvailability(opening, 'src'),
      };
      addTarget(state, target);
    }
    // ---- Button ----
    else if (tagName === 'button') {
      const target: ReactButtonTarget = {
        ...base,
        kind: 'button',
        buttonType: typeProp,
        disabled: getPropAvailability(opening, 'disabled', true),
        ariaPressed: getPropAvailability(opening, 'aria-pressed'),
        ariaExpanded: getPropAvailability(opening, 'aria-expanded'),
        ariaDisabled: getPropAvailability(opening, 'aria-disabled'),
      };
      addTarget(state, target);
    }
    // ---- Input (button types) ----
    else if (tagName === 'input') {
      const typeVal = typeProp.status === 'present' ? typeProp.value.toLowerCase() : '';
      if (typeVal === 'button' || typeVal === 'submit' || typeVal === 'reset') {
        const target: ReactButtonTarget = {
          ...base,
          kind: 'button',
          buttonType: typeProp,
          disabled: getPropAvailability(opening, 'disabled', true),
          ariaPressed: getPropAvailability(opening, 'aria-pressed'),
          ariaExpanded: getPropAvailability(opening, 'aria-expanded'),
          ariaDisabled: getPropAvailability(opening, 'aria-disabled'),
        };
        addTarget(state, target);
      } else {
        const target: ReactFormControlTarget = {
          ...base,
          kind: 'form-control',
          inputType: typeProp,
          placeholder: getPropAvailability(opening, 'placeholder'),
          name: getPropAvailability(opening, 'name'),
          required: getPropAvailability(opening, 'required', true),
          disabled: getPropAvailability(opening, 'disabled', true),
          autoComplete: getPropAvailability(opening, 'autoComplete'),
        };
        addTarget(state, target);
      }
    }
    // ---- Select / Textarea ----
    else if (tagName === 'select' || tagName === 'textarea') {
      const target: ReactFormControlTarget = {
        ...base,
        kind: 'form-control',
        inputType: { status: 'present', value: tagName, truncated: false },
        placeholder: getPropAvailability(opening, 'placeholder'),
        name: getPropAvailability(opening, 'name'),
        required: getPropAvailability(opening, 'required', true),
        disabled: getPropAvailability(opening, 'disabled', true),
        autoComplete: getPropAvailability(opening, 'autoComplete'),
      };
      addTarget(state, target);
    }
    // ---- Link ----
    else if (tagName === 'a') {
      const target: ReactLinkTarget = {
        ...base,
        kind: 'link',
        href: getPropAvailability(opening, 'href'),
      };
      addTarget(state, target);
    }
    // ---- Label (tracked separately for htmlFor resolution) ----
    else if (tagName === 'label') {
      const htmlFor = getPropAvailability(opening, 'htmlFor');
      if (isTruncatedAvailability(htmlFor)) state.attributeTruncated = true;
      const label: ReactLabelRecord = {
        id: recordId,
        tagName: 'label',
        loc,
        htmlFor,
        literalChildren: literalChildren ?? undefined,
      };
      state.labels.push(label);
    }
    // ---- Headings ----
    else {
      const level = getHeadingLevel(tagName);
      if (level !== null) {
        const target: ReactHeadingTarget = {
          ...base,
          kind: 'heading',
          headingLevel: level,
        };
        addTarget(state, target);
      }
      // ---- Custom widget via role ----
      else if (ariaProps.role.status === 'present' && CUSTOM_WIDGET_ROLES.has(ariaProps.role.value)) {
        const target: ReactCustomWidgetTarget = {
          ...base,
          kind: 'custom-widget',
          resolvedRole: ariaProps.role.value,
        };
        addTarget(state, target);
      }
      // ---- Text content (p, span, div, section, article with text) ----
      else if (
        ['p', 'span', 'div', 'section', 'article', 'aside', 'li', 'td', 'th'].includes(tagName) &&
        literalChildren &&
        literalChildren.text.length > 0
      ) {
        const target: ReactTextContentTarget = {
          ...base,
          kind: 'text-content',
        };
        addTarget(state, target);
      }
    }
  }

  // Push onto ancestor stack and recurse children
  const roleAttr = isNativeElement ? getPropAvailability(opening, 'role') : undefined;
  state.ancestorStack.push({
    tagName: rawTagName,
    role: roleAttr?.status === 'present' ? roleAttr.value : undefined,
    ...(literalChildren ? { literalChildren } : {}),
    loc: sourceLocFromNode(opening, state.filename),
    recordId,
  });

  for (const child of el.children) {
    traverseNode(child, state);
    if (state.limitReached) break;
  }

  state.ancestorStack.pop();
}

// ---------------------------------------------------------------------------
// Post-processing: resolve label→control and ARIA ID references
// ---------------------------------------------------------------------------

function resolveReferences(state: ExtractorState): void {
  // Resolve label htmlFor → form-control id
  for (const label of state.labels) {
    const htmlForProp = label.htmlFor;
    if (
      htmlForProp.status === 'present' &&
      htmlForProp.value.trim().split(/\s+/).length !== 1
    ) {
      continue;
    }
    const reference = resolveMultiIdRef(htmlForProp, state.idRegistry);
    if (reference?.status !== 'resolved' || reference.targets.length !== 1) continue;
    const targetId = reference.targetId;

    // Find form-control with matching id and attach label
    for (const target of state.targets) {
      if (target.kind === 'form-control' && target.idProp.status === 'present' && target.idProp.value === targetId) {
        const ctrl = target as ReactFormControlTarget;
        ctrl.associatedLabel = {
          recordId: label.id,
          labelText: label.literalChildren,
          source: 'explicit-htmlFor',
          reference,
        };
      }
    }
  }

  // A wrapping label associates its descendant controls without an id/for pair.
  for (const target of state.targets) {
    if (target.kind !== 'form-control' || target.associatedLabel) continue;
    const enclosing = state.labels
      .filter((label) =>
        label.htmlFor.status === 'absent' &&
        label.loc.startOffset <= target.loc.startOffset &&
        label.loc.endOffset >= target.loc.endOffset,
      )
      .sort((a, b) => (a.loc.endOffset - a.loc.startOffset) - (b.loc.endOffset - b.loc.startOffset))[0];
    if (enclosing) {
      target.associatedLabel = {
        recordId: enclosing.id,
        labelText: enclosing.literalChildren,
        source: 'wrapping',
      };
    }
  }

  // Resolve ARIA ID references for all targets
  for (const target of state.targets) {
    if (target.ariaLabelledby.status !== 'absent') {
      (target as { ariaLabelledbyRef?: ReactIdReference }).ariaLabelledbyRef =
        resolveMultiIdRef(target.ariaLabelledby, state.idRegistry);
    }
    if (target.ariaDescribedby.status !== 'absent') {
      (target as { ariaDescribedbyRef?: ReactIdReference }).ariaDescribedbyRef =
        resolveMultiIdRef(target.ariaDescribedby, state.idRegistry);
    }
    if (target.ariaErrormessage.status !== 'absent') {
      target.ariaErrormessageRef = resolveMultiIdRef(target.ariaErrormessage, state.idRegistry);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a .jsx or .tsx source file and extract bounded accessibility evidence.
 * Never evaluates or runs the uploaded content.
 *
 * @param source - Raw source text (untrusted)
 * @param filename - Original filename as supplied (for locators)
 * @returns ReactSourceExtractionResult
 */
export function extractReactSourceTargets(
  source: string,
  filename: string,
): ReactSourceExtractionResult {
  if (filename.length > MAX_FILENAME_LENGTH) {
    return {
      status: 'error',
      code: 'invalid-filename',
      message: `Filename exceeds maximum length of ${MAX_FILENAME_LENGTH} characters.`,
    };
  }

  // --- Validate extension ---
  if (!/\.(jsx|tsx)$/i.test(filename)) {
    return {
      status: 'error',
      code: 'invalid-extension',
      message: 'Only .jsx and .tsx files are supported for source analysis.',
    };
  }

  // --- Validate input ---
  if (!source || source.trim().length === 0) {
    return {
      status: 'error',
      code: 'empty-input',
      message: 'The uploaded source file is empty.',
    };
  }

  // --- Size check uses actual UTF-8 bytes rather than UTF-16 code units ---
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_FILE_SIZE_BYTES) {
    return {
      status: 'error',
      code: 'size-exceeded',
      message: `Source file exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes.`,
    };
  }

  // --- Parse with Babel ---
  let ast: File;
  const parseErrors: ReactParseError[] = [];

  try {
    ast = parse(source, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'typescript',
      ],
      strictMode: false,
      errorRecovery: true,
    });

    // Collect parse errors from the tolerant parse
    const errors = (ast as unknown as { errors?: Array<{ message: string; loc?: { line: number; column: number } }> }).errors;
    if (errors && errors.length > 0) {
      for (const err of errors) {
        parseErrors.push({
          message: err.message ?? 'Parse error',
          line: err.loc?.line,
          column: err.loc?.column,
        });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      code: 'parse-failure',
      message: `Failed to parse source: ${msg.slice(0, 200)}`,
    };
  }

  // --- Traverse ---
  const state: ExtractorState = {
    filename,
    source,
    targets: [],
    labels: [],
    idRegistry: new Map(),
    idCounter: 0,
    elementCount: 0,
    limitReached: false,
    textTruncated: false,
    attributeTruncated: false,
    sourceExcerptTruncated: false,
    componentStack: [],
    ancestorStack: [],
  };

  traverseNode(ast.program, state);

  // --- Resolve cross-element references ---
  resolveReferences(state);

  // --- Build completeness ---
  const completenessReasons: ReactCompletenessReason[] = [];
  if (state.limitReached) completenessReasons.push('element-limit-reached');
  if (state.textTruncated) completenessReasons.push('text-truncated');
  if (state.attributeTruncated) completenessReasons.push('attribute-truncated');
  if (state.sourceExcerptTruncated) completenessReasons.push('source-excerpt-truncated');
  if (parseErrors.length > 0) completenessReasons.push('parse-errors-present');

  const completeness: ReactSnapshotCompleteness =
    completenessReasons.length === 0
      ? { status: 'complete' }
      : { status: 'partial', reasons: completenessReasons };

  const snapshot: ReactSourceSnapshot = {
    schemaVersion: REACT_SOURCE_SCHEMA_VERSION,
    filename,
    targets: state.targets,
    labels: state.labels,
    parseErrors,
    completeness,
    sourceCharacterCount: source.length,
  };

  return { status: 'available', snapshot };
}

