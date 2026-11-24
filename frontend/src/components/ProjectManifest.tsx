import { formatFileSize } from '../utils'
import { type ProjectIntakeResponse, type ProjectFileManifest } from '../types'

interface ProjectManifestProps {
  manifest: ProjectIntakeResponse
}

export function ProjectManifest({ manifest }: ProjectManifestProps) {
  return (
    <div className="project-manifest-summary">
      <div className="manifest-counts">
        <div className="count-item">
          <span className="count-label">Selected</span>
          <span className="count-value">{manifest.counts.selected}</span>
        </div>
        <div className="count-item">
          <span className="count-label">Accepted</span>
          <span className="count-value accepted">{manifest.counts.accepted}</span>
        </div>
        <div className="count-item">
          <span className="count-label">Ignored</span>
          <span className="count-value ignored">{manifest.counts.ignored}</span>
        </div>
        <div className="count-item">
          <span className="count-label">Rejected</span>
          <span className="count-value rejected">{manifest.counts.rejected}</span>
        </div>
        <div className="count-item">
          <span className="count-label">Omitted</span>
          <span className="count-value omitted">{manifest.counts.omitted}</span>
        </div>
      </div>
      {manifest.snapshotId && (
        <p className="partial-notice" style={{ borderColor: 'var(--design-color-border)', background: 'var(--design-color-surface-subtle)', color: 'var(--design-color-ink)', wordBreak: 'break-all' }}>
          Snapshot ID: <code>{manifest.snapshotId}</code>
        </p>
      )}
      {manifest.completeness === 'partial' && manifest.omissionReasons.length > 0 && (
        <p className="partial-notice">
          Incomplete: {manifest.omissionReasons.join(', ')}
        </p>
      )}
      <details className="manifest-file-list">
        <summary>File list ({manifest.files.length})</summary>
        <ul className="file-list">
          {manifest.files.map((file: ProjectFileManifest, index: number) => (
            <li key={index} className={`file-list-item ${file.status}`}>
              <code>{file.relativePath}</code>
              <span className="file-status">{file.status}</span>
              {file.reason && <span className="file-reason">({file.reason})</span>}
              <span className="file-size">{formatFileSize(file.byteLength)}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}