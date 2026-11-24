export interface Metric {
  id: string;
  label: string;
  value: string;
  change: string;
  positive: boolean;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error';
}

