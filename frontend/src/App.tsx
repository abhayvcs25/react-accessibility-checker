import { useRef, useState, type ChangeEvent } from 'react'
import './App.css'

type HtmlFileInfo = {
  name: string
  size: string
  characterCount: number
  title: string | null
}

type SelectionState =
  | { status: 'empty' }
  | { status: 'reading'; name: string }
  | { status: 'selected'; info: HtmlFileInfo }
  | { status: 'error'; message: string }

const EMPTY_STATE: SelectionState = { status: 'empty' }

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
  const readId = useRef(0)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    const currentReadId = ++readId.current

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
  }

  const announcement =
    selection.status === 'reading'
      ? `Reading ${selection.name} locally.`
      : selection.status === 'selected'
        ? `${selection.info.name} is ready. No accessibility analysis has been run.`
        : selection.status === 'error'
          ? selection.message
          : ''

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
            Choose a file from your device to get started. It stays in your
            browser; nothing is uploaded.
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
            Your file is read locally and is never uploaded.
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
              This is basic file information only. Accessibility analysis has
              not been run.
            </p>
          </section>
        )}

        {selection.status === 'error' && (
          <p className="error-message" role="alert">
            <span aria-hidden="true">!</span>
            {selection.message}
          </p>
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
