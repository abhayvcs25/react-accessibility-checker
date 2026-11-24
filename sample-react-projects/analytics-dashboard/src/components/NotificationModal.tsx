import React from 'react';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * NotificationModal component with intentional accessibility violations:
 * - ARIA-NAME-CONFLICT: Visible button text says "Delete Account Permanently" but aria-label says "Close dialog window" (direct contradiction).
 * - CONTENT-INSTRUCTION-AMBIGUITY: Instruction relies solely on visual sensory cues ("circular red button on the bottom right").
 */
export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-card">
        <h2 id="modal-title">Confirm Workspace Deletion</h2>

        {/* Violation: CONTENT-INSTRUCTION-AMBIGUITY - Relies entirely on color and screen position */}
        <p className="modal-instructions">
          To proceed, click the circular red button on the bottom right of the screen.
        </p>

        <div className="modal-action-row">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Back
          </button>

          {/* Violation: ARIA-NAME-CONFLICT - Visible text says Delete Account Permanently, but aria-label says Close dialog window */}
          <button
            type="button"
            className="btn-danger circular-red"
            aria-label="Close dialog window"
            onClick={onConfirm}
          >
            Delete Account Permanently
          </button>
        </div>
      </div>
    </div>
  );
};

