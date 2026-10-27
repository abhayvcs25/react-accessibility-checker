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
}

/** Standard error response body. */
export interface ErrorResponse {
  error: string;
}
