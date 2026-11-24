import { useState, type ChangeEvent } from 'react'
import { FolderIcon } from './icons/FolderIcon'
import { normalizePathClient, classifyFileClient } from '../utils'

interface ProjectFolderPickerProps {
  projectManifest: import('../types').ProjectIntakeResponse | null
  setProjectManifest: React.Dispatch<React.SetStateAction<import('../types').ProjectIntakeResponse | null>>
  selectedProjectFiles: File[]
  setSelectedProjectFiles: React.Dispatch<React.SetStateAction<File[]>>
  projectLabel: string | null
  setProjectLabel: React.Dispatch<React.SetStateAction<string | null>>
  setAnalysisCancelled: React.Dispatch<React.SetStateAction<boolean>>
  setAnalysisError: React.Dispatch<React.SetStateAction<string | null>>
  analysisController: React.MutableRefObject<AbortController | null>
  readId: React.MutableRefObject<number>
  onProjectIntake: () => Promise<void>
}

export function ProjectFolderPicker({
  projectManifest,
  setProjectManifest,
  setSelectedProjectFiles,
  setProjectLabel,
  setAnalysisCancelled,
  setAnalysisError,
  analysisController,
  readId,
}: ProjectFolderPickerProps) {
  const [isDragging, setIsDragging] = useState(false)

  async function handleProjectFolderChange(event: ChangeEvent<HTMLInputElement>) {
    const rawFiles = event.currentTarget.files
    if (!rawFiles || rawFiles.length === 0) {
      return
    }
    const fileArray = Array.from(rawFiles)
    event.currentTarget.value = ''

    analysisController.current?.abort()
    const currentReadId = ++readId.current
    setProjectManifest(null)
    setSelectedProjectFiles([])
    setProjectLabel(null)
    setAnalysisCancelled(false)
    setAnalysisError(null)

    const hasRelativePaths = fileArray.some((f) => f.webkitRelativePath && f.webkitRelativePath.trim() !== '')

    if (!hasRelativePaths) {
      setProjectManifest({
        snapshotId: null,
        projectLabel: null,
        completeness: 'partial',
        files: [],
        counts: { selected: 0, accepted: 0, ignored: 0, rejected: 0, omitted: 0 },
        omissionReasons: ['not-a-directory'],
      })
      setAnalysisError('Please choose a folder, not individual files.')
      return
    }

    const folderLabel = fileArray[0]?.webkitRelativePath?.split('/')[0] || null
    setProjectLabel(folderLabel)
    setSelectedProjectFiles(fileArray)

    const classified = fileArray.map((file) => {
      const relativePath = file.webkitRelativePath?.trim() || file.name
      const normalized = normalizePathClient(relativePath)
      if (!normalized) {
        return {
          relativePath,
          status: 'rejected' as const,
          byteLength: file.size,
          reason: 'invalid-path' as const,
        }
      }
      const { status, reason } = classifyFileClient(normalized)
      return {
        relativePath: normalized,
        status,
        byteLength: file.size,
        reason,
      }
    })

    const seen = new Set<string>()
    const deduped = classified.map((f) => {
      if (seen.has(f.relativePath)) {
        return { ...f, status: 'rejected' as const, reason: 'duplicate-path' as const }
      }
      seen.add(f.relativePath)
      return f
    })

    const acceptedCount = deduped.filter((f) => f.status === 'accepted').length
    const ignoredCount = deduped.filter((f) => f.status === 'ignored').length
    const rejectedCount = deduped.filter((f) => f.status === 'rejected').length

    setProjectManifest({
      snapshotId: null,
      projectLabel: folderLabel,
      completeness: 'complete',
      files: deduped,
      counts: {
        selected: fileArray.length,
        accepted: acceptedCount,
        ignored: ignoredCount,
        rejected: rejectedCount,
        omitted: 0,
      },
      omissionReasons: [],
    })

    if (currentReadId !== readId.current) return
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
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const hasRelativePaths = files.some((f) => (f as any).webkitRelativePath && (f as any).webkitRelativePath.trim() !== '')
    if (!hasRelativePaths) {
      setProjectManifest({
        snapshotId: null,
        projectLabel: null,
        completeness: 'partial',
        files: [],
        counts: { selected: 0, accepted: 0, ignored: 0, rejected: 0, omitted: 0 },
        omissionReasons: ['not-a-directory'],
      })
      setAnalysisError('Please choose a folder, not individual files.')
      return
    }

    const fileArray = files
    const folderLabel = fileArray[0]?.webkitRelativePath?.split('/')[0] || null
    setProjectLabel(folderLabel)
    setSelectedProjectFiles(fileArray)

    const classified = fileArray.map((file) => {
      const relativePath = (file as any).webkitRelativePath?.trim() || file.name
      const normalized = normalizePathClient(relativePath)
      if (!normalized) {
        return {
          relativePath,
          status: 'rejected' as const,
          byteLength: file.size,
          reason: 'invalid-path' as const,
        }
      }
      const { status, reason } = classifyFileClient(normalized)
      return {
        relativePath: normalized,
        status,
        byteLength: file.size,
        reason,
      }
    })

    const seen = new Set<string>()
    const deduped = classified.map((f) => {
      if (seen.has(f.relativePath)) {
        return { ...f, status: 'rejected' as const, reason: 'duplicate-path' as const }
      }
      seen.add(f.relativePath)
      return f
    })

    const acceptedCount = deduped.filter((f) => f.status === 'accepted').length
    const ignoredCount = deduped.filter((f) => f.status === 'ignored').length
    const rejectedCount = deduped.filter((f) => f.status === 'rejected').length

    setProjectManifest({
      snapshotId: null,
      projectLabel: folderLabel,
      completeness: 'complete',
      files: deduped,
      counts: {
        selected: fileArray.length,
        accepted: acceptedCount,
        ignored: ignoredCount,
        rejected: rejectedCount,
        omitted: 0,
      },
      omissionReasons: [],
    })
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
        <FolderIcon />
      </div>
      <h3>
        {projectManifest && projectManifest.files.length > 0
          ? `Project ready: ${projectManifest.files.length} files`
          : 'Choose a React project folder'}
      </h3>
      <p className="picker-copy">
        Select a folder containing your React project. Files are classified locally before upload.
      </p>

      <div className="picker-control">
        <input
          className="file-input"
          id="project-folder-input"
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          aria-label="React project folder"
          aria-describedby="project-file-help"
          onChange={handleProjectFolderChange}
        />
        <label className="button button-primary" htmlFor="project-folder-input">
          {projectManifest && projectManifest.files.length > 0
            ? 'Choose another folder'
            : 'Browse for folder'}
        </label>
      </div>
      <p className="file-help" id="project-file-help">
        Accepted: .jsx, .tsx, .js, .ts, .html, .htm, tsconfig.json, jsconfig.json. Secrets, node_modules, dist, build, and other build artifacts are filtered out.
      </p>
    </div>
  )
}