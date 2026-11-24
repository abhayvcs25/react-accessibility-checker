import { type AdvisoryReport } from '../types'
import { getAdvisoryStatusMessage, getEmptyAssessmentMessage, getEquivalentModelNames } from '../utils'

interface AdvisoryReportProps {
  advisoryReport: AdvisoryReport
}

function formatStatus(status: string): string {
  switch (status) {
    case 'unanimous_issue':
      return 'Potential violation'
    case 'unanimous_no_issue':
      return 'No issue detected'
    case 'issue_detected':
      return 'Potential violation detected'
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

export function AdvisoryReport({ advisoryReport }: AdvisoryReportProps) {
  return (
    <section className="advisory-report" aria-labelledby="advisory-report-title">
      <div className="findings-heading">
        <h3 id="advisory-report-title">Separate AI assessments and findings</h3>
        <span aria-label={`${advisoryReport.assessmentGroups.length} validated assessment groups`}>
          {advisoryReport.assessmentGroups.length}
        </span>
      </div>
      <p className="advisory-report-note" role="status">
        {getAdvisoryStatusMessage(advisoryReport)} Advisory assessments never change IBM findings or counts and do not establish WCAG conformance.
      </p>
      <p className="advisory-count-note">
        {advisoryReport.assessmentGroups.length} validated assessment group(s);{' '}
        {advisoryReport.findings.length} group(s) include at least one potential issue.
      </p>
      <ul className="advisory-model-list">
        {advisoryReport.models.map((model) => (
          <li className="advisory-model-item" key={`${model.providerId}-${model.modelId}`}>
            <div className="advisory-model-heading">
              <strong>{model.modelId}</strong>
              <span className="advisory-status">{formatStatus(model.status)}</span>
            </div>
            <p>
              Provider: {model.providerId}; eligibility: {formatStatus(model.eligibility)};{' '}
              {model.jobCount === 0
                ? 'no assessment jobs scheduled'
                : `validated ${model.validatedCount} of ${model.jobCount} jobs`}
              ; invalid {model.invalidCount}; not validated {model.notValidatedCount}; failed {model.failedCount}
              {model.quotaLimited ? '; provider quota limited' : ''}.
            </p>
            {model.reason && <p>{model.reason}</p>}
          </li>
        ))}
      </ul>

      {advisoryReport.jobs.length > 0 && (
        <details className="advisory-job-details">
          <summary>Per-job outcomes ({advisoryReport.jobs.length})</summary>
          <ul className="advisory-job-list">
            {advisoryReport.jobs.map((job) => (
              <li key={job.jobId}>
                <code>
                  {job.providerId}/{job.modelId}
                </code>{' '}
                — <code>{job.ruleId}</code>: {formatStatus(job.status)}; validation{' '}
                {formatStatus(job.validationStatus)}
                {job.errorClass ? `; ${job.errorClass}` : ''}
                {job.providerRequestId ? `; request ${job.providerRequestId}` : ''}
                {`; tokens in ${job.inputTokens ?? 'unknown'}, out ${job.outputTokens ?? 'unknown'} (${job.tokenUsageSource}).`}
                {job.domPath || job.htmlSnippet || job.sourceExcerpt || job.sourceLocation ? (
                  <dl className="finding-details advisory-job-location">
                    {job.sourceLocation && (
                      <div>
                        <dt>Source location</dt>
                        <dd>
                          <code>
                            {job.sourceLocation.file}:{job.sourceLocation.startLine}:{job.sourceLocation.startColumn}–{job.sourceLocation.endLine}:{job.sourceLocation.endColumn}
                          </code>
                        </dd>
                      </div>
                    )}
                    {job.domPath && (
                      <div>
                        <dt>DOM path</dt>
                        <dd>
                          <code>{job.domPath}</code>
                        </dd>
                      </div>
                    )}
                    {job.htmlSnippet && (
                      <div>
                        <dt>HTML snippet</dt>
                        <dd>
                          <pre>
                            <code>{job.htmlSnippet}</code>
                          </pre>
                        </dd>
                      </div>
                    )}
                    {job.sourceExcerpt && (
                      <div>
                        <dt>{job.sourceLanguage?.toUpperCase() ?? 'Source'} excerpt</dt>
                        <dd>
                          <pre>
                            <code>{job.sourceExcerpt}</code>
                          </pre>
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p>Element source location is unavailable.</p>
                )}
              </li>
            ))}
          </ul>
          {advisoryReport.omittedJobCount > 0 && (
            <p>{advisoryReport.omittedJobCount} additional jobs are omitted from this report.</p>
          )}
        </details>
      )}

      {advisoryReport.assessmentGroups.length === 0 ? (
        <p className="empty-findings">{getEmptyAssessmentMessage(advisoryReport)}</p>
      ) : (
        <ol className="advisory-finding-list">
          {advisoryReport.assessmentGroups.map((finding) => (
            <li className="advisory-finding-item" key={`${finding.targetId}-${finding.ruleId}`}>
              <div className="finding-topline">
                <span className="advisory-tag">{formatStatus(finding.agreement)}</span>
                <span className="advisory-tag advisory-tag-subtle">
                  {finding.issueCount} of {finding.decisiveCount} decisive assessments flagged;{' '}
                  {finding.abstentionCount} abstained
                </span>
                <code className="finding-rule">{finding.ruleId}</code>
              </div>
              <dl className="finding-details">
                {finding.sourceLocation && (
                  <div>
                    <dt>Source location</dt>
                    <dd>
                      <code>
                        {finding.sourceLocation.file}:{finding.sourceLocation.startLine}:{finding.sourceLocation.startColumn}–{finding.sourceLocation.endLine}:{finding.sourceLocation.endColumn}
                      </code>
                    </dd>
                  </div>
                )}
                {finding.domPath && (
                  <div>
                    <dt>DOM path</dt>
                    <dd>
                      <code>{finding.domPath}</code>
                    </dd>
                  </div>
                )}
                {finding.htmlSnippet && (
                  <div>
                    <dt>HTML snippet</dt>
                    <dd>
                      <pre>
                        <code>{finding.htmlSnippet}</code>
                      </pre>
                    </dd>
                  </div>
                )}
                {finding.sourceExcerpt && (
                  <div>
                    <dt>{finding.sourceLanguage?.toUpperCase() ?? 'Source'} excerpt</dt>
                    <dd>
                      <pre>
                        <code>{finding.sourceExcerpt}</code>
                      </pre>
                    </dd>
                  </div>
                )}
                {!finding.domPath && !finding.htmlSnippet && !finding.sourceExcerpt && !finding.sourceLocation && (
                  <div>
                    <dt>Element location</dt>
                    <dd>Source location unavailable.</dd>
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
                  Exact matching validated assessments (same status, explanation, and evidence references)
                </strong>
                <ul>
                  {finding.equivalentFindings.map((equivalent) => (
                    <li key={`${equivalent.status}-${equivalent.jobIds.join(',')}`}>
                      {formatStatus(equivalent.status)} from {equivalent.modelCount} model(s)
                      {': '}
                      {getEquivalentModelNames(finding, equivalent).join(', ')}; evidence refs:{' '}
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
                    : {formatStatus(assessment.status)} — {assessment.explanation}
                    <span className="advisory-assessment-location">
                      {' '}Assessment for this source element.
                    </span>
                    {assessment.confidence !== undefined && (
                      <span>
                        {' '}
                        Model-reported confidence (uncalibrated): {assessment.confidence.toFixed(2)}.
                      </span>
                    )}
                    {assessment.evidence.length > 0 && (
                      <ul className="advisory-evidence-list">
                        {assessment.evidence.map((evidence) => (
                          <li key={evidence.id}>
                            <code>{evidence.id}</code>
                            {evidence.text ? ` — ${evidence.text}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {assessment.omittedEvidenceCount > 0 && (
                      <span>
                        {' '}
                        {assessment.omittedEvidenceCount} additional evidence references omitted.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}