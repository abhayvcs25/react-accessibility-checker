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
