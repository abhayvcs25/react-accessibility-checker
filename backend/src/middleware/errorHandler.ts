import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types/checker.js';

/**
 * Express global error handler.
 * Catches errors thrown or passed via next(err) in route handlers.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction,
): void {
  // Handle Express JSON parse errors (malformed JSON, wrong content-type)
  if (isJsonParseError(err)) {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    res.status(400).json({ error: 'Invalid JSON in request body' });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

interface JsonParseError {
  type?: string;
  status?: number;
  message: string;
}

function isJsonParseError(err: unknown): err is JsonParseError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as JsonParseError).message === 'string'
  );
}
