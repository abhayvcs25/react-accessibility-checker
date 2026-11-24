import { type AnalyzeResponse, type AnalyzeIssue } from '../types'
import { AdvisoryReport } from './AdvisoryReport'
import { getSafeHelpUrl, getIssueCategory } from '../utils'

interface AnalysisReportProps {
  report: AnalyzeResponse
  advisoryReport: import('../types').AdvisoryReport
}

const SUMMARY_ITEMS: { label: string; key: keyof AnalyzeResponse['summary'] }[] = [
  { label: 'Total findings', key: 'total' },
  { label: 'Confirmed violations', key: 'violations' },
  { label: 'Potential violations', key: 'potentialViolations' },
  { label: 'Recommendations', key: 'recommendations' },
  { label: 'Potential recommendations', key: 'potentialRecommendations' },
  { label: 'Manual review', key: 'manual' },
]

export function AnalysisReport({ report, advisoryReport }: AnalysisReportProps) {
  return (
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
          {report.issues.map((issue: AnalyzeIssue, index: number) => {
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

      <AdvisoryReport advisoryReport={advisoryReport} />
    </section>
  )
}