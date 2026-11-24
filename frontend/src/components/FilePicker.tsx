import { useState, type ChangeEvent } from 'react'
import { FileIcon } from './icons/FileIcon'
import { formatFileSize, getDocumentTitle } from '../utils'
import { type SelectionState } from '../types'

interface FilePickerProps {
  mode: 'html' | 'react'
  selection: SelectionState
  setSelection: React.Dispatch<React.SetStateAction<SelectionState>>
}

function isHtmlFile(file: File): boolean {
  return /\.(html|htm)$/i.test(file.name)
}

function isReactSourceFile(file: File): boolean {
  return /\.(jsx|tsx)$/i.test(file.name)
}

export function FilePicker({ mode, selection, setSelection }: FilePickerProps) {
  const [isDragging, setIsDragging] = useState(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    const isValid = mode === 'html' ? isHtmlFile(file) : isReactSourceFile(file)
    if (!isValid) {
      setSelection({
        status: 'error',
        message:
          mode === 'html'
            ? 'Choose an HTML file ending in .html or .htm.'
            : 'Choose a React source file ending in .jsx or .tsx.',
      })
      return
    }

    setSelection({ status: 'reading', name: file.name })

    try {
      const content = await file.text()
      setSelection({
        status: 'selected',
        content,
        info: {
          name: file.name,
          size: formatFileSize(file.size),
          characterCount: content.length,
          title: mode === 'html' ? getDocumentTitle(content) : null,
        },
      })
    } catch {
      setSelection({
        status: 'error',
        message: `Couldn't read ${file.name}. Try selecting another ${mode === 'html' ? 'HTML' : 'React'} file.`,
      })
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      const isValid = mode === 'html' ? isHtmlFile(file) : isReactSourceFile(file)
      if (!isValid) {
        setSelection({
          status: 'error',
          message:
            mode === 'html'
              ? 'Choose an HTML file ending in .html or .htm.'
              : 'Choose a React source file ending in .jsx or .tsx.',
        })
        return
      }
      setSelection({ status: 'reading', name: file.name })
      file.text().then((content) => {
        setSelection({
          status: 'selected',
          content,
          info: {
            name: file.name,
            size: formatFileSize(file.size),
            characterCount: content.length,
            title: mode === 'html' ? getDocumentTitle(content) : null,
          },
        })
      }).catch(() => {
        setSelection({
          status: 'error',
          message: `Couldn't read ${file.name}. Try selecting another ${mode === 'html' ? 'HTML' : 'React'} file.`,
        })
      })
    }
  }

  return (
    <div
      className="file-picker-area"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ borderColor: isDragging ? 'var(--design-color-primary)' : undefined }}
    >
      <div className="file-icon" aria-hidden="true">
        <FileIcon />
      </div>
      <h3>
        {selection.status === 'selected'
          ? 'Your file is ready'
          : selection.status === 'reading'
            ? 'Reading your file'
            : mode === 'html'
              ? 'Choose an HTML file'
              : 'Choose a React .jsx or .tsx file'}
      </h3>
      <p className="picker-copy">
        {selection.status === 'reading'
          ? `Reading ${selection.name} on this device…`
          : mode === 'html'
            ? 'Select a .html or .htm file from your device.'
            : 'Select a .jsx or .tsx source file from your device.'}
      </p>

      <div className="picker-control">
        <input
          className="file-input"
          id="source-file-input"
          type="file"
          accept={mode === 'html' ? '.html,.htm,text/html' : '.jsx,.tsx'}
          aria-describedby="file-help"
          onChange={handleFileChange}
        />
        <label className="button button-primary" htmlFor="source-file-input">
          {selection.status === 'selected'
            ? 'Choose another file'
            : 'Browse files'}
        </label>
      </div>
      <p className="file-help" id="file-help">
        {mode === 'html' ? 'Accepted formats: .html, .htm' : 'Accepted formats: .jsx, .tsx'}
      </p>
    </div>
  )
}