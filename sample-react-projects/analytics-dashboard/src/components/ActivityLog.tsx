import React from 'react';
import type { ActivityItem } from '../types.js';

interface ActivityLogProps {
  activities: ActivityItem[];
}

export const ActivityLog: React.FC<ActivityLogProps> = ({ activities }) => {
  return (
    <section className="activity-log-card">
      <h2>Recent Audit Events</h2>
      <table className="activity-table">
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Event</th>
            <th scope="col">Date/Time</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <tr key={a.id}>
              <td>{a.actor}</td>
              <td>{a.action}</td>
              <td>{a.timestamp}</td>
              <td>
                <span className={`status-pill status-${a.status}`}>{a.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

