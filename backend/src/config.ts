import './env.js';

export const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

/**
 * Maximum allowed size for the JSON request body.
 * This limits the HTML content plus the filename and JSON overhead.
 * 5 MB should accommodate even large HTML documents.
 */
export const MAX_BODY_SIZE = '5mb';

/**
 * Maximum time in milliseconds to wait for the IBM accessibility
 * checker to complete a scan before responding with a 504 timeout.
 */
export const ANALYSIS_TIMEOUT_MS = 60_000;

/**
 * CORS allowed origins. Comma-separated list.
 * Default: http://localhost:5173 (Vite dev server)
 * Example: http://localhost:5173,http://localhost:3000
 */
export const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/**
 * Rate limiting configuration.
 * All values are per IP address.
 */
export const RATE_LIMITS = {
  /** Max requests per minute for /api/analyze */
  analyze: parseInt(process.env['RATE_LIMIT_ANALYZE'] ?? '10', 10),
  /** Max requests per minute for /api/analyze-source */
  analyzeSource: parseInt(process.env['RATE_LIMIT_ANALYZE_SOURCE'] ?? '10', 10),
  /** Max requests per minute for /api/project-intake */
  projectIntake: parseInt(process.env['RATE_LIMIT_PROJECT_INTAKE'] ?? '2', 10),
} as const;
