import pino from 'pino';
import { randomUUID } from 'node:crypto';

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'react-accessibility-checker',
  },
});

export interface LogContext {
  reqId?: string;
  [key: string]: unknown;
}

export function createChildLogger(context: LogContext): pino.Logger {
  return logger.child(context);
}

export function generateRequestId(): string {
  return randomUUID();
}

export default logger;