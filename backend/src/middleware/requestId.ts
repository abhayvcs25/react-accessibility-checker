import { Request, Response, NextFunction } from 'express';
import { generateRequestId } from '../logger.js';

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  (req as Request & { reqId: string }).reqId = generateRequestId();
  next();
}