import React from 'react';
import type { Metric } from '../types.js';

interface MetricCardProps {
  metrics: Metric[];
}

/**
 * MetricCard component with intentional accessibility violations:
 * - HEADING-CLARITY: Non-descriptive heading texts ("Details", "Section 2").
 * - HEADING-CONTENT-RELEVANCE: Heading title announces "Server CPU Utilization" but contains user billing transactions.
 */
export const MetricCard: React.FC<MetricCardProps> = ({ metrics }) => {
  return (
    <div className="metrics-container">
      {/* Violation: HEADING-CLARITY - Vague, non-descriptive heading */}
      <h2>Details</h2>

      <div className="metrics-grid">
        {metrics.map((m) => (
          <div key={m.id} className="stat-box">
            {/* Violation: HEADING-CLARITY - Heading text offers no contextual info */}
            <h3>Section 2</h3>
            <p className="stat-name">{m.label}</p>
            <p className="stat-val">{m.value}</p>
            <span className={m.positive ? 'trend-up' : 'trend-down'}>{m.change}</span>
          </div>
        ))}
      </div>

      <div className="unrelated-section-wrap">
        {/* Violation: HEADING-CONTENT-RELEVANCE - Heading claims CPU Utilization, but contents below are billing profiles */}
        <h2>Server CPU Utilization</h2>
        <div className="billing-table-summary">
          <p>Invoice #4092 paid via corporate MasterCard ending in 8841.</p>
          <p>Next automatic renewal billing cycle: December 1, 2026.</p>
        </div>
      </div>
    </div>
  );
};

