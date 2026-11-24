import { type HtmlFileInfo } from '../types'

interface FileDetailsProps {
  info: HtmlFileInfo
  mode: 'html' | 'react' | 'project'
  onClear: () => void
}

export function FileDetails({ info, mode, onClear }: FileDetailsProps) {
  return (
    <section className="file-details" aria-labelledby="details-title">
      <div className="details-heading">
        <div>
          <p className="eyebrow">Selected document</p>
          <h2 id="details-title">File information</h2>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={onClear}
        >
          Clear file
        </button>
      </div>
      <dl className="details-grid">
        <div className="detail-item detail-item-wide">
          <dt>Filename</dt>
          <dd title={info.name}>{info.name}</dd>
        </div>
        <div className="detail-item">
          <dt>File size</dt>
          <dd>{info.size}</dd>
        </div>
        <div className="detail-item">
          <dt>Characters</dt>
          <dd>
            {new Intl.NumberFormat().format(
              info.characterCount,
            )}
          </dd>
        </div>
        {mode === 'html' && (
          <div className="detail-item detail-item-wide">
            <dt>Document title</dt>
            <dd>{info.title ?? 'No title found'}</dd>
          </div>
        )}
      </dl>
      <p className="analysis-note">
        {mode === 'html'
          ? 'File details are read locally. Choose Analyze HTML to send its contents to the local backend and run the accessibility check.'
          : 'File details are read locally. Choose Analyze React source to extract static JSX accessibility evidence and run contextual advisory checks.'}
      </p>
    </section>
  )
}