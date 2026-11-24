import React, { useState } from 'react';

/**
 * SettingsForm component with intentional accessibility violations:
 * - CONTENT-ERROR-CLARITY: Non-descriptive and unhelpful error messages ("Error", "Invalid").
 * - CONTENT-TERM-CONSISTENCY: Inconsistently refers to the company's unit as "Workspace", "Project", "Account", and "Tenant" in the same form.
 */
export const SettingsForm: React.FC = () => {
  const [tenantName, setTenantName] = useState('Acme Global');
  const [retentionDays, setRetentionDays] = useState('-5');
  const [hasError, setHasError] = useState(true);

  return (
    <div className="settings-panel">
      {/* Violation: CONTENT-TERM-CONSISTENCY - Starts by calling it "Workspace" */}
      <h2>Workspace Preferences</h2>
      <p>Configure the operational parameters for your primary Project.</p>

      <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
        {/* Term changes to Tenant */}
        <div className="form-item">
          <label htmlFor="tenant-input">Tenant Organization Name</label>
          <input
            type="text"
            id="tenant-input"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
          />
        </div>

        {/* Term changes to Account */}
        <div className="form-item">
          <label htmlFor="retention-input">Account Data Retention Window (days)</label>
          <input
            type="number"
            id="retention-input"
            value={retentionDays}
            onChange={(e) => {
              setRetentionDays(e.target.value);
              setHasError(Number(e.target.value) < 0);
            }}
          />
          {/* Violation: CONTENT-ERROR-CLARITY - Error message is just "Error" or "Invalid", provides no hint or guidance */}
          {hasError && (
            <p className="form-error-msg" role="alert">
              Error
            </p>
          )}
        </div>

        <div className="form-item">
          <label htmlFor="audit-input">Audit Log Destination</label>
          <input type="text" id="audit-input" defaultValue="s3://metrics-vault" />
          {/* Violation: CONTENT-ERROR-CLARITY - "Invalid" doesn't explain what is wrong */}
          <span className="field-hint-error">Invalid</span>
        </div>

        <button type="submit" className="btn-save">
          Save Team Settings
        </button>
      </form>
    </div>
  );
};

