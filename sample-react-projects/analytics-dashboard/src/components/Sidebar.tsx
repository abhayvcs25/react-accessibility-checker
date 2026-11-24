import React from 'react';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

/**
 * Sidebar navigation component with intentional accessibility violations:
 * - ARIA-NAME-CLARITY: Non-descriptive, internal code-based aria-labels ("btn_nav_col_exp_01").
 * - ARIA-NAMING-CONSISTENCY: The settings icon is labeled "System Tools" here, but in other headers it is labeled "Preferences".
 * - LINK-SIMILAR-CHOICES: Confusingly overlapping link choices ("Monthly Summary Reports" vs "Monthly Metrics Summary").
 */
export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <h2>MetricFlow</h2>
        {/* Violation: ARIA-NAME-CLARITY - Cryptic developer ID instead of human-readable accessible name */}
        <button
          type="button"
          aria-label="btn_nav_col_exp_01"
          className="collapse-toggle"
        >
          <span aria-hidden="true">&laquo;</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        <ul>
          <li>
            <button
              type="button"
              className={currentTab === 'overview' ? 'active' : ''}
              onClick={() => onSelectTab('overview')}
            >
              System Overview
            </button>
          </li>
          <li>
            <button
              type="button"
              className={currentTab === 'settings' ? 'active' : ''}
              onClick={() => onSelectTab('settings')}
            >
              Organization Settings
            </button>
          </li>
        </ul>

        <div className="nav-group-heading">Reports</div>
        <ul className="subnav-links">
          {/* Violation: LINK-SIMILAR-CHOICES - Extremely similar link texts with distinct destinations */}
          <li>
            <a href="/reports/monthly-summary" className="report-link">
              Monthly Summary Reports
            </a>
          </li>
          <li>
            <a href="/reports/monthly-metrics" className="report-link">
              Monthly Metrics Summary
            </a>
          </li>
        </ul>
      </nav>

      <div className="sidebar-footer">
        {/* Violation: ARIA-NAMING-CONSISTENCY - Labeled "System Tools", while identical gear icon in header is labeled "Preferences" */}
        <button
          type="button"
          aria-label="System Tools"
          className="settings-icon-btn"
          onClick={() => onSelectTab('settings')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </aside>
  );
};

