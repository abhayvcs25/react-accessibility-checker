export interface ContextSnapshot {
  schemaVersion: 1;
  /**
   * True when eligible context records were omitted at the element cap.
   * This does not indicate whether parsing or indexing covered the full document.
   */
  elementsTruncated: boolean;
  elements: ElementContext[];
}

export type ContextKind =
  | 'image'
  | 'link'
  | 'button'
  | 'form-control'
  | 'heading'
  | 'other';

export type NameEvidenceSource =
  | 'aria-label'
  | 'aria-labelledby'
  | 'explicit-label'
  | 'wrapping-label'
  | 'alt'
  | 'title'
  | 'text-content'
  | 'value-attribute';

export interface ElementContext {
  contextId: string;
  tagName: string;
  kind: ContextKind;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  domPath?: string;
  attributes: {
    authoredId?: string;
    role?: string;
    aria: Record<string, string>;
    alt?: string;
    title?: string;
    inputType?: string;
    name?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    hrefKind?: 'fragment' | 'same-document' | 'external' | 'missing';
  };
  text?: {
    ownText?: string;
    nearbyText?: string;
    truncated: boolean;
  };
  nameEvidence: Array<{
    source: NameEvidenceSource;
    targetContextIds?: string[];
  }>;
  relationships: {
    parentContextId?: string;
    childContextIds: string[];
    labelContextIds: string[];
    labelledByContextIds: string[];
    describedByContextIds: string[];
    /** True when IDREF character or token limits cut off this attribute's references. */
    labelledByReferencesTruncated?: boolean;
    describedByReferencesTruncated?: boolean;
    /** True when duplicate-ID target expansion exceeded its per-ID limit. */
    labelledByTargetsTruncated?: boolean;
    describedByTargetsTruncated?: boolean;
    /** True when a resolved target was not included because the element cap was reached. */
    labelledByTargetsOmitted?: boolean;
    describedByTargetsOmitted?: boolean;
    /** True when a known native label was not included because the element cap was reached. */
    labelTargetsOmitted?: boolean;
  };
}
