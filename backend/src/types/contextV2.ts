export const CONTEXT_SCHEMA_V2 = 2 as const;

export type ContextUnavailableReason =
  | 'input-rejected'
  | 'parser-failure'
  | 'not-requested';

export interface BoundedString {
  value: string;
  truncated: boolean;
}

export type BoundedText = BoundedString;

export type SourceLocator =
  | {
      kind: 'dom-path';
      format: 'element-index-path-v1';
      path: string;
    }
  | {
      kind: 'html-source-range';
      startOffset: number;
      endOffset: number;
      sourceLanguage: 'html';
      offsetUnit: 'utf16-code-unit';
    };

export type ContextRecordRef =
  | { recordType: 'target'; id: string }
  | { recordType: 'evidence'; id: string };

export type CustomWidgetRole =
  | 'button'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'textbox'
  | 'combobox'
  | 'listbox'
  | 'searchbox'
  | 'spinbutton';

export type TargetKind =
  | 'image'
  | 'link'
  | 'button'
  | 'form-control'
  | 'heading'
  | 'custom-widget'
  | 'other';

export type TargetBasis =
  | { type: 'native-html' }
  | { type: 'aria-widget'; role: CustomWidgetRole }
  | { type: 'aria-heading' }
  | { type: 'explicit-policy'; policyId: string };

export type AttributeObservation<T> =
  | { status: 'present'; value: T }
  | { status: 'absent' }
  | {
      status: 'ambiguous';
      candidates: T[];
      totalCandidateCount: number;
      additionalCandidateCount: number;
    }
  | {
      status: 'unavailable';
      reason: 'parser-normalized-duplicate' | 'extraction-limit';
    }
  | { status: 'invalid'; raw: BoundedString };

export type BooleanAttributeState =
  | 'present'
  | 'absent'
  | 'unavailable';

export type ContextAriaAttribute =
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-hidden'
  | 'aria-level'
  | 'aria-checked'
  | 'aria-selected'
  | 'aria-expanded'
  | 'aria-pressed'
  | 'aria-disabled'
  | 'aria-required'
  | 'aria-invalid'
  | 'aria-controls'
  | 'aria-owns'
  | 'aria-valuenow'
  | 'aria-valuemin'
  | 'aria-valuemax'
  | 'aria-valuetext'
  | 'aria-orientation'
  | 'aria-haspopup'
  | 'aria-activedescendant';

export interface AriaAttributes {
  'aria-label'?: AttributeObservation<BoundedString>;
  'aria-labelledby'?: AttributeObservation<BoundedString>;
  'aria-describedby'?: AttributeObservation<BoundedString>;
  'aria-hidden'?: AttributeObservation<boolean>;
  'aria-level'?: AttributeObservation<number>;
  'aria-checked'?: AttributeObservation<boolean | 'mixed'>;
  'aria-selected'?: AttributeObservation<boolean>;
  'aria-expanded'?: AttributeObservation<boolean>;
  'aria-pressed'?: AttributeObservation<boolean | 'mixed'>;
  'aria-disabled'?: AttributeObservation<boolean>;
  'aria-required'?: AttributeObservation<boolean>;
  'aria-invalid'?: AttributeObservation<boolean | 'grammar' | 'spelling'>;
  'aria-controls'?: AttributeObservation<BoundedString>;
  'aria-owns'?: AttributeObservation<BoundedString>;
  'aria-valuenow'?: AttributeObservation<number>;
  'aria-valuemin'?: AttributeObservation<number>;
  'aria-valuemax'?: AttributeObservation<number>;
  'aria-valuetext'?: AttributeObservation<BoundedString>;
  'aria-orientation'?: AttributeObservation<'horizontal' | 'vertical'>;
  'aria-haspopup'?: AttributeObservation<
    boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
  >;
  'aria-activedescendant'?: AttributeObservation<BoundedString>;
}

export interface BoundedAriaAttributes {
  values: AriaAttributes;
  truncated: boolean;
}

export interface CommonTargetAttributes {
  authoredId: AttributeObservation<BoundedString>;
  role: AttributeObservation<BoundedString>;
  aria: BoundedAriaAttributes;
  title: AttributeObservation<BoundedString>;
  hidden: BooleanAttributeState;
  inert: BooleanAttributeState;
  tabIndex: AttributeObservation<number>;
}

export interface ImageTargetAttributes extends CommonTargetAttributes {
  alt: AttributeObservation<BoundedString>;
  inputType?: AttributeObservation<BoundedString>;
}

export interface LinkTargetAttributes extends CommonTargetAttributes {
  href: AttributeObservation<BoundedString>;
  hrefKind?: 'fragment' | 'same-document' | 'external';
}

export interface ButtonTargetAttributes extends CommonTargetAttributes {
  disabled: BooleanAttributeState;
  inputType?: AttributeObservation<BoundedString>;
  value?: AttributeObservation<BoundedString>;
}

export interface FormControlTargetAttributes extends CommonTargetAttributes {
  inputType?: AttributeObservation<BoundedString>;
  name: AttributeObservation<BoundedString>;
  placeholder?: AttributeObservation<BoundedString>;
  required: BooleanAttributeState;
  disabled: BooleanAttributeState;
  checked?: BooleanAttributeState;
  selected?: BooleanAttributeState;
}

export interface HeadingTargetAttributes extends CommonTargetAttributes {}
export interface CustomWidgetTargetAttributes extends CommonTargetAttributes {}
export interface OtherTargetAttributes extends CommonTargetAttributes {}

export type RecordTruncation =
  | 'text-limit'
  | 'attribute-value-limit'
  | 'aria-attribute-limit';

export type RecordCompleteness =
  | { status: 'complete' }
  | {
      status: 'partial';
      truncations: [RecordTruncation, ...RecordTruncation[]];
    };

interface EvaluationTargetBase {
  id: string;
  tagName: string;
  text?: BoundedText;
  sourceLocator?: SourceLocator;
  completeness: RecordCompleteness;
}

export type EvaluationTarget =
  | (EvaluationTargetBase & {
      kind: 'image';
      basis: { type: 'native-html' };
      attributes: ImageTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'link';
      basis: { type: 'native-html' };
      attributes: LinkTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'button';
      basis: { type: 'native-html' };
      attributes: ButtonTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'form-control';
      basis: { type: 'native-html' };
      attributes: FormControlTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'heading';
      basis: { type: 'native-html' } | { type: 'aria-heading' };
      headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
      attributes: HeadingTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'custom-widget';
      basis: { type: 'aria-widget'; role: CustomWidgetRole };
      attributes: CustomWidgetTargetAttributes;
    })
  | (EvaluationTargetBase & {
      kind: 'other';
      basis: { type: 'explicit-policy'; policyId: string };
      attributes: OtherTargetAttributes;
    });

export type SupportedEvidenceKind =
  | 'native-label'
  | 'aria-reference'
  | 'structural-context';

export interface EvidenceAttributes {
  authoredId?: AttributeObservation<BoundedString>;
  role?: AttributeObservation<BoundedString>;
  aria?: BoundedAriaAttributes;
}

export interface SupportingEvidence {
  id: string;
  kind: SupportedEvidenceKind;
  tagName?: string;
  text?: BoundedText;
  attributes?: EvidenceAttributes;
  sourceLocator?: SourceLocator;
  completeness: RecordCompleteness;
}

export type TargetEvidenceRelationshipKind =
  | 'native-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'structural-context';

export type RelationshipDestination =
  | { status: 'resolved'; record: ContextRecordRef }
  | {
      status: 'unresolved';
      authoredId: BoundedString;
      attribute: 'for' | 'aria-labelledby' | 'aria-describedby';
      reason: 'not-found' | 'excluded-by-policy' | 'truncated';
    }
  | {
      status: 'ambiguous';
      authoredId: BoundedString;
      attribute: 'for' | 'aria-labelledby' | 'aria-describedby';
      candidates: ContextRecordRef[];
      totalCandidateCount: number;
      additionalCandidateCount: number;
    };

export type RelationshipProvenance =
  | {
      basis: 'native-html';
      attribute?: 'for';
      authoredReference?: BoundedString;
    }
  | {
      basis: 'aria-idref';
      attribute: 'aria-labelledby' | 'aria-describedby';
      authoredReference: BoundedString;
    }
  | { basis: 'structural-html'; ruleId: string }
  | { basis: 'extraction-heuristic'; ruleId: string };

export type RelationshipCompleteness =
  | { status: 'complete' }
  | { status: 'partial'; reason: 'candidate-list-limit' };

export interface TargetEvidenceRelationship {
  id: string;
  kind: TargetEvidenceRelationshipKind;
  source: { recordType: 'target'; id: string };
  destination: RelationshipDestination;
  direction: 'target-to-associated-record';
  provenance: RelationshipProvenance;
  completeness: RelationshipCompleteness;
  /**
   * Describes ambiguity in resolving a native label's `for` to this source target.
   * Candidates are capped at 20; when additionalCandidateCount is positive,
   * this source may be among the omitted candidates rather than the retained list.
   */
  sourceResolution?: {
    status: 'ambiguous';
    authoredId: BoundedString;
    candidates: Array<{ recordType: 'target'; id: string }>;
    totalCandidateCount: number;
    additionalCandidateCount: number;
  };
}

export interface StructuralRelationship {
  id: string;
  kind: 'parent-child';
  source: ContextRecordRef;
  destination: { status: 'resolved'; record: ContextRecordRef };
  direction: 'parent-to-child';
  provenance: { basis: 'structural-html'; ruleId: string };
  completeness: RelationshipCompleteness;
}

export type ContextRelationship =
  | TargetEvidenceRelationship
  | StructuralRelationship;

export type DocumentField<T> =
  | { status: 'present'; value: T; truncated: boolean }
  | { status: 'absent' }
  | {
      status: 'invalid';
      raw?: BoundedString;
      reason: 'empty' | 'malformed' | 'multiple-values';
    }
  | {
      status: 'unavailable';
      reason: 'not-parsed' | 'field-parse-failure';
    };

export interface DocumentContext {
  title: DocumentField<string>;
  language: DocumentField<string>;
}

export type ExtractionLimit =
  | 'record-count'
  | 'text-length'
  | 'attribute-value-length'
  | 'aria-attribute-count'
  | 'idref-character-count'
  | 'idref-token-count'
  | 'duplicate-id-candidates';

export interface ExtractionTruncation {
  scope: 'snapshot' | 'target' | 'evidence' | 'relationship';
  limit: ExtractionLimit;
  recordId?: string;
  omittedCount?: number;
}

export interface PolicyOmission {
  category:
    | 'non-target-node'
    | 'unsupported-role'
    | 'unsupported-evidence-category'
    | 'script-or-style-content';
  count?: number;
}

export interface RelationshipResolutionSummary {
  unresolvedCount: number;
  ambiguousCount: number;
}

export type ContextCompleteness =
  | {
      /** No extraction limits were hit; policy omissions may still exist. */
      status: 'complete';
      truncations: [];
      policyOmissions: PolicyOmission[];
      relationshipResolution: RelationshipResolutionSummary;
    }
  | {
      status: 'partial';
      truncations: [ExtractionTruncation, ...ExtractionTruncation[]];
      policyOmissions: PolicyOmission[];
      relationshipResolution: RelationshipResolutionSummary;
    };

export interface ContextSnapshot {
  schemaVersion: typeof CONTEXT_SCHEMA_V2;
  document: DocumentContext;
  targets: EvaluationTarget[];
  evidence: SupportingEvidence[];
  relationships: ContextRelationship[];
  completeness: ContextCompleteness;
}

export type ContextExtractionResult =
  | { status: 'available'; snapshot: ContextSnapshot }
  | { status: 'unavailable'; reason: ContextUnavailableReason };

export interface TargetRelationshipProjection {
  relationshipId: string;
  focalTargetId: string;
  kind: TargetEvidenceRelationshipKind;
  destination: RelationshipDestination;
  direction: 'target-to-associated-record';
  provenance: RelationshipProvenance;
  completeness: RelationshipCompleteness;
}

export interface AssociatedTargetEvidence {
  evidence: SupportingEvidence;
  relationships: TargetRelationshipProjection[];
}

export type AdapterUnitTruncation =
  | 'associated-evidence-count'
  | 'evidence-character-budget'
  | 'serialized-size-budget'
  | 'relationship-omitted';

export type AdapterUnitCompleteness =
  | { status: 'complete'; truncations: [] }
  | {
      status: 'partial';
      truncations: [AdapterUnitTruncation, ...AdapterUnitTruncation[]];
      omittedEvidenceCount: number;
    };

export interface TargetContextInputUnit {
  focal: EvaluationTarget;
  associatedEvidence: AssociatedTargetEvidence[];
  relationships: TargetRelationshipProjection[];
  completeness: AdapterUnitCompleteness;
}

export type AdapterCompleteness =
  | { status: 'complete'; truncations: [] }
  | {
      status: 'partial';
      truncations: [AdapterUnitTruncation, ...AdapterUnitTruncation[]];
      omittedUnitEvidenceCount: number;
    };

export interface AdaptedContextInput {
  document: DocumentContext;
  units: TargetContextInputUnit[];
  extractionCompleteness: ContextCompleteness;
  adapterCompleteness: AdapterCompleteness;
}

export type ContextAdapterErrorCode =
  | 'invalid-snapshot'
  | 'group-size-limit';

export type ContextAdapterResult =
  | {
      status: 'ready';
      input: AdaptedContextInput & {
        units: [TargetContextInputUnit, ...TargetContextInputUnit[]];
        extractionCompleteness: Extract<
          ContextCompleteness,
          { status: 'complete' }
        >;
        adapterCompleteness: Extract<
          AdapterCompleteness,
          { status: 'complete' }
        >;
      };
    }
  | {
      status: 'partial';
      input: AdaptedContextInput & (
        | {
            extractionCompleteness: Extract<
              ContextCompleteness,
              { status: 'partial' }
            >;
          }
        | {
            extractionCompleteness: Extract<
              ContextCompleteness,
              { status: 'complete' }
            >;
            adapterCompleteness: Extract<
              AdapterCompleteness,
              { status: 'partial' }
            >;
          }
      );
    }
  | {
      status: 'empty';
      input: AdaptedContextInput & {
        units: [];
        extractionCompleteness: Extract<
          ContextCompleteness,
          { status: 'complete' }
        >;
        adapterCompleteness: Extract<
          AdapterCompleteness,
          { status: 'complete' }
        >;
      };
    }
  | { status: 'unavailable'; reason: ContextUnavailableReason }
  | { status: 'error'; errorCode: ContextAdapterErrorCode };
