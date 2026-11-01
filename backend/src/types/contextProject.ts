import type {
  ContextSnapshot,
  SourceLocator,
} from './contextV2.js';

export type EvidenceAvailability =
  | 'present'
  | 'ambiguous'
  | 'confirmed-absent'
  | 'not-captured'
  | 'omitted-incomplete'
  | 'unknown';

export type ProjectEvidence<T> =
  | {
      status: 'present';
      value: T;
      completeness?: 'complete' | 'partial';
      truncated?: boolean;
      uncertainties?: string[];
    }
  | {
      status: 'ambiguous';
      reason: string;
      candidates?: ProjectRecordRef[];
    }
  | { status: 'confirmed-absent' }
  | {
      status: 'not-captured' | 'omitted-incomplete' | 'unknown';
      reason: string;
    };

export type ProjectContextCategory =
  | 'text'
  | 'heading'
  | 'label'
  | 'form'
  | 'group'
  | 'section'
  | 'list'
  | 'list-item'
  | 'table'
  | 'table-cell'
  | 'figure'
  | 'caption'
  | 'landmark'
  | 'other';

export interface ProjectRecordRef {
  documentId: string;
  recordType: 'target' | 'evidence' | 'context';
  id: string;
}

export interface ProjectContextRecord {
  id: string;
  tagName: string;
  category: ProjectContextCategory;
  sourceLocator?: SourceLocator;
  authoredId: ProjectEvidence<string>;
  role: ProjectEvidence<string>;
  text: ProjectEvidence<{ value: string; truncated: boolean }>;
  attributes: Record<string, ProjectEvidence<string | boolean>>;
  truncatedAttributes: string[];
  completeness: 'complete' | 'partial';
}

export interface AuthoredNameInput {
  source:
    | 'aria-label'
    | 'aria-labelledby'
    | 'native-label'
    | 'text-content'
    | 'descendant-content'
    | 'alt'
    | 'title'
    | 'value-attribute'
    | 'placeholder';
  value?: string;
  truncated?: boolean;
  referencedRecords?: ProjectRecordRef[];
  certainty?: 'ambiguous';
}

export interface ProjectTargetEvidence {
  target: ProjectRecordRef;
  targetDomText: ProjectEvidence<{ value: string; truncated: boolean }>;
  authoredNameInputs: ProjectEvidence<AuthoredNameInput[]>;
  nativeLabels: ProjectEvidence<ProjectRecordRef[]>;
  surroundingDomText: ProjectEvidence<ProjectRecordRef[]>;
  computedAccessibleName: ProjectEvidence<never>;
  renderedVisibleText: ProjectEvidence<never>;
  actionBehavior: ProjectEvidence<never>;
}

export type ProjectRelationshipKind =
  | 'dom-parent-child'
  | 'adjacent-before'
  | 'adjacent-after'
  | 'native-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-errormessage'
  | 'form-owner'
  | 'field-group'
  | 'figure-caption'
  | 'table-caption'
  | 'heading-section-content';

export interface ProjectRelationship {
  id: string;
  kind: ProjectRelationshipKind;
  source: ProjectRecordRef;
  destination:
    | { status: 'resolved'; record: ProjectRecordRef }
    | {
        status: 'unresolved' | 'omitted-incomplete' | 'unknown';
        reason: string;
      }
    | {
        status: 'ambiguous';
        reason: string;
        candidates: ProjectRecordRef[];
      };
  provenance: 'html-structure' | 'native-html' | 'aria-idref' | 'extraction';
}

export interface ProjectLinkReference {
  source: ProjectRecordRef;
  href: ProjectEvidence<string>;
  destination:
    | {
        status: 'resolved';
        documentId: string;
        filePath: string;
        query?: string;
        fragment?: string;
      }
    | {
        status:
          | 'external'
          | 'unresolved'
          | 'omitted-incomplete'
          | 'unknown'
          | 'not-applicable';
        reason: string;
      };
}

export interface ProjectDocumentInput {
  documentId: string;
  filePath: string;
  html: string;
}

export interface ProjectContextDocument {
  documentId: string;
  filePath: string;
  snapshot: ContextSnapshot;
  contextRecords: ProjectContextRecord[];
  targetEvidence: ProjectTargetEvidence[];
  relationships: ProjectRelationship[];
  links: ProjectLinkReference[];
  baseHref: ProjectEvidence<string>;
  parserDiagnostics: Array<{
    code: string;
    startOffset: number;
    endOffset: number;
    affectsExtraction: boolean;
    affectedRecords: ProjectRecordRef[];
  }>;
  baseHrefSourceLocator?: SourceLocator;
  contextCompleteness: {
    status: 'complete' | 'partial';
    omittedRecordCount: number;
    partialRecordIds: string[];
  };
  evidenceAvailability: {
    surroundingText: EvidenceAvailability;
    computedAccessibleName: EvidenceAvailability;
    renderedVisibility: EvidenceAvailability;
    actionBehavior: EvidenceAvailability;
    imagePixels: EvidenceAvailability;
    routeAndComponentIdentity: EvidenceAvailability;
  };
}

export interface ProjectComparisonGroup {
  basis:
    | 'exact-authored-link-text'
    | 'exact-authored-target-text'
    | 'exact-context-text'
    | 'same-supplied-destination';
  records: ProjectRecordRef[];
  destination?: {
    documentId: string;
    filePath: string;
    query?: string;
    fragment?: string;
  };
}

export interface ProjectContextSnapshot {
  schemaVersion: 1;
  scope: 'provided-html-files-only';
  documents: ProjectContextDocument[];
  comparisons: ProjectComparisonGroup[];
  completeness: {
    status: 'complete' | 'partial';
    omittedDocumentIds: string[];
    projectCoverage: 'provided-files-only';
  };
}

export type ProjectExtractionErrorCode =
  | 'invalid-document'
  | 'duplicate-document-id'
  | 'duplicate-file-path';

export class ProjectExtractionError extends Error {
  constructor(
    readonly code: ProjectExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectExtractionError';
  }
}
