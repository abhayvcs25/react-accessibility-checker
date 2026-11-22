import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import Busboy from 'busboy';
import { PROJECT_INTAKE_LIMITS } from '../services/projectIntakeLimits.js';
import { isHostilePath, processProjectIntake, type ParsedPart } from '../services/projectIntake.js';

const router = Router();

function isMultipart(req: Request): boolean {
  const ct = req.headers['content-type'] ?? '';
  return ct.startsWith('multipart/form-data');
}

function readStream(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('part-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

router.post(
  '/api/project-intake',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isMultipart(req)) {
      res.status(415).json({
        error: 'Content-Type must be multipart/form-data',
        code: 'invalid-content-type',
      });
      return;
    }

    let busboyInstance: ReturnType<typeof Busboy>;
    try {
      busboyInstance = Busboy({
        headers: req.headers,
        preservePath: true,
        limits: {
          files: PROJECT_INTAKE_LIMITS.maxInspectedFiles + 50,
          fileSize: PROJECT_INTAKE_LIMITS.maxFileBytes + 1024,
        },
      });
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid multipart request',
        code: 'malformed-multipart',
      });
      return;
    }

    const parts: ParsedPart[] = [];
    const filePromises: Promise<void>[] = [];
    let projectLabel: string | null = null;
    let requestMalformed = false;
    let malformedReason = '';
    let totalBytes = 0;
    let fileCount = 0;

    busboyInstance.on('file', (fieldname: string, fileStream: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
      fileCount++;
      if (fileCount > PROJECT_INTAKE_LIMITS.maxInspectedFiles + 50) {
        requestMalformed = true;
        malformedReason = 'too-many-parts';
        fileStream.resume();
        return;
      }

      const relativePath = (info.filename || fieldname || '').trim();
      if (!relativePath) {
        requestMalformed = true;
        malformedReason = 'missing-relative-path';
        fileStream.resume();
        return;
      }

      const promise = readStream(fileStream, PROJECT_INTAKE_LIMITS.maxFileBytes + 1024)
        .then((content) => {
          totalBytes += content.length;
          if (totalBytes > PROJECT_INTAKE_LIMITS.multipartTransportCeiling) {
            requestMalformed = true;
            malformedReason = 'transport-ceiling-exceeded';
            return;
          }
          parts.push({
            relativePath,
            content,
            originalFilename: info.filename,
          });
        })
        .catch((err: Error) => {
          requestMalformed = true;
          malformedReason = err.message || 'part-read-failed';
        });

      filePromises.push(promise);
    });

    busboyInstance.on('field', (fieldname: string, value: string) => {
      if (fieldname === 'projectLabel' && typeof value === 'string') {
        projectLabel = value.trim();
      }
    });

    busboyInstance.on('error', (err: Error) => {
      requestMalformed = true;
      malformedReason = err.message;
    });

    busboyInstance.on('finish', async () => {
      try {
        await Promise.all(filePromises);
      } catch {
        res.status(400).json({
          error: 'Failed to read multipart stream',
          code: 'malformed-multipart',
        });
        return;
      }

      if (requestMalformed) {
        res.status(400).json({
          error: `Malformed multipart request: ${malformedReason}`,
          code: 'malformed-multipart',
        });
        return;
      }

      if (parts.length === 0) {
        res.status(400).json({
          error: 'No files provided in multipart request',
          code: 'no-files',
        });
        return;
      }

      // Traversal and absolute path rejection check
      for (const part of parts) {
        if (isHostilePath(part.relativePath)) {
          console.warn(`[project-intake] Blocked hostile path: ${part.relativePath}`);
          res.status(400).json({
            error: 'Absolute paths or directory traversal are not allowed',
            code: 'invalid-path',
          });
          return;
        }
      }

      console.log(
        `[project-intake] Received project intake request: ${parts.length} files (label: ${projectLabel ?? 'none'})`,
      );

      try {
        const response = await processProjectIntake(parts, projectLabel);
        console.log(
          `[project-intake] Completed intake: ${response.counts.accepted} accepted, ${response.counts.ignored} ignored, ${response.counts.rejected} rejected, ${response.counts.omitted} omitted (snapshot: ${response.snapshotId ? response.snapshotId.slice(0, 12) + '...' : 'null'})`,
        );
        res.status(200).json(response);
      } catch (err) {
        console.error('[project-intake] Error processing intake:', err);
        next(err);
      }
    });

    req.pipe(busboyInstance);
  },
);

export default router;
