import type { ElementContext } from './context.js';

export type ContextRelationshipType =
  | 'native-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'parent'
  | 'child';

export type ContextRelationshipDirection = 'outgoing' | 'incoming';

export interface ContextRelationshipProvenance {
  relationship: ContextRelationshipType;
  direction: ContextRelationshipDirection;
  sourceContextId: string;
  targetContextId: string;
}

export type ContextElementEvidence = Omit<ElementContext, 'relationships'>;

export interface ContextEvidenceRecord {
  contextId: string;
  evidence: ContextElementEvidence;
  relationshipProvenance: ContextRelationshipProvenance[];
}

export interface ContextInputUnit {
  focal: ContextEvidenceRecord;
  associated: ContextEvidenceRecord[];
  completeness: ContextGroupCompleteness;
}

export interface ContextGroupCompleteness {
  status: 'complete' | 'partial';
  snapshotElementsTruncated: boolean;
  sourceTextTruncated: boolean;
  labelledByReferencesTruncated: boolean;
  describedByReferencesTruncated: boolean;
  labelledByTargetsTruncated: boolean;
  describedByTargetsTruncated: boolean;
  labelledByTargetsOmitted: boolean;
  describedByTargetsOmitted: boolean;
  nativeLabelTargetsOmitted: boolean;
  unresolvedRelationshipReferences: boolean;
  relationshipEvidenceTruncated: boolean;
  associatedRecordsTruncated: boolean;
  associatedRecordsOmitted: number;
  omittedAssociatedContextIds: string[];
  omittedAssociatedContextIdsTruncated: boolean;
  evidenceTruncated: boolean;
  serializedSizeTruncated: boolean;
}

export type ContextAdapterResult =
  | {
      status: 'ready' | 'partial';
      units: ContextInputUnit[];
      snapshotElementsTruncated: boolean;
    }
  | {
      status: 'empty';
      units: [];
      snapshotElementsTruncated: false;
    }
  | {
      status: 'unavailable';
      units: [];
    }
  | {
      status: 'error';
      units: [];
      errorCode: 'invalid-snapshot' | 'group-size-limit';
    };
