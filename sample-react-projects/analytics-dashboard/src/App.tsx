import React, { useState } from 'react';
import type { ActivityItem, Metric } from './types.js';
import { Sidebar } from './components/Sidebar.js';
import { MetricCard } from './components/MetricCard.js';
import { NotificationModal } from './components/NotificationModal.js';
import { SettingsForm } from './components/SettingsForm.js';
import { ActivityLog } from './components/ActivityLog.js';

const INITIAL_METRICS: Metric[] = [
  { id: 'm1', label: 'API Requests / sec', value: '4,281 req/s', change: '+12.4%', positive: true },
  { id: 'm2', label: 'Average P95 Latency', value: '184 ms', change: '-4.1%', positive: true },
  { id: 'm3', label: 'Error Rate', value: '0.04%', change: '+0.01%', positive: false },
];

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: 'a1', actor: 'sarah.c@acme.corp', action: 'Modified retention window', timestamp: '10 mins ago', status: 'warning' },
  { id: 'a2', actor: 'devops-bot', action: 'Rotated secret keys', timestamp: '1 hour ago', status: 'success' },
  { id: 'a3', actor: 'system-monitor', action: 'Failed healthcheck on shard 3', timestamp: '2 hours ago', status: 'error' },
];

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('overview');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  return (
    <div className="dashboard-layout">
      <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

      <div className="main-viewport">
        <header className="topbar">
          <div className="topbar-search">
            <input type="text" placeholder="Search resources..." aria-label="Quick search" />
          </div>

          <div className="topbar-actions">
            {/* Companion to ARIA-NAMING-CONSISTENCY: here the identical gear button is labeled "User Preferences" */}
            <button
              type="button"
              className="gear-btn"
              aria-label="User Preferences"
              onClick={() => setCurrentTab('settings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <button
              type="button"
              className="btn-danger-outline"
              onClick={() => setIsModalOpen(true)}
            >
              Danger Zone
            </button>
          </div>
        </header>

        <main className="content-body">
          {currentTab === 'overview' && (
            <>
              <MetricCard metrics={INITIAL_METRICS} />
              <ActivityLog activities={INITIAL_ACTIVITIES} />
            </>
          )}

          {currentTab === 'settings' && <SettingsForm />}
        </main>
      </div>

      <NotificationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={() => {
          alert('Deletion simulated.');
          setIsModalOpen(false);
        }}
      />
    </div>
  );
};

export default App;

