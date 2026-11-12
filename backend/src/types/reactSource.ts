/**
 * React source extraction types — schema version 1.
 *
 * These types represent the result of parsing a single .jsx/.tsx file with
 * an AST-capable parser. They are distinct from the HTML V2 extraction schema
 * (ContextSnapshot / contextV2) and must never be passed to IBM Equal Access
 * or treated as HTML.
 *
 * ID prefix: "rs-N" (react-source), never reusing HTML "t-N" target IDs.
 * Locators reference authored JSX source positions, not DOM paths.
 */

export const REACT_SOURCE_SCHEMA_VERSION = 1 as const;

/** Exact source location within the uploaded file. */
export interface ReactSourceLocation {
  /** Original filename as provided by the uploader (untrusted). */
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  /** UTF-16 code-unit offset from the start of the source. */
  startOffset: number;
  endOffset: number;
}

/**
 * Availability state for a prop/attribute value extracted from JSX.
 * - present: static literal value resolved by the extractor
 * - absent: attribute not present in this element
 * - dynamic: value is an expression, spread, hook, or cannot be statically resolved
 * - unknown: parser could not determine status
 */
export type PropAvailability =
  | { status: 'present'; value: string; truncated: boolean }
  | { status: 'absent' }
  | { status: 'dynamic'; reason: 'expression' | 'spread' | 'conditional' | 'identifier' | 'function-call' | 'unknown' }
  | { status: 'unknown' };

export interface ReactIdReferenceTarget {
  targetId: string;
  targetRecordId: string;
  tagName: string;
  loc: ReactSourceLocation;
  text?: ReactLiteralChildren;
}

/**
 * A resolved or unresolved ID reference (htmlFor→id, aria-labelledby→id).
 */
export type ReactIdReference =
  | {
      status: 'resolved';
      targetId: string;
      targetRecordId: string;
      targets: ReactIdReferenceTarget[];
    }
  | {
      status: 'unresolved';
      reason: 'not-found' | 'duplicate' | 'ambiguous' | 'dynamic' | 'out-of-scope' | 'truncated';
    }
  | { status: 'dynamic' };

/** Literal children text extracted from JSX, excluding dynamic expressions. */
export interface ReactLiteralChildren {
  /** Combined literal string content, truncated if needed. */
  text: string;
  truncated: boolean;
  /** True if any child is a JSX expression (dynamic content is present). */
  hasDynamicChildren: boolean;
}

/** Nearest statically-known JSX ancestor context. */
export interface ReactAncestorContext {
  recordId: string;
  tagName: string;
  /** Explicit ARIA role if statically present. */
  role?: string;
  literalChildren?: ReactLiteralChildren;
  loc: ReactSourceLocation;
}

// ---------------------------------------------------------------------------
// Target kinds
// ---------------------------------------------------------------------------

export type ReactTargetKind =
  | 'image'
  | 'button'
  | 'link'
  | 'form-control'
  | 'heading'
  | 'custom-widget'
  | 'text-content';

/** Common fields for every extracted JSX target. */
export interface ReactTargetBase {
  /** Stable analysis-local ID, e.g. "rs-1". Never reuses HTML t-N IDs. */
  id: string;
  kind: ReactTargetKind;
  /** JSX element tag name as authored (e.g. "img", "button", "h2"). */
  tagName: string;
  loc: ReactSourceLocation;
  /** Bounded literal children text, if available. */
  literalChildren?: ReactLiteralChildren;
  /** Nearest enclosing JSX ancestors (up to 4), closest first. */
  ancestors: ReactAncestorContext[];
  /** aria-label prop. */
  ariaLabel: PropAvailability;
  /** aria-labelledby prop value and resolution. */
  ariaLabelledby: PropAvailability;
  ariaLabelledbyRef?: ReactIdReference;
  /** aria-describedby prop value and resolution. */
  ariaDescribedby: PropAvailability;
  ariaDescribedbyRef?: ReactIdReference;
  ariaErrormessage: PropAvailability;
  ariaErrormessageRef?: ReactIdReference;
  /** aria-hidden prop. */
  ariaHidden: PropAvailability;
  ariaInvalid: PropAvailability;
  ariaLive: PropAvailability;
  /** Explicit role prop. */
  role: PropAvailability;
  title: PropAvailability;
  /** id prop for ID reference resolution. */
  idProp: PropAvailability;
  /** Whether the element has a prop spread (...props / {...rest}). */
  hasPropSpread: boolean;
  /** Nearest function/component that contains this JSX, when statically named. */
  componentName?: string;
  className: PropAvailability;
  sourceExcerptTruncated: boolean;
  /** Raw source text excerpt (bounded, up to 500 chars). */
  sourceExcerpt: string;
}

/** Image target (`<img>` or `<input type="image">`). */
export interface ReactImageTarget extends ReactTargetBase {
  kind: 'image';
  alt: PropAvailability;
  src: PropAvailability;
}

/** Button target (native `<button>`, `<input type="button/submit/reset">`). */
export interface ReactButtonTarget extends ReactTargetBase {
  kind: 'button';
  buttonType: PropAvailability;
  disabled: PropAvailability;
  /** aria-pressed, aria-expanded, aria-disabled. */
  ariaPressed: PropAvailability;
  ariaExpanded: PropAvailability;
  ariaDisabled: PropAvailability;
}

/** Link target (`<a href=...>`). */
export interface ReactLinkTarget extends ReactTargetBase {
  kind: 'link';
  href: PropAvailability;
}

/** Form control target (input/select/textarea). */
export interface ReactFormControlTarget extends ReactTargetBase {
  kind: 'form-control';
  inputType: PropAvailability;
  placeholder: PropAvailability;
  /** htmlFor from an associated <label> resolved in this file. */
  associatedLabel?: {
    recordId: string;
    labelText?: ReactLiteralChildren;
    source: 'explicit-htmlFor' | 'wrapping';
    reference?: ReactIdReference;
  };
  name: PropAvailability;
  required: PropAvailability;
  disabled: PropAvailability;
  autoComplete: PropAvailability;
}

/** Heading target (h1–h6). */
export interface ReactHeadingTarget extends ReactTargetBase {
  kind: 'heading';
  headingLevel: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Custom widget target (element with an explicit role). */
export interface ReactCustomWidgetTarget extends ReactTargetBase {
  kind: 'custom-widget';
  resolvedRole: string;
}

/** Arbitrary text content (paragraph, span, div with text). */
export interface ReactTextContentTarget extends ReactTargetBase {
  kind: 'text-content';
}

export type ReactTarget =
  | ReactImageTarget
  | ReactButtonTarget
  | ReactLinkTarget
  | ReactFormControlTarget
  | ReactHeadingTarget
  | ReactCustomWidgetTarget
  | ReactTextContentTarget;

// ---------------------------------------------------------------------------
// Label records (standalone <label> elements)
// ---------------------------------------------------------------------------

export interface ReactLabelRecord {
  id: string;
  tagName: 'label';
  loc: ReactSourceLocation;
  htmlFor: PropAvailability;
  literalChildren?: ReactLiteralChildren;
}

// ---------------------------------------------------------------------------
// Parse diagnostics
// ---------------------------------------------------------------------------

export interface ReactParseError {
  message: string;
  line?: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

export type ReactCompletenessReason =
  | 'element-limit-reached'
  | 'text-truncated'
  | 'attribute-truncated'
  | 'source-excerpt-truncated'
  | 'parse-errors-present'
  | 'size-limit-exceeded';

export type ReactSnapshotCompleteness =
  | { status: 'complete' }
  | {
      status: 'partial';
      reasons: ReactCompletenessReason[];
    };

// ---------------------------------------------------------------------------
// Top-level snapshot
// ---------------------------------------------------------------------------

/** The result of extracting from a single .jsx/.tsx file. */
export interface ReactSourceSnapshot {
  schemaVersion: typeof REACT_SOURCE_SCHEMA_VERSION;
  /** Original filename as supplied (untrusted, not resolved to disk). */
  filename: string;
  targets: ReactTarget[];
  labels: ReactLabelRecord[];
  parseErrors: ReactParseError[];
  completeness: ReactSnapshotCompleteness;
  /** Total character count of the uploaded source. */
  sourceCharacterCount: number;
}

// ---------------------------------------------------------------------------
// Extraction result (wraps snapshot with status)
// ---------------------------------------------------------------------------

export type ReactSourceExtractionResult =
  | { status: 'available'; snapshot: ReactSourceSnapshot }
  | {
      status: 'error';
      code:
        | 'invalid-filename'
        | 'invalid-extension'
        | 'size-exceeded'
        | 'parse-failure'
        | 'empty-input';
      message: string;
    };

