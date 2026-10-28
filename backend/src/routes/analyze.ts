import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { analyzeHtml } from '../services/checker.js';
import type { AnalyzeResponse, ErrorResponse } from '../types/checker.js';

const router = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

router.post(
  '/api/analyze',
  async (
    req: Request,
    res: Response<AnalyzeResponse | ErrorResponse>,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }
    const body: unknown = req.body;
    if (!isRecord(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    const html = body.html;
    const filename =
      typeof body.filename === 'string'
        ? body.filename.trim()
        : '';

    if (typeof html !== 'string' || html.length === 0) {
      res.status(400).json({ error: 'html must be a non-empty string' });
      return;
    }

    if (!filename || !/\.(?:html|htm)$/i.test(filename)) {
      res
        .status(400)
        .json({ error: 'filename must end in .html or .htm' });
      return;
    }

    try {
      const result = await analyzeHtml(html, filename);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
