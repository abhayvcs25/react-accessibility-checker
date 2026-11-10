import type { ContextRecordRef } from './contextV2.js';
import type {
  CandidateModelId,
  AiProviderId,
  ModelEligibility,
} from '../ai/config.js';
import type { JobStatus, ValidationStatus } from '../ai/batchLedger.js';

/**
 * Types for the IBM accessibility-checker report structure
 * and our normalized API request/response contracts.
 *
 * The IBM report fields are based on verified documentation from
 * the IBMa/equal-access GitHub repository and npm package docs.
 */

// ---------------------------------------------------------------------------
// IBM accessibility-checker report types (upstream shape)
// ---------------------------------------------------------------------------

/**
 * A single result item from the IBM accessibility-checker engine.
 * Field names and shapes are verified from IBM's official documentation
 * and npm package README.
 */
export interface IbmResultItem {
  /**
   * The IBM rule identifier, e.g. "WCAG20_Img_HasAlt".
   * Maps to specific WCAG success criteria.
   */
  ruleId: string;

  /**
   * Two-element array describing severity and outcome.
   * Element 0: category — "VIOLATION" | "RECOMMENDATION" | "INFORMATION"
   * Element 1: outcome — "FAIL" | "POTENTIAL" | "MANUAL" | "PASS"
   */
  value: [string, string];

  /**
   * Sub-identifier describing why the rule triggered,
   * e.g. "Pass_0", "Fail_1", "Potential_1".
   */
  reasonId: string;

  /** Human-readable message describing the finding. */
  message: string;

  /** Arguments used to construct the message template. */
  messageArgs: string[];

  /** Structural location of the element in the DOM. */
  path: {
    /** XPath-like path, e.g. "/html[1]/body[1]/img[1]" */
    dom: string;
    /** ARIA role path, e.g. "/document[1]/img[1]" */
    aria?: string;
  };

  /** HTML snippet of the element that triggered the rule. */
  snippet: string;

  /** URL to IBM help documentation for the rule (may not always be present). */
  help?: string;

  /** Bounding box of the element on the rendered page. */
  bounds?: {
    left: number;
    top: number;
    height: number;
    width: number;
  };

  /** Time in ms the rule took to execute. */
  ruleTime?: number;

  apiArgs?: unknown[];
  category?: string;
}

/**
 * The top-level report object returned by aChecker.getCompliance().
 */
export interface IbmComplianceReport {
  /** Unique scan identifier (UUID). */
  scanID: string;

  /** Identifier/version of the IBM accessibility tool. */
  toolID: string;

  /** The label passed to getCompliance(). */
  label: string;

  /** Total number of rules executed. */
  numExecuted: number;

  /**
   * Localization dictionary mapping ruleId → reasonId → message.
   * Used for template-based message construction.
   */
  nls?: Record<string, Record<string, string>>;

  /** Array of individual check results. */
  results: IbmResultItem[];
}

/**
 * The object returned by aChecker.getCompliance(content, label).
 */
export interface IbmGetComplianceResult {
  report: IbmComplianceReport;
}

// ---------------------------------------------------------------------------
// Our API request/response contracts
// ---------------------------------------------------------------------------

/** The JSON body expected by POST /api/analyze. */
export interface AnalyzeRequest {
  /** Complete HTML document content as a string. */
  html: string;
  /** Original filename, must end in .html or .htm. */
  filename: string;
}

/** A single normalized accessibility issue in our API response. */
export interface AnalyzeIssue {
  /** IBM rule identifier, e.g. "WCAG20_Img_HasAlt". */
  ruleId: string;
  /**
   * Normalized severity level derived from the IBM value array.
   * One of: "violation" | "potentialViolation" | "recommendation"
   *       | "potentialRecommendation" | "manual"
   */
  level: string;
  /** Human-readable description of the issue. */
  message: string;
  /** XPath-like path to the element in the DOM tree. */
  path: string;
  /** HTML snippet of the element that caused the issue. */
  snippet: string;
  /** URL to IBM help documentation for this rule, if available. */
  help?: string;
}

/** Summary counts grouped by severity level. */
export interface AnalyzeSummary {
  total: number;
  violations: number;
  potentialViolations: number;
  recommendations: number;
  potentialRecommendations: number;
  manual: number;
}

export type ContextualAssessmentRuleId =
  | 'BUTTON-PURPOSE-CLARITY'
  | 'FORM-LABEL-RELEVANCE'
  | 'ARIA-NAME-CLARITY';

export type ContextualAssessmentValue =
  | 'potential_issue'
  | 'no_issue_detected'
  | 'insufficient_context'
  | 'not_assessed';

export interface ContextualAssessmentEvidence {
  record: ContextRecordRef;
  text?: string;
}

export interface ContextualAssessment {
  ruleId: ContextualAssessmentRuleId;
  targetId: string;
  assessment: ContextualAssessmentValue;
  statusCode?: 'remote-ai-inference-failed';
  rule?: ContextualAssessmentRuleId;
  status?: 'Not assessed';
  evidence: ContextualAssessmentEvidence[];
  explanation: string;
  confidence: number | null;
  uncertainty: string[];
  source: 'evidence_gate';
}

export type ContextualInferenceStatus =
  | 'not_invoked_insufficient_context'
  | 'not_invoked_disabled'
  | 'not_invoked_no_targets'
  | 'unavailable'
  | 'failed'
  | 'timed_out'
  | 'busy'
  | 'completed'
  | 'completed_with_limit';

export interface ContextualAssessmentReport {
  modelId: string;
  modelRevision: string;
  inferenceStatus: ContextualInferenceStatus;
  modelLoaded: boolean;
  assessments: ContextualAssessment[];
  errorCode?: string;
}

export type AdvisoryModelStatus =
  | 'blocked'
  | 'not_run'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'quota_limited';

export interface AdvisoryModelReport {
  providerId: AiProviderId;
  modelId: CandidateModelId;
  eligibility: ModelEligibility;
  status: AdvisoryModelStatus;
  reason?: string;
  jobCount: number;
  validatedCount: number;
  invalidCount: number;
  notValidatedCount: number;
  failedCount: number;
  quotaLimited: boolean;
}

export interface AdvisoryEvidence {
  id: string;
  text?: string;
}

export interface AdvisoryAssessment {
  jobId: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  targetId: string;
  componentRef: string;
  domPath?: string;
  htmlSnippet?: string;
  ruleId: string;
  status: ContextualAssessmentValue;
  explanation: string;
  evidence: AdvisoryEvidence[];
  omittedEvidenceCount: number;
  confidence?: number;
}

export interface AdvisoryEquivalentFinding {
  status: ContextualAssessmentValue;
  evidenceRefIds: string[];
  omittedEvidenceCount: number;
  modelCount: number;
  jobIds: string[];
}

export interface AdvisoryFindingGroup {
  targetId: string;
  componentRef: string;
  domPath?: string;
  htmlSnippet?: string;
  ruleId: string;
  agreement:
    | 'unanimous_issue'
    | 'unanimous_no_issue'
    | 'issue_detected'
    | 'no_issue_detected'
    | 'insufficient_context'
    | 'disagreement';
  issueCount: number;
  validatedCount: number;
  decisiveCount: number;
  abstentionCount: number;
  assessments: AdvisoryAssessment[];
  equivalentFindings: AdvisoryEquivalentFinding[];
  relatedIbmIssueIds: string[];
  omittedIbmIssueCount: number;
}

export interface AdvisoryJobReport {
  jobId: string;
  providerId: AiProviderId;
  modelId: CandidateModelId;
  targetId: string;
  componentRef: string;
  domPath?: string;
  htmlSnippet?: string;
  ruleId: string;
  status: JobStatus;
  validationStatus: ValidationStatus;
  errorClass: string | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokenUsageSource: 'provider' | 'estimated' | 'unknown';
}

export interface AdvisoryReport {
  status: 'not_run' | 'queued' | 'in_progress' | 'completed' | 'partial' | 'failed';
  models: AdvisoryModelReport[];
  jobs: AdvisoryJobReport[];
  assessmentGroups: AdvisoryFindingGroup[];
  findings: AdvisoryFindingGroup[];
  fixingPrompt: string | null;
  omittedJobCount: number;
  omittedPromptFindingCount: number;
}

/** The JSON response returned by POST /api/analyze on success. */
export interface AnalyzeResponse {
  /** Echo of the scanned filename. */
  filename: string;
  /** ISO 8601 timestamp of when analysis completed. */
  analyzedAt: string;
  /** Summary counts by severity category. */
  summary: AnalyzeSummary;
  /** Individual findings, excluding passes. */
  issues: AnalyzeIssue[];
  /** Experimental contextual assessments, separate from IBM findings and counts. */
  contextualAssessments: ContextualAssessmentReport;
  /** Validated multi-model advisory results, separate from IBM findings and counts. */
  advisoryReport: AdvisoryReport;
}

/** Standard error response body. */
export interface ErrorResponse {
  error: string;
}
