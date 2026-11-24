import { type SourceAnalyzeResponse, type SourceRuleCoverage } from '../types'
import { AdvisoryReport } from './AdvisoryReport'

interface SourceReportProps {
  sourceReport: SourceAnalyzeResponse
}

export function SourceReport({ sourceReport }: SourceReportProps) {
  return (
    <section className="analysis-report" aria-labelledby="source-report-title">
      <div className="report-heading">
        <div>
          <p className="eyebrow">Analysis results</p>
          <h2 id="source-report-title">React source report</h2>
        </div>
        <p className="report-meta">
          <strong>{sourceReport.filename}</strong>
          <time dateTime={sourceReport.analyzedAt}>
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(sourceReport.analyzedAt))}
          </time>
        </p>
      </div>

      <div className="source-notice-banner" role="status">
        <strong>IBM Equal Access Checker was not run</strong>
        <p>{sourceReport.ibmStatusNote}</p>
      </div>

      <div className="findings-heading">
        <h3>Extracted JSX targets</h3>
        <span>{sourceReport.sourceExtraction.totalTargets}</span>
      </div>
      <div className="kind-badge-list">
        {Object.entries(sourceReport.sourceExtraction.targetsByKind).map(
          ([kind, count]) => (
            <span className="kind-badge" key={kind}>
              {kind}: <strong>{count}</strong>
            </span>
          ),
        )}
      </div>

      <details className="rule-coverage-details">
        <summary>
          20 contextual rules coverage ({sourceReport.ruleCoverage.filter((r) => r.scheduledUnitCount > 0).length} with scheduled evidence)
        </summary>
        <table className="rule-coverage-table">
          <thead>
            <tr>
              <th scope="col">Rule ID</th>
              <th scope="col">Single-file status</th>
              <th scope="col">Targets / scheduled units</th>
              <th scope="col">Unavailable prerequisites</th>
            </tr>
          </thead>
          <tbody>
            {sourceReport.ruleCoverage.map((rule: SourceRuleCoverage) => (
              <tr key={rule.ruleId}>
                <td><code>{rule.ruleId}</code></td>
                <td>
                  {rule.assessableFromSingleFile
                    ? 'Assessable from source'
                    : 'Deferred (requires project/browser/image/runtime)'}
                </td>
                <td>{rule.applicableTargetCount} / {rule.scheduledUnitCount}</td>
                <td>{rule.unavailablePrerequisites.join('; ') || 'None'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <AdvisoryReport advisoryReport={sourceReport.advisoryReport} />
    </section>
  )
}