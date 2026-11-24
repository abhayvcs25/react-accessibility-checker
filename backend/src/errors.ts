/**
 * Application error classes with standardized codes for client handling.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', 400, message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', 404, message, details);
    this.name = 'NotFoundError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SERVICE_UNAVAILABLE', 503, message, details);
    this.name = 'ServiceUnavailableError';
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string, public readonly retryAfter: number, details?: Record<string, unknown>) {
    super('RATE_LIMITED', 429, message, details);
    this.name = 'RateLimitedError';
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UPSTREAM_ERROR', 502, message, details);
    this.name = 'UpstreamError';
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFIGURATION_ERROR', 500, message, details);
    this.name = 'ConfigurationError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof Error) {
    // Common error patterns
    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect ECONNREFUSED')) {
      return new ServiceUnavailableError('Analysis backend unavailable', { originalMessage: err.message });
    }
    if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      return new ServiceUnavailableError('Request timed out', { originalMessage: err.message });
    }
    if (err.message.includes('IBM') || err.message.includes('checker')) {
      return new UpstreamError('IBM accessibility checker error', { originalMessage: err.message });
    }
    if (err.message.includes('AI') || err.message.includes('provider') || err.message.includes('model')) {
      return new UpstreamError('AI provider error', { originalMessage: err.message });
    }
  }

  return new AppError('INTERNAL_ERROR', 500, 'Internal server error');
}