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
    value.issues.every(isAnalyzeIssue)
  )
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
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const readId = useRef(0)
  const analysisInFlight = useRef(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    const currentReadId = ++readId.current
    setReport(null)
    setAnalysisError(null)

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
    readId.current += 1
    setSelection(EMPTY_STATE)
    setReport(null)
    setAnalysisError(null)
  }

  async function handleAnalyze() {
    if (selection.status !== 'selected' || analysisInFlight.current) {
      return
    }

    const currentReadId = readId.current
    analysisInFlight.current = true
    setIsAnalyzing(true)
    setAnalysisError(null)
    setReport(null)

    try {
      const response = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: selection.content,
          filename: selection.info.name,
        }),
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
      if (currentReadId === readId.current) {
        setAnalysisError(
          'Could not reach the analysis backend at localhost:3001. Make sure it is running, then try again.',
        )
      }
    } finally {
      analysisInFlight.current = false
      setIsAnalyzing(false)
    }
  }

  const announcement =
    selection.status === 'reading'
      ? `Reading ${selection.name} locally.`
      : selection.status === 'selected'
        ? isAnalyzing
          ? 'An accessibility analysis request is in progress.'
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
              <button
                className="button button-primary"
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                aria-busy={isAnalyzing}
              >
                {isAnalyzing ? 'Analyzing…' : 'Analyze HTML'}
              </button>
            </div>
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
            Analyzing HTML with the accessibility checker…
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

            <dl className="summary-grid">
              {SUMMARY_ITEMS.map(({ key, label }) => (
                <div className="summary-item" key={key}>
                  <dt>{label}</dt>
                  <dd>{new Intl.NumberFormat().format(report.summary[key])}</dd>
                </div>
              ))}
            </dl>

            <div className="findings-heading">
              <h3>Findings</h3>
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

                  return (
                    <li
                      className="finding-item"
                      key={`${issue.ruleId}-${issue.path}-${index}`}
                    >
                      <div className="finding-topline">
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
