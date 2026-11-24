interface AnalysisActionsProps {
  isAnalyzing: boolean
  onAnalyze: () => void
  onCancel: () => void
  mode: 'html' | 'react' | 'project'
  disabled?: boolean
}

export function AnalysisActions({ isAnalyzing, onAnalyze, onCancel, mode, disabled }: AnalysisActionsProps) {
  return (
    <div className="analysis-actions">
      {isAnalyzing ? (
        <button
          className="button button-secondary"
          type="button"
          onClick={onCancel}
        >
          Stop waiting
        </button>
      ) : (
        <button
          className="button button-primary"
          type="button"
          onClick={onAnalyze}
          disabled={disabled}
        >
          {mode === 'html' ? 'Analyze HTML' : 'Analyze React source'}
        </button>
      )}
    </div>
  )
}