import { type AdvisoryReport } from '../types'

interface FixingPromptProps {
  advisoryReport: AdvisoryReport
  onCopy: () => Promise<void>
  copyFeedback: string | null
}

export function FixingPrompt({ advisoryReport, onCopy, copyFeedback }: FixingPromptProps) {
  return (
    <section className="fixing-prompt" aria-labelledby="fixing-prompt-title">
      <div className="fixing-prompt-heading">
        <h4 id="fixing-prompt-title">Consolidated fixing prompt</h4>
        {advisoryReport.fixingPrompt && (
          <button className="button button-secondary" type="button" onClick={onCopy}>
            Copy prompt
          </button>
        )}
      </div>
      <p>
        This prompt is read-only here. Your external coding assistant decides whether to make
        edits; this application never changes project files.
      </p>
      {advisoryReport.fixingPrompt ? (
        <pre className="fixing-prompt-content">{advisoryReport.fixingPrompt}</pre>
      ) : (
        <p className="empty-findings">{getEmptyPromptMessage(advisoryReport)}</p>
      )}
      {advisoryReport.omittedPromptFindingCount > 0 && (
        <p>
          {advisoryReport.omittedPromptFindingCount} additional findings are omitted from the
          bounded prompt.
        </p>
      )}
      {copyFeedback && (
        <p className="copy-prompt-feedback" role="status">
          {copyFeedback}
        </p>
      )}
    </section>
  )
}

function getEmptyPromptMessage(report: AdvisoryReport): string {
  if (report.findings.length === 0 && report.assessmentGroups.length > 0) {
    return 'No prompt was generated because validated assessments did not identify a potential issue. "No issue detected" and "insufficient context" results are not turned into fixes.'
  }
  if (report.status === 'failed') {
    return 'No prompt was generated because there are no validated actionable results. Failed, blocked, and invalid assessments are never used as fixing instructions.'
  }
  if (report.status === 'queued' || report.status === 'in_progress') {
    return 'No prompt is available yet. A prompt is generated only from validated actionable results.'
  }
  return 'No prompt was generated because there are no validated actionable advisory findings.'
}