export type HtmlFileInfo = {
  name: string
  size: string
  characterCount: number
  title: string | null
}

export type AnalyzeIssue = {
  ruleId: string
  level: string
  message: string
  path: string
  snippet: string
  help?: string
}

export type AdvisoryModelReport = {
  providerId: string
  modelId: string
  eligibility: string
  status:
    | 'blocked'
    | 'not_run'
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'quota_limited'
  reason?: string
  jobCount: number
  validatedCount: number
  invalidCount: number
  notValidatedCount: number
  failedCount: number
  quotaLimited: boolean
}

export type SourceLocation = {
  file: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export type AdvisoryAssessment = {
  jobId: string
  providerId: string
  modelId: string
  targetId: string
  componentRef: string
  domPath?: string
  htmlSnippet?: string
  sourceExcerpt?: string
  sourceLanguage?: 'jsx' | 'tsx'
  sourceLocation?: SourceLocation
  ruleId: string
  status: 'potential_issue' | 'no_issue_detected' | 'insufficient_context'
  explanation: string
  evidence: { id: string; text?: string }[]
  omittedEvidenceCount: number
  confidence?: number
}

export type AdvisoryEquivalentFinding = {
  status: AdvisoryAssessment['status']
  evidenceRefIds: string[]
  omittedEvidenceCount: number
  modelCount: number
  jobIds: string[]
}

export type AdvisoryFindingGroup = {
  targetId: string
  componentRef: string
  domPath?: string
  htmlSnippet?: string
  sourceExcerpt?: string
  sourceLanguage?: 'jsx' | 'tsx'
  sourceLocation?: SourceLocation
  ruleId: string
  agreement:
    | 'unanimous_issue'
    | 'unanimous_no_issue'
    | 'issue_detected'
    | 'no_issue_detected'
    | 'insufficient_context'
    | 'disagreement'
  issueCount: number
  validatedCount: number
  decisiveCount: number
  abstentionCount: number
  assessments: AdvisoryAssessment[]
  equivalentFindings: AdvisoryEquivalentFinding[]
  relatedIbmIssueIds: string[]
  omittedIbmIssueCount: number
}

export type AdvisoryJobReport = {
  jobId: string
  providerId: string
  modelId: string
  targetId: string
  componentRef: string
  domPath?: string
  htmlSnippet?: string
  sourceExcerpt?: string
  sourceLanguage?: 'jsx' | 'tsx'
  sourceLocation?: SourceLocation
  ruleId: string
  status:
    | 'queued'
    | 'in_progress'
    | 'succeeded'
    | 'invalid_response'
    | 'retryable_failed'
    | 'permanent_failed'
    | 'blocked'
    | 'unknown_outcome'
  validationStatus: 'valid' | 'invalid' | 'not_run'
  errorClass: string | null
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  tokenUsageSource: 'provider' | 'estimated' | 'unknown'
}

export type AdvisoryReport = {
  status: 'not_run' | 'queued' | 'in_progress' | 'completed' | 'partial' | 'failed'
  models: AdvisoryModelReport[]
  jobs: AdvisoryJobReport[]
  assessmentGroups: AdvisoryFindingGroup[]
  findings: AdvisoryFindingGroup[]
  fixingPrompt: string | null
  omittedJobCount: number
  omittedPromptFindingCount: number
}

export type AnalyzeSummary = {
  total: number
  violations: number
  potentialViolations: number
  recommendations: number
  potentialRecommendations: number
  manual: number
}

export type AnalyzeResponse = {
  filename: string
  analyzedAt: string
  summary: AnalyzeSummary
  issues: AnalyzeIssue[]
  advisoryReport: AdvisoryReport
}

export type SourceRuleCoverage = {
  ruleId: string
  evidenceAvailability: 'static-extractable' | 'partial-static' | 'not-available'
  assessableFromSingleFile: boolean
  applicableTargetCount: number
  scheduledUnitCount: number
  unavailablePrerequisites: string[]
}

export type SourceExtractionSummary = {
  totalTargets: number
  targetsByKind: Record<string, number>
  parseErrorCount: number
  completeness: 'complete' | 'partial'
  sourceCharacterCount: number
}

export type SourceAnalyzeResponse = {
  filename: string
  analyzedAt: string
  ibmStatus: 'not_run_source_input'
  ibmStatusNote: string
  sourceExtraction: SourceExtractionSummary
  ruleCoverage: SourceRuleCoverage[]
  advisoryReport: AdvisoryReport
}

export type SelectionState =
  | { status: 'empty' }
  | { status: 'reading'; name: string }
  | { status: 'selected'; info: HtmlFileInfo; content: string }
  | { status: 'error'; message: string }

export const EMPTY_STATE: SelectionState = { status: 'empty' }

export type Mode = 'html' | 'react' | 'project'

export type ProjectFileManifest = {
  relativePath: string
  status: 'accepted' | 'ignored' | 'rejected'
  byteLength: number
  reason: string | null
}

export type ProjectIntakeResponse = {
  snapshotId: string | null
  projectLabel: string | null
  completeness: 'complete' | 'partial'
  files: ProjectFileManifest[]
  counts: {
    selected: number
    accepted: number
    ignored: number
    rejected: number
    omitted: number
  }
  omissionReasons: string[]
}