import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types/checker.js';
import { isAppError, toAppError } from '../errors.js';
import logger from '../logger.js';

/**
 * Express global error handler.
 * Catches errors thrown or passed via next(err) in route handlers.
 * Maps known error codes to appropriate HTTP status and client-safe messages.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction,
): void {
  const reqId = (req as Request & { reqId?: string }).reqId ?? 'unknown';

  // Handle Express JSON parse errors (malformed JSON, wrong content-type)
  // Check for AppError first to avoid false positives on our error classes
  if (isAppError(err)) {
    const appError = err;
    logger.warn({ reqId, code: appError.code, status: appError.status, message: appError.message, details: appError.details }, 'Request error');
    res.status(appError.status).json({
      error: appError.message,
      code: appError.code,
      ...(appError.details ? { details: appError.details } : {}),
    });
    return;
  }

  if (isJsonParseError(err)) {
    if (err.type === 'entity.too.large') {
      logger.warn({ reqId, type: err.type }, 'Payload too large');
      res.status(413).json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    logger.warn({ reqId }, 'Invalid JSON in request body');
    res.status(400).json({ error: 'Invalid JSON in request body', code: 'INVALID_JSON' });
    return;
  }

  const appError = toAppError(err);

  // Log error with context
  logger.error({ reqId, code: appError.code, status: appError.status, message: appError.message, details: appError.details, stack: err instanceof Error ? err.stack : undefined }, 'Unhandled error');

  res.status(appError.status).json({
    error: appError.message,
    code: appError.code,
    ...(appError.details ? { details: appError.details } : {}),
  });
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
