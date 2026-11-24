import { type Mode } from '../types'

interface ModeSelectorProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  analysisController: React.MutableRefObject<AbortController | null>
  readId: React.MutableRefObject<number>
}

export function ModeSelector({
  mode,
  onModeChange,
  analysisController,
  readId,
}: ModeSelectorProps) {
  function handleModeSwitch(newMode: Mode) {
    if (newMode === mode) return
    analysisController.current?.abort()
    readId.current += 1
    onModeChange(newMode)
  }

  return (
    <div className="mode-selector" role="tablist" aria-label="Analysis mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'html'}
        className={`mode-btn ${mode === 'html' ? 'mode-btn-active' : ''}`}
        onClick={() => handleModeSwitch('html')}
      >
        HTML Document (.html)
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'react'}
        className={`mode-btn ${mode === 'react' ? 'mode-btn-active' : ''}`}
        onClick={() => handleModeSwitch('react')}
      >
        React Source (.jsx, .tsx)
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'project'}
        className={`mode-btn ${mode === 'project' ? 'mode-btn-active' : ''}`}
        onClick={() => handleModeSwitch('project')}
      >
        React Project (folder)
      </button>
    </div>
  )
}