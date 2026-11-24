import { useRef, useState } from 'react'
import { ModeSelector } from './components/ModeSelector'
import { FilePicker } from './components/FilePicker'
import { ProjectFolderPicker } from './components/ProjectFolderPicker'
import { ProjectManifest } from './components/ProjectManifest'
import { FileDetails } from './components/FileDetails'
import { AnalysisActions } from './components/AnalysisActions'
import { AnalysisReport } from './components/AnalysisReport'
import { SourceReport } from './components/SourceReport'
import { type AnalyzeResponse, type SourceAnalyzeResponse, type SelectionState, type Mode, type ProjectIntakeResponse, EMPTY_STATE } from './types'
import './App.css'



function App() {
  const [mode, setMode] = useState<Mode>('html')
  const [selection, setSelection] = useState<SelectionState>(EMPTY_STATE)
  const [report, setReport] = useState<AnalyzeResponse | null>(null)
  const [sourceReport, setSourceReport] = useState<SourceAnalyzeResponse | null>(null)
  const [projectManifest, setProjectManifest] = useState<ProjectIntakeResponse | null>(null)
  const [selectedProjectFiles, setSelectedProjectFiles] = useState<File[]>([])
  const [projectLabel, setProjectLabel] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisCancelled, setAnalysisCancelled] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const readId = useRef(0)
  const analysisInFlight = useRef(false)
  const analysisController = useRef<AbortController | null>(null)

  function clearSelection() {
    analysisController.current?.abort()
    readId.current += 1
    setSelection(EMPTY_STATE)
    setReport(null)
    setSourceReport(null)
    setProjectManifest(null)
    setSelectedProjectFiles([])
    setProjectLabel(null)
    setAnalysisCancelled(false)
    setAnalysisError(null)
  }

  function handleModeSwitch(newMode: Mode) {
    if (newMode === mode) return
    analysisController.current?.abort()
    readId.current += 1
    setMode(newMode)
    setSelection(EMPTY_STATE)
    setReport(null)
    setSourceReport(null)
    setProjectManifest(null)
    setSelectedProjectFiles([])
    setProjectLabel(null)
    setAnalysisCancelled(false)
    setAnalysisError(null)
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
    setSourceReport(null)

    try {
      const endpoint =
        mode === 'html'
          ? 'http://localhost:3001/api/analyze'
          : 'http://localhost:3001/api/analyze-source'
      const requestBody =
        mode === 'html'
          ? JSON.stringify({
              html: selection.content,
              filename: selection.info.name,
            })
          : JSON.stringify({
              source: selection.content,
              filename: selection.info.name,
            })

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
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
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof (payload as Record<string, unknown>).error === 'string'
            ? (payload as Record<string, unknown>).error as string
            : `The analysis backend returned HTTP ${response.status}.`
        setAnalysisError(message)
        return
      }

      if (mode === 'html') {
        if (!isAnalyzeResponse(payload)) {
          setAnalysisError(
            'The analysis backend returned an invalid response. Please try again.',
          )
          return
        }
        setReport(payload)
      } else {
        if (!isSourceAnalyzeResponse(payload)) {
          setAnalysisError(
            'The analysis backend returned an invalid response. Please try again.',
          )
          return
        }
        setSourceReport(payload)
      }
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

  async function handleProjectIntake() {
    if (!projectManifest || projectManifest.files.length === 0 || selectedProjectFiles.length === 0) return

    const currentReadId = ++readId.current
    analysisController.current?.abort()
    const controller = new AbortController()
    analysisController.current = controller
    analysisInFlight.current = true
    setIsAnalyzing(true)
    setAnalysisCancelled(false)
    setAnalysisError(null)

    try {
      const formData = new FormData()
      if (projectLabel) {
        formData.append('projectLabel', projectLabel)
      }

      const filesToSend = selectedProjectFiles.filter((_file, index) => {
        const manifestEntry = projectManifest?.files[index]
        return manifestEntry?.status === 'accepted'
      })

      for (const file of filesToSend) {
        const relativePath = file.webkitRelativePath?.trim() || file.name
        formData.append('files', file, relativePath)
      }

      console.log(`[project-intake] Uploading ${filesToSend.length} files to /api/project-intake...`)

      const response = await fetch('http://localhost:3001/api/project-intake', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof (payload as Record<string, unknown>).error === 'string'
            ? (payload as Record<string, unknown>).error as string
            : `The backend returned HTTP ${response.status}.`
        setAnalysisError(message)
        return
      }

      if (currentReadId !== readId.current) return

      const serverManifest = payload as ProjectIntakeResponse
      setProjectManifest(serverManifest)
      console.log('[project-intake] Server response:', serverManifest)
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

  const activeFilename = report ? report.filename : sourceReport ? sourceReport.filename : null
  const activeFindingsCount = report ? report.summary.total : sourceReport ? sourceReport.advisoryReport.findings.length : 0

  const announcement =
    selection.status === 'reading'
      ? `Reading ${selection.name} locally.`
      : selection.status === 'selected'
        ? isAnalyzing
          ? analysisCancelled
            ? 'Stopped waiting for the analysis response. Server processing may continue.'
            : 'An accessibility analysis request is in progress.'
          : activeFilename
            ? `Analysis complete for ${activeFilename}. ${activeFindingsCount} findings reported.`
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
        <span className="stage-label">
          {mode === 'html'
            ? 'HTML checker'
            : mode === 'react'
              ? 'React source checker'
              : 'React project checker'}
        </span>
      </header>

      <section className="workspace" aria-labelledby="page-title">
        <ModeSelector
          mode={mode}
          onModeChange={handleModeSwitch}
          analysisController={analysisController}
          readId={readId}
        />

        <div className="intro">
          <p className="eyebrow">
            {mode === 'html'
              ? 'A clearer place to begin'
              : mode === 'react'
                ? 'Static source accessibility'
                : 'Project folder accessibility'}
          </p>
          <h1 id="page-title">
            {mode === 'html'
              ? 'Check an HTML file'
              : mode === 'react'
                ? 'Check a React source file'
                : 'Check a React project folder'}
          </h1>
          <p className="intro-copy">
            {mode === 'html'
              ? 'File selection and preview stay in your browser. When you choose to analyze, the HTML contents are sent to the local analysis backend at localhost:3001.'
              : mode === 'react'
                ? 'Static AST-based accessibility analysis for one React source file. Source is read in your browser; when you click Analyze, bounded excerpts are assessed by the local backend and configured AI models. IBM Equal Access is not run for source input.'
                : 'Select a React project folder. The folder structure is indexed locally. File contents are sent to the backend only when you start analysis. Eligible HTML projections go to the local IBM checker; bounded evidence excerpts go to configured AI models. Secrets and dependencies are filtered out.'}
          </p>
        </div>

        {mode !== 'project' && (
          <>
            <section className="file-panel" aria-labelledby="file-panel-title">
              <div className="panel-heading">
                <span className="step-number" aria-hidden="true">01</span>
                <div>
                  <h2 id="file-panel-title">Select your file</h2>
                  <p>
                    {mode === 'html'
                      ? 'HTML documents only'
                      : mode === 'react'
                        ? 'React JSX / TSX only'
                        : 'React project folder'}
                  </p>
                </div>
              </div>
              <FilePicker mode={mode} selection={selection} setSelection={setSelection} />
              <p className="privacy-note">
                <span className="privacy-dot" aria-hidden="true" />
                {mode === 'html'
                  ? 'Read locally; HTML is sent to localhost:3001 only when you analyze.'
                  : 'Read locally; source is analyzed only when you start analysis. Bounded source excerpts may be sent to configured external AI model providers. No credentials or private model configurations are exposed.'}
              </p>
            </section>
          </>
        )}

        {mode === 'project' && (
          <section className="file-panel" aria-labelledby="project-panel-title">
            <div className="panel-heading">
              <span className="step-number" aria-hidden="true">01</span>
              <div>
                <h2 id="project-panel-title">Select project folder</h2>
                <p>React project folder</p>
              </div>
            </div>

            <ProjectFolderPicker
              projectManifest={projectManifest}
              setProjectManifest={setProjectManifest}
              selectedProjectFiles={selectedProjectFiles}
              setSelectedProjectFiles={setSelectedProjectFiles}
              projectLabel={projectLabel}
              setProjectLabel={setProjectLabel}
              setAnalysisCancelled={setAnalysisCancelled}
              setAnalysisError={setAnalysisError}
              analysisController={analysisController}
              readId={readId}
              onProjectIntake={handleProjectIntake}
            />

            {projectManifest && projectManifest.files.length > 0 && (
              <ProjectManifest manifest={projectManifest} />
            )}

            <p className="analysis-note">
              Folder selection is local. When analysis is available, eligible HTML projections will be sent to the local IBM checker and bounded evidence excerpts to configured AI models.
            </p>
            <AnalysisActions
              isAnalyzing={isAnalyzing}
              onAnalyze={handleProjectIntake}
              onCancel={handleCancelAnalysis}
              mode="project"
              disabled={!projectManifest || projectManifest.files.length === 0}
            />
            {isAnalyzing && (
              <p className="analysis-note">
                Stopping closes the browser request; the backend may continue processing.
              </p>
            )}
          </section>
        )}

        {selection.status === 'selected' && (
          <>
            <FileDetails info={selection.info} mode={mode} onClear={clearSelection} />
            <p className="analysis-note">
              {mode === 'html'
                ? 'File details are read locally. Choose Analyze HTML to send its contents to the local backend and run the accessibility check.'
                : 'File details are read locally. Choose Analyze React source to extract static JSX accessibility evidence and run contextual advisory checks.'}
            </p>
            <AnalysisActions
              isAnalyzing={isAnalyzing}
              onAnalyze={handleAnalyze}
              onCancel={handleCancelAnalysis}
              mode={mode}
            />
            {isAnalyzing && (
              <p className="analysis-note">
                Stopping closes the browser request; the backend may continue
                processing.
              </p>
            )}
          </>
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
              : mode === 'project'
                ? 'Indexing project folder…'
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
          <AnalysisReport
            report={report}
            advisoryReport={report.advisoryReport}
          />
        )}

        {sourceReport && (
          <SourceReport sourceReport={sourceReport} />
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAnalyzeIssue(value: unknown): value is { ruleId: string; level: string; message: string; path: string; snippet: string; help?: string } {
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
  const summaryKeys: (keyof AnalyzeResponse['summary'])[] = [
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

function isSourceAnalyzeResponse(value: unknown): value is SourceAnalyzeResponse {
  if (!isRecord(value)) return false
  if (typeof value.filename !== 'string') return false
  if (typeof value.analyzedAt !== 'string') return false
  if (value.ibmStatus !== 'not_run_source_input') return false
  if (typeof value.ibmStatusNote !== 'string') return false
  if (!isRecord(value.sourceExtraction)) return false
  if (typeof value.sourceExtraction.totalTargets !== 'number') return false
  if (!isRecord(value.sourceExtraction.targetsByKind)) return false
  if (!Array.isArray(value.ruleCoverage)) return false
  if (!isAdvisoryReport(value.advisoryReport)) return false
  return true
}

function isAdvisoryReport(value: unknown): value is import('./types').AdvisoryReport {
  return (
    isRecord(value) &&
    ['not_run', 'queued', 'in_progress', 'completed', 'partial', 'failed'].includes(
      String(value.status),
    ) &&
    Array.isArray(value.models) &&
    value.models.every((m: unknown) => isRecord(m) && typeof m.providerId === 'string' && typeof m.modelId === 'string') &&
    Array.isArray(value.jobs) &&
    Array.isArray(value.assessmentGroups) &&
    Array.isArray(value.findings) &&
    (value.fixingPrompt === null || typeof value.fixingPrompt === 'string') &&
    typeof value.omittedJobCount === 'number' &&
    typeof value.omittedPromptFindingCount === 'number'
  )
}

export default App