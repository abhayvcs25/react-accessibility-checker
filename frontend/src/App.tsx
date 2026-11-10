import { useRef, useState, type ChangeEvent } from 'react'
import './App.css'

type HtmlFileInfo = {
  name: string
  size: string
  characterCount: number
  title: string | null
}

type AnalyzeIssue = {
  ruleId: string
  level: string
  message: string
  path: string
  snippet: string
  help?: string
}

type AdvisoryModelReport = {
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

type AdvisoryAssessment = {
  jobId: string
  providerId: string
  modelId: string
  targetId: string
  componentRef: string
  domPath?: string
  ruleId: string
  status: 'potential_issue' | 'no_issue_detected' | 'insufficient_context'
  explanation: string
  evidence: { id: string; text?: string }[]
  omittedEvidenceCount: number
  confidence?: number
}

type AdvisoryEquivalentFinding = {
  status: AdvisoryAssessment['status']
  evidenceRefIds: string[]
  omittedEvidenceCount: number
  modelCount: number
  jobIds: string[]
}

type AdvisoryFindingGroup = {
  targetId: string
  componentRef: string
  domPath?: string
  ruleId: string
  agreement:
    | 'unanimous_issue'
    | 'unanimous_no_issue'
    | 'insufficient_context'
    | 'disagreement'
  issueCount: number
  validatedCount: number
  assessments: AdvisoryAssessment[]
  equivalentFindings: AdvisoryEquivalentFinding[]
  relatedIbmIssueIds: string[]
  omittedIbmIssueCount: number
}

type AdvisoryJobReport = {
  jobId: string
  providerId: string
  modelId: string
  targetId: string
  componentRef: string
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

type AdvisoryReport = {
  status: 'not_run' | 'queued' | 'in_progress' | 'completed' | 'partial' | 'failed'
  models: AdvisoryModelReport[]
  jobs: AdvisoryJobReport[]
  assessmentGroups: AdvisoryFindingGroup[]
  findings: AdvisoryFindingGroup[]
  fixingPrompt: string | null
  omittedJobCount: number
  omittedPromptFindingCount: number
}

function getEquivalentModelNames(
  finding: AdvisoryFindingGroup,
  equivalent: AdvisoryEquivalentFinding,
): string[] {
  return Array.from(
    new Set(
      equivalent.jobIds.flatMap((jobId) => {
        const assessment = finding.assessments.find(
          (item) => item.jobId === jobId,
        )
        return assessment
          ? [`${assessment.providerId}/${assessment.modelId}`]
          : []
      }),
    ),
  )
}

type AnalyzeSummary = {
  total: number
  violations: number
  potentialViolations: number
  recommendations: number
  potentialRecommendations: number
  manual: number
}

type AnalyzeResponse = {
  filename: string
  analyzedAt: string
  summary: AnalyzeSummary
  issues: AnalyzeIssue[]
  advisoryReport: AdvisoryReport
}

type SelectionState =
  | { status: 'empty' }
  | { status: 'reading'; name: string }
  | { status: 'selected'; info: HtmlFileInfo; content: string }
  | { status: 'error'; message: string }

const EMPTY_STATE: SelectionState = { status: 'empty' }

const SUMMARY_ITEMS: { label: string; key: keyof AnalyzeSummary }[] = [
  { label: 'Total findings', key: 'total' },
  { label: 'Confirmed violations', key: 'violations' },
  { label: 'Potential violations', key: 'potentialViolations' },
  { label: 'Recommendations', key: 'recommendations' },
  { label: 'Potential recommendations', key: 'potentialRecommendations' },
  { label: 'Manual review', key: 'manual' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAnalyzeIssue(value: unknown): value is AnalyzeIssue {
  return (
    isRecord(value) &&
    typeof value.ruleId === 'string' &&
    typeof value.level === 'string' &&
    typeof value.message === 'string' &&
    typeof value.path === 'string' &&
    typeof value.snippet === 'string' &&
    (value.help === undefined || typeof value.help === 'string')
  )
}

function isAdvisoryAssessment(value: unknown): value is AdvisoryAssessment {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.targetId === 'string' &&
    typeof value.componentRef === 'string' &&
    (value.domPath === undefined || typeof value.domPath === 'string') &&
    typeof value.ruleId === 'string' &&
    [
      'potential_issue',
      'no_issue_detected',
      'insufficient_context',
    ].includes(String(value.status)) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        (item.text === undefined || typeof item.text === 'string'),
    ) &&
    typeof value.explanation === 'string' &&
    typeof value.omittedEvidenceCount === 'number' &&
    (value.confidence === undefined ||
      (typeof value.confidence === 'number' &&
        Number.isFinite(value.confidence)))
  )
}

function isAdvisoryModelReport(
  value: unknown,
): value is AdvisoryModelReport {
  return (
    isRecord(value) &&
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.eligibility === 'string' &&
    [
      'blocked',
      'not_run',
      'queued',
      'in_progress',
      'completed',
      'partial',
      'failed',
      'quota_limited',
    ].includes(String(value.status)) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    ['jobCount', 'validatedCount', 'invalidCount', 'notValidatedCount', 'failedCount']
      .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) &&
    typeof value.quotaLimited === 'boolean'
  )
}

function isAdvisoryFindingGroup(value: unknown): value is AdvisoryFindingGroup {
  return (
    isRecord(value) &&
    typeof value.targetId === 'string' &&
    typeof value.componentRef === 'string' &&
    (value.domPath === undefined || typeof value.domPath === 'string') &&
    typeof value.ruleId === 'string' &&
    [
      'unanimous_issue',
      'unanimous_no_issue',
      'insufficient_context',
      'disagreement',
    ].includes(String(value.agreement)) &&
    typeof value.issueCount === 'number' &&
    typeof value.validatedCount === 'number' &&
    Array.isArray(value.assessments) &&
    value.assessments.every(isAdvisoryAssessment) &&
    Array.isArray(value.equivalentFindings) &&
    value.equivalentFindings.every(
      (item) =>
        isRecord(item) &&
        typeof item.status === 'string' &&
        Array.isArray(item.evidenceRefIds) &&
        item.evidenceRefIds.every((reference) => typeof reference === 'string') &&
        typeof item.omittedEvidenceCount === 'number' &&
        typeof item.modelCount === 'number' &&
        Array.isArray(item.jobIds) &&
        item.jobIds.every((jobId) => typeof jobId === 'string'),
    ) &&
    Array.isArray(value.relatedIbmIssueIds) &&
    value.relatedIbmIssueIds.every((item) => typeof item === 'string') &&
    typeof value.omittedIbmIssueCount === 'number'
  )
}

function isAdvisoryJobReport(value: unknown): value is AdvisoryJobReport {
  return (
    isRecord(value) &&
    [
      'jobId',
      'providerId',
      'modelId',
      'targetId',
      'componentRef',
      'ruleId',
    ].every((key) => typeof value[key] === 'string') &&
    [
      'queued',
      'in_progress',
      'succeeded',
      'invalid_response',
      'retryable_failed',
      'permanent_failed',
      'blocked',
      'unknown_outcome',
    ].includes(String(value.status)) &&
    ['valid', 'invalid', 'not_run'].includes(String(value.validationStatus)) &&
    (value.errorClass === null || typeof value.errorClass === 'string') &&
    (value.providerRequestId === null ||
      typeof value.providerRequestId === 'string') &&
    (value.inputTokens === null || typeof value.inputTokens === 'number') &&
    (value.outputTokens === null || typeof value.outputTokens === 'number') &&
    ['provider', 'estimated', 'unknown'].includes(
      String(value.tokenUsageSource),
    )
  )
}

function isAdvisoryReport(value: unknown): value is AdvisoryReport {
  return (
    isRecord(value) &&
    ['not_run', 'queued', 'in_progress', 'completed', 'partial', 'failed'].includes(
      String(value.status),
    ) &&
    Array.isArray(value.models) &&
    value.models.every(isAdvisoryModelReport) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isAdvisoryJobReport) &&
    Array.isArray(value.assessmentGroups) &&
    value.assessmentGroups.every(isAdvisoryFindingGroup) &&
    Array.isArray(value.findings) &&
    value.findings.every(isAdvisoryFindingGroup) &&
    (value.fixingPrompt === null ||
      (typeof value.fixingPrompt === 'string' &&
        value.fixingPrompt.length <= 16_000)) &&
    typeof value.omittedJobCount === 'number' &&
    Number.isSafeInteger(value.omittedJobCount) &&
    value.omittedJobCount >= 0 &&
    typeof value.omittedPromptFindingCount === 'number' &&
    Number.isSafeInteger(value.omittedPromptFindingCount) &&
    value.omittedPromptFindingCount >= 0
  )
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (!isRecord(value) || !isRecord(value.summary)) {
    return false
  }

  const summary = value.summary
  const summaryKeys: (keyof AnalyzeSummary)[] = [
    'total',
    'violations',
    'potentialViolations',
    'recommendations',
    'potentialRecommendations',
    'manual',
  ]

  return (
    typeof value.filename === 'string' &&
    typeof value.analyzedAt === 'string' &&
    !Number.isNaN(Date.parse(value.analyzedAt)) &&
    summaryKeys.every(
      (key) =>
        typeof summary[key] === 'number' &&
        Number.isFinite(summary[key]),
    ) &&
    Array.isArray(value.issues) &&
    value.issues.every(isAnalyzeIssue) &&
    isAdvisoryReport(value.advisoryReport)
  )
}

function getEmptyAssessmentMessage(report: AdvisoryReport): string {
  if (report.status === 'not_run') {
    return getAdvisoryStatusMessage(report)
  }
  if (report.status === 'failed') {
    return 'No validated assessments are available. Failed, blocked, and invalid jobs are not shown as findings; inspect the per-model and per-job outcomes.'
  }
  if (report.status === 'queued' || report.status === 'in_progress') {
    return 'No validated assessment groups are available yet. Queued or running jobs are not treated as findings.'
  }
  if (report.status === 'partial') {
    return 'No validated assessment groups are available. Some jobs may have failed or remained incomplete; those outcomes are not treated as negative results.'
  }
  return 'No validated assessment groups were returned.'
}

function getEmptyPromptMessage(report: AdvisoryReport): string {
  if (report.findings.length === 0 && report.assessmentGroups.length > 0) {
    return 'No prompt was generated because validated assessments did not identify a potential issue. “No issue detected” and “insufficient context” results are not turned into fixes.'
  }
  if (report.status === 'failed') {
    return 'No prompt was generated because there are no validated actionable results. Failed, blocked, and invalid assessments are never used as fixing instructions.'
  }
  if (report.status === 'queued' || report.status === 'in_progress') {
    return 'No prompt is available yet. A prompt is generated only from validated actionable results.'
  }
  return 'No prompt was generated because there are no validated actionable advisory findings.'
}

function getIssueCategory(level: string): string {
  switch (level.toLowerCase()) {
    case 'violation':
      return 'Confirmed violation'
    case 'potentialviolation':
      return 'Potential violation'
    case 'recommendation':
      return 'Recommendation'
    case 'potentialrecommendation':
      return 'Potential recommendation'
    case 'manual':
      return 'Manual review'
    default:
      return level || 'Finding'
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'unanimous_issue':
      return 'Potential violation'
    case 'unanimous_no_issue':
      return 'No issue detected'
    case 'disagreement':
      return 'Disagreement'
    case 'insufficient_context':
      return 'Insufficient context (abstention)'
    case 'potential_issue':
      return 'Potential issue'
    case 'no_issue_detected':
      return 'No issue detected'
    default:
      return status.replaceAll('_', ' ')
  }
}

function getAdvisoryStatusMessage(report: AdvisoryReport): string {
  const validatedCount = report.models.reduce(
    (total, model) => total + model.validatedCount,
    0,
  )
  const allModelsBlocked =
    report.models.length > 0 &&
    report.models.every((model) => model.status === 'blocked')

  switch (report.status) {
    case 'not_run':
      return allModelsBlocked
        ? 'No model assessments ran because every configured model is blocked. Review each eligibility reason below.'
        : 'No model assessment jobs have run. Review the model states below; no result is a negative assessment.'
    case 'queued':
      return 'Assessment jobs are queued and have not produced validated results yet.'
    case 'in_progress':
      return 'Assessment jobs are still in progress. Only validated results are included below.'
    case 'completed':
      return 'All reported jobs completed with validated results. This advisory output is not an IBM finding or a conformance determination.'
    case 'partial':
      return `${validatedCount} assessment(s) were validated; other work was blocked, invalid, failed, or not completed. Missing results are not negative assessments.`
    case 'failed':
      return 'No validated assessment results are available. Review model and job states below for blocked, invalid, or failed work.'
  }
}

function getSafeHelpUrl(help: string): string | null {
  try {
    const url = new URL(help)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null
  } catch {
    return null
  }
}

function isHtmlFile(file: File): boolean {
  return /\.(html|htm)$/i.test(file.name)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(size)} ${units[unitIndex]}`
}

function getDocumentTitle(content: string): string | null {
  const document = new DOMParser().parseFromString(content, 'text/html')
  const title = document.querySelector('title')?.textContent?.trim()
  return title || null
}

function App() {
  const [selection, setSelection] = useState<SelectionState>(EMPTY_STATE)
  const [report, setReport] = useState<AnalyzeResponse | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisCancelled, setAnalysisCancelled] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [copyPromptFeedback, setCopyPromptFeedback] = useState<string | null>(
    null,
  )
  const readId = useRef(0)
  const analysisInFlight = useRef(false)
  const analysisController = useRef<AbortController | null>(null)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    analysisController.current?.abort()
    const currentReadId = ++readId.current
    setReport(null)
    setAnalysisCancelled(false)
    setAnalysisError(null)
    setCopyPromptFeedback(null)

    if (!isHtmlFile(file)) {
      setSelection({
        status: 'error',
        message: 'Choose an HTML file ending in .html or .htm.',
      })
      return
    }

    setSelection({ status: 'reading', name: file.name })

    try {
      const content = await file.text()

      if (currentReadId !== readId.current) {
        return
      }

      setSelection({
        status: 'selected',
        content,
        info: {
          name: file.name,
          size: formatFileSize(file.size),
          characterCount: content.length,
          title: getDocumentTitle(content),
        },
      })
    } catch {
      if (currentReadId !== readId.current) {
        return
      }

      setSelection({
        status: 'error',
        message: `Couldn't read ${file.name}. Try selecting another HTML file.`,
      })
    }
  }

  function clearSelection() {
    analysisController.current?.abort()
    readId.current += 1
    setSelection(EMPTY_STATE)
    setReport(null)
    setAnalysisCancelled(false)
    setAnalysisError(null)
    setCopyPromptFeedback(null)
  }

  async function handleAnalyze() {
    if (selection.status !== 'selected' || analysisInFlight.current) {
      return
    }

    const currentReadId = readId.current
    const controller = new AbortController()
    analysisController.current = controller
    analysisInFlight.current = true
    setIsAnalyzing(true)
    setAnalysisCancelled(false)
    setAnalysisError(null)
    setReport(null)
    setCopyPromptFeedback(null)

    try {
      const response = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: selection.content,
          filename: selection.info.name,
        }),
        signal: controller.signal,
      })

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }

      if (currentReadId !== readId.current) {
        return
      }

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `The analysis backend returned HTTP ${response.status}.`
        setAnalysisError(message)
        return
      }

      if (!isAnalyzeResponse(payload)) {
        setAnalysisError(
          'The analysis backend returned an invalid response. Please try again.',
        )
        return
      }

      setReport(payload)
    } catch {
      if (controller.signal.aborted) {
        if (currentReadId === readId.current) {
          setAnalysisCancelled(true)
        }
      } else if (currentReadId === readId.current) {
        setAnalysisError(
          'Could not reach the analysis backend at localhost:3001. Make sure it is running, then try again.',
        )
      }
    } finally {
      if (analysisController.current === controller) {
        analysisController.current = null
      }
      analysisInFlight.current = false
      setIsAnalyzing(false)
    }
  }

  function handleCancelAnalysis() {
    analysisController.current?.abort()
  }

  async function handleCopyFixingPrompt() {
    const prompt = report?.advisoryReport.fixingPrompt
    if (!prompt) {
      return
    }

    try {
      await navigator.clipboard.writeText(prompt)
      setCopyPromptFeedback('Fixing prompt copied.')
    } catch {
      setCopyPromptFeedback(
        'Could not copy the fixing prompt. Select and copy the prompt text manually.',
      )
    }
  }

  const announcement =
    selection.status === 'reading'
      ? `Reading ${selection.name} locally.`
      : selection.status === 'selected'
        ? isAnalyzing
          ? analysisCancelled
            ? 'Stopped waiting for the analysis response. Server processing may continue.'
            : 'An accessibility analysis request is in progress.'
          : report
            ? `Analysis complete for ${report.filename}. ${report.summary.total} findings reported.`
            : `${selection.info.name} is ready for analysis.`
        : selection.status === 'error'
          ? selection.message
          : analysisError ?? ''

  return (
    <main className="page-shell">
      <header className="site-header">
        <div className="brand" aria-label="React Accessibility Checker">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>AccessCheck</span>
        </div>
        <span className="stage-label">HTML checker</span>
      </header>

      <section className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow">A clearer place to begin</p>
          <h1 id="page-title">Check an HTML file</h1>
          <p className="intro-copy">
            File selection and preview stay in your browser. When you choose to
            analyze, the HTML contents are sent to the local analysis backend
            at localhost:3001.
          </p>
        </div>

        <section className="file-panel" aria-labelledby="file-panel-title">
          <div className="panel-heading">
            <span className="step-number" aria-hidden="true">
              01
            </span>
            <div>
              <h2 id="file-panel-title">Select your file</h2>
              <p>HTML documents only</p>
            </div>
          </div>

          <div className="file-picker-area">
            <div className="file-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <path
                  d="M13 5.75h14l9 9v27.5H13a3 3 0 0 1-3-3v-30a3.5 3.5 0 0 1 3-3.5Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M27 6v10h9M17 25h15M17 31h15M17 37h9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3>
              {selection.status === 'selected'
                ? 'Your file is ready'
                : selection.status === 'reading'
                  ? 'Reading your file'
                  : 'Choose an HTML file'}
            </h3>
            <p className="picker-copy">
              {selection.status === 'reading'
                ? `Reading ${selection.name} on this device…`
                : 'Select a .html or .htm file from your device.'}
            </p>

            <div className="picker-control">
              <input
                className="file-input"
                id="html-file"
                type="file"
                accept=".html,.htm,text/html"
                aria-describedby="file-help"
                onChange={handleFileChange}
              />
              <label className="button button-primary" htmlFor="html-file">
                {selection.status === 'selected'
                  ? 'Choose another file'
                  : 'Browse files'}
              </label>
            </div>
            <p className="file-help" id="file-help">
              Accepted formats: .html, .htm
            </p>
          </div>

          <p className="privacy-note">
            <span className="privacy-dot" aria-hidden="true" />
            Read locally; HTML is sent to localhost:3001 only when you analyze.
          </p>
        </section>

        {selection.status === 'selected' && (
          <section className="file-details" aria-labelledby="details-title">
            <div className="details-heading">
              <div>
                <p className="eyebrow">Selected document</p>
                <h2 id="details-title">File information</h2>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={clearSelection}
              >
                Clear file
              </button>
            </div>
            <dl className="details-grid">
              <div className="detail-item detail-item-wide">
                <dt>Filename</dt>
                <dd title={selection.info.name}>{selection.info.name}</dd>
              </div>
              <div className="detail-item">
                <dt>File size</dt>
                <dd>{selection.info.size}</dd>
              </div>
              <div className="detail-item">
                <dt>Characters</dt>
                <dd>
                  {new Intl.NumberFormat().format(
                    selection.info.characterCount,
                  )}
                </dd>
              </div>
              <div className="detail-item detail-item-wide">
                <dt>Document title</dt>
                <dd>{selection.info.title ?? 'No title found'}</dd>
              </div>
            </dl>
            <p className="analysis-note">
              File details are read locally. Choose Analyze HTML to send its
              contents to the local backend and run the accessibility check.
            </p>
            <div className="analysis-actions">
              {isAnalyzing ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={handleCancelAnalysis}
                >
                  Stop waiting
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleAnalyze}
                >
                  Analyze HTML
                </button>
              )}
            </div>
            {isAnalyzing && (
              <p className="analysis-note">
                Stopping closes the browser request; the backend may continue
                processing.
              </p>
            )}
          </section>
        )}

        {selection.status === 'error' && (
          <p className="error-message" role="alert">
            <span aria-hidden="true">!</span>
            {selection.message}
          </p>
        )}

        {isAnalyzing && (
          <p className="loading-message" role="status" aria-live="polite">
            <span className="loading-indicator" aria-hidden="true" />
            {analysisCancelled
              ? 'Stopped waiting in this browser. The server may continue processing; no report will be shown for this request.'
              : 'Analyzing HTML with the accessibility checker…'}
          </p>
        )}

        {analysisCancelled && !isAnalyzing && (
          <p className="empty-findings" role="status">
            The browser stopped waiting for the analysis response. The backend
            may have continued processing this request. No result was received;
            analyze again when ready.
          </p>
        )}

        {analysisError && (
          <p className="error-message" role="alert">
            <span aria-hidden="true">!</span>
            {analysisError}
          </p>
        )}

        {report && (
          <section className="analysis-report" aria-labelledby="report-title">
            <div className="report-heading">
              <div>
                <p className="eyebrow">Analysis results</p>
                <h2 id="report-title">Accessibility report</h2>
              </div>
              <p className="report-meta">
                <strong>{report.filename}</strong>
                <time dateTime={report.analyzedAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(report.analyzedAt))}
                </time>
              </p>
            </div>

            <h3 className="results-section-title">IBM Equal Access summary</h3>
            <dl className="summary-grid">
              {SUMMARY_ITEMS.map(({ key, label }) => (
                <div className="summary-item" key={key}>
                  <dt>{label}</dt>
                  <dd>{new Intl.NumberFormat().format(report.summary[key])}</dd>
                </div>
              ))}
            </dl>

            <div className="findings-heading">
              <h3>IBM Equal Access findings</h3>
              <span>{report.issues.length}</span>
            </div>
            {report.issues.length === 0 ? (
              <p className="empty-findings">No findings reported.</p>
            ) : (
              <ol className="finding-list">
                {report.issues.map((issue, index) => {
                  const helpUrl = issue.help
                    ? getSafeHelpUrl(issue.help)
                    : null
                  const ibmIssueId = `IBM-${String(index + 1).padStart(2, '0')}`

                  return (
                    <li
                      className="finding-item"
                      key={ibmIssueId}
                    >
                      <div className="finding-topline">
                        <code className="ibm-issue-id">{ibmIssueId}</code>
                        <span
                          className="finding-category"
                          data-level={issue.level.toLowerCase()}
                        >
                          {getIssueCategory(issue.level)}
                        </span>
                        <code className="finding-rule">{issue.ruleId}</code>
                      </div>
                      <p className="finding-message">{issue.message}</p>
                      <dl className="finding-details">
                        <div>
                          <dt>DOM path</dt>
                          <dd>
                            <code>{issue.path || 'Not provided'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>HTML snippet</dt>
                          <dd>
                            <pre>
                              <code>{issue.snippet || 'No snippet provided'}</code>
                            </pre>
                          </dd>
                        </div>
                      </dl>
                      {helpUrl && (
                        <a
                          className="help-link"
                          href={helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Learn more
                          <span className="visually-hidden">
                            {' '}
                            about {issue.ruleId} (opens in a new tab)
                          </span>
                        </a>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}

            <section className="advisory-report" aria-labelledby="advisory-report-title">
              <div className="findings-heading">
                <h3 id="advisory-report-title">
                  Separate AI assessments and findings
                </h3>
                <span
                  aria-label={`${report.advisoryReport.assessmentGroups.length} validated assessment groups`}
                >
                  {report.advisoryReport.assessmentGroups.length}
                </span>
              </div>
              <p className="advisory-report-note" role="status">
                {getAdvisoryStatusMessage(report.advisoryReport)} Advisory
                assessments never change IBM findings or counts and do not
                establish WCAG conformance.
              </p>
              <p className="advisory-count-note">
                {report.advisoryReport.assessmentGroups.length} validated
                assessment group(s);{' '}
                {report.advisoryReport.findings.length} group(s) include at
                least one potential issue.
              </p>
              <ul className="advisory-model-list">
                {report.advisoryReport.models.map((model) => (
                  <li
                    className="advisory-model-item"
                    key={`${model.providerId}-${model.modelId}`}
                  >
                    <div className="advisory-model-heading">
                      <strong>{model.modelId}</strong>
                      <span className="advisory-status">
                        {formatStatus(model.status)}
                      </span>
                    </div>
                    <p>
                      Provider: {model.providerId}; eligibility:{' '}
                      {formatStatus(model.eligibility)};{' '}
                      {model.jobCount === 0
                        ? 'no assessment jobs scheduled'
                        : `validated ${model.validatedCount} of ${model.jobCount} jobs`}; invalid{' '}
                      {model.invalidCount}; not validated{' '}
                      {model.notValidatedCount}; failed {model.failedCount}
                      {model.quotaLimited ? '; provider quota limited' : ''}.
                    </p>
                    {model.reason && <p>{model.reason}</p>}
                  </li>
                ))}
              </ul>

              {report.advisoryReport.jobs.length > 0 && (
                <details className="advisory-job-details">
                  <summary>
                    Per-job outcomes ({report.advisoryReport.jobs.length})
                  </summary>
                  <ul className="advisory-job-list">
                    {report.advisoryReport.jobs.map((job) => (
                      <li key={job.jobId}>
                        <code>
                          {job.providerId}/{job.modelId}
                        </code>{' '}
                        — target <code>{job.targetId}</code>, rule{' '}
                        <code>{job.ruleId}</code>: {formatStatus(job.status)};{' '}
                        validation {formatStatus(job.validationStatus)}
                        {job.errorClass ? `; ${job.errorClass}` : ''}
                        {job.providerRequestId
                          ? `; request ${job.providerRequestId}`
                          : ''}
                        {`; tokens in ${
                          job.inputTokens ?? 'unknown'
                        }, out ${
                          job.outputTokens ?? 'unknown'
                        } (${job.tokenUsageSource})`}
                        .
                      </li>
                    ))}
                  </ul>
                  {report.advisoryReport.omittedJobCount > 0 && (
                    <p>
                      {report.advisoryReport.omittedJobCount} additional jobs
                      are omitted from this report.
                    </p>
                  )}
                </details>
              )}

              {report.advisoryReport.assessmentGroups.length === 0 ? (
                <p className="empty-findings">
                  {getEmptyAssessmentMessage(report.advisoryReport)}
                </p>
              ) : (
                <ol className="advisory-finding-list">
                  {report.advisoryReport.assessmentGroups.map((finding) => (
                    <li
                      className="advisory-finding-item"
                      key={`${finding.targetId}-${finding.ruleId}`}
                    >
                      <div className="finding-topline">
                        <span className="advisory-tag">
                          {formatStatus(finding.agreement)}
                        </span>
                        <span className="advisory-tag advisory-tag-subtle">
                          {finding.issueCount} of {finding.validatedCount}{' '}
                          flagged an issue
                        </span>
                        <code className="finding-rule">{finding.ruleId}</code>
                      </div>
                      <dl className="finding-details">
                        <div>
                          <dt>Component</dt>
                          <dd>
                            <code>{finding.componentRef}</code> (target{' '}
                            <code>{finding.targetId}</code>)
                          </dd>
                        </div>
                        {finding.domPath && (
                          <div>
                            <dt>DOM path</dt>
                            <dd>
                              <code>{finding.domPath}</code>
                            </dd>
                          </div>
                        )}
                        {finding.relatedIbmIssueIds.length > 0 && (
                          <div>
                            <dt>Separate IBM references</dt>
                            <dd>
                              {finding.relatedIbmIssueIds.join(', ')}
                              {finding.omittedIbmIssueCount > 0
                                ? `, plus ${finding.omittedIbmIssueCount} omitted`
                                : ''}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <div className="advisory-equivalent-findings">
                        <strong>
                          Exact matching validated assessments (same status,
                          explanation, and evidence references)
                        </strong>
                        <ul>
                          {finding.equivalentFindings.map((equivalent) => (
                            <li
                              key={`${equivalent.status}-${equivalent.jobIds.join(',')}`}
                            >
                              {formatStatus(equivalent.status)} from{' '}
                              {equivalent.modelCount} model(s)
                              {': '}
                              {getEquivalentModelNames(
                                finding,
                                equivalent,
                              ).join(', ')}
                              ; evidence refs:{' '}
                              {equivalent.evidenceRefIds.length > 0
                                ? equivalent.evidenceRefIds.join(', ')
                                : 'none'}
                              {equivalent.omittedEvidenceCount > 0
                                ? `, plus ${equivalent.omittedEvidenceCount} omitted`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <ul className="advisory-assessment-list">
                        {finding.assessments.map((assessment) => (
                          <li key={assessment.jobId}>
                            <strong>
                              {assessment.providerId}/{assessment.modelId}
                            </strong>
                            : {formatStatus(assessment.status)} —{' '}
                            {assessment.explanation}
                            <span className="advisory-assessment-location">
                              {' '}
                              Component <code>{assessment.componentRef}</code>
                              {assessment.domPath
                                ? `; DOM path ${assessment.domPath}`
                                : ''}
                              .
                            </span>
                            {assessment.confidence !== undefined && (
                              <span>
                                {' '}
                                Model-reported confidence (uncalibrated):{' '}
                                {assessment.confidence.toFixed(2)}.
                              </span>
                            )}
                            {assessment.evidence.length > 0 && (
                              <ul className="advisory-evidence-list">
                                {assessment.evidence.map((evidence) => (
                                  <li key={evidence.id}>
                                    <code>{evidence.id}</code>
                                    {evidence.text
                                      ? ` — ${evidence.text}`
                                      : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {assessment.omittedEvidenceCount > 0 && (
                              <span>
                                {' '}
                                {assessment.omittedEvidenceCount} additional
                                evidence references omitted.
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}

              <section className="fixing-prompt" aria-labelledby="fixing-prompt-title">
                <div className="fixing-prompt-heading">
                  <h4 id="fixing-prompt-title">Consolidated fixing prompt</h4>
                  {report.advisoryReport.fixingPrompt && (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={handleCopyFixingPrompt}
                    >
                      Copy prompt
                    </button>
                  )}
                </div>
                <p>
                  This prompt is read-only here. Your external coding assistant
                  decides whether to make edits; this application never changes
                  project files.
                </p>
                {report.advisoryReport.fixingPrompt ? (
                  <pre className="fixing-prompt-content">
                    {report.advisoryReport.fixingPrompt}
                  </pre>
                ) : (
                  <p className="empty-findings">
                    {getEmptyPromptMessage(report.advisoryReport)}
                  </p>
                )}
                {report.advisoryReport.omittedPromptFindingCount > 0 && (
                  <p>
                    {report.advisoryReport.omittedPromptFindingCount} additional
                    findings are omitted from the bounded prompt.
                  </p>
                )}
                {copyPromptFeedback && (
                  <p className="copy-prompt-feedback" role="status">
                    {copyPromptFeedback}
                  </p>
                )}
              </section>
            </section>
          </section>
        )}

        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>
      </section>

      <footer className="site-footer">
        <span>React Accessibility Checker</span>
        <span>Local file selection</span>
      </footer>
    </main>
  )
}

export default App
