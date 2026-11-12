/**
 * POST /api/analyze-source — single React JSX/TSX file accessibility analysis.
 *
 * This route is completely separate from POST /api/analyze (HTML + IBM).
 * It does NOT run the IBM checker. It parses the uploaded source with an
 * AST-capable parser, extracts bounded accessibility evidence, and dispatches
 * eligible targets through the existing AI advisory pipeline.
 *
 * The response clearly labels the IBM status as not-run for source input.
 * No JSX is passed to IBM. No IBM results are fabricated.
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AdvisoryReport } from '../types/checker.js';
import { MODEL_CANDIDATES } from '../ai/config.js';
import { extractReactSourceTargets } from '../services/reactSourceExtractor.js';
import { adaptReactSourceSnapshot } from '../services/reactSourceAdapter.js';
import { runContextualAssessmentJobs } from '../services/contextualAssessmentScheduler.js';
import { aggregateAdvisoryReport } from '../services/reportAggregation.js';
import { SOURCE_RULE_POLICIES } from '../services/reactSourceRuleMap.js';

const router = Router();

/** Maximum content-length for JSON body source field (500 KB in characters). */
const MAX_SOURCE_LENGTH = 512_000;

export interface SourceAnalyzeResponse {
  /** Original filename as uploaded (untrusted). */
  filename: string;
  /** ISO 8601 timestamp of analysis completion. */
  analyzedAt: string;
  /** IBM checker was not run; this field documents that explicitly. */
  ibmStatus: 'not_run_source_input';
  /** IBM checker explanation so the UI can display this clearly. */
  ibmStatusNote: string;
  /** Summary of extracted JSX targets by kind. */
  sourceExtraction: {
    totalTargets: number;
    targetsByKind: Record<string, number>;
    parseErrorCount: number;
    completeness: 'complete' | 'partial';
    sourceCharacterCount: number;
  };
  /** Rule coverage for this single-file stage. */
  ruleCoverage: Array<{
    ruleId: string;
    evidenceAvailability: 'static-extractable' | 'partial-static' | 'not-available';
    assessableFromSingleFile: boolean;
    unavailablePrerequisites: string[];
  }>;
  /** Multi-model advisory results (same pipeline as HTML analysis). */
  advisoryReport: AdvisoryReport;
}

export interface SourceErrorResponse {
  error: string;
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

router.post(
  '/api/analyze-source',
  async (
    req: Request,
    res: Response<SourceAnalyzeResponse | SourceErrorResponse>,
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

    const source = body.source;
    const filename =
      typeof body.filename === 'string' ? body.filename.trim() : '';

    if (typeof source !== 'string' || source.length === 0) {
      res.status(400).json({ error: 'source must be a non-empty string' });
      return;
    }

    if (!filename || !/\.(jsx|tsx)$/i.test(filename)) {
      res.status(400).json({
        error: 'filename must end in .jsx or .tsx',
        code: 'invalid-extension',
      });
      return;
    }

    if (source.length > MAX_SOURCE_LENGTH) {
      res.status(413).json({
        error: `Source file exceeds maximum size of ${MAX_SOURCE_LENGTH} characters.`,
        code: 'size-exceeded',
      });
      return;
    }

    try {
      // 1. Extract JSX source evidence
      const extraction = extractReactSourceTargets(source, filename);

      if (extraction.status === 'error') {
        const statusCode =
          extraction.code === 'size-exceeded' ? 413
          : extraction.code === 'invalid-extension' ||
              extraction.code === 'invalid-filename' ? 400
          : 422;
        res.status(statusCode).json({ error: extraction.message, code: extraction.code });
        return;
      }

      const { snapshot } = extraction;

      // 2. Adapt snapshot for the AI scheduler
      const adapterResult = adaptReactSourceSnapshot(snapshot);

      // 3. Run AI assessment jobs (same pipeline as HTML, no IBM)
      let aiOutcomes: Parameters<typeof aggregateAdvisoryReport>[1] = [];
      let aiSchedulerFailed = false;
      try {
        const execution = await runContextualAssessmentJobs(
          adapterResult,
          source,  // used for content hash
          filename,
          { sourceKind: 'react-source-file' },
        );
        aiOutcomes = execution.outcomes;
      } catch {
        aiSchedulerFailed = true;
        console.error(
          'Source: Contextual AI scheduling failed; source extraction results are unaffected.',
        );
      }

      // 4. Aggregate advisory report
      const advisoryReport = aggregateAdvisoryReport(
        Object.values(MODEL_CANDIDATES),
        aiOutcomes,
        [],  // no IBM issues for source input
      );
      if (aiSchedulerFailed) {
        advisoryReport.status = 'failed';
      }

      // 5. Build target-by-kind summary
      const targetsByKind: Record<string, number> = {};
      for (const target of snapshot.targets) {
        targetsByKind[target.kind] = (targetsByKind[target.kind] ?? 0) + 1;
      }

      // 6. Build rule coverage from policy map
      const ruleCoverage = Object.values(SOURCE_RULE_POLICIES).map((policy) => ({
        ruleId: policy.ruleId,
        evidenceAvailability: policy.evidenceAvailability,
        assessableFromSingleFile: policy.assessableFromSingleFile,
        unavailablePrerequisites: policy.unavailablePrerequisites,
      }));

      const response: SourceAnalyzeResponse = {
        filename,
        analyzedAt: new Date().toISOString(),
        ibmStatus: 'not_run_source_input',
        ibmStatusNote:
          'IBM Equal Access Checker was not run for this source input. ' +
          'IBM requires rendered HTML. Source analysis provides advisory model ' +
          'assessments only. No IBM findings or counts are present.',
        sourceExtraction: {
          totalTargets: snapshot.targets.length,
          targetsByKind,
          parseErrorCount: snapshot.parseErrors.length,
          completeness: snapshot.completeness.status,
          sourceCharacterCount: snapshot.sourceCharacterCount,
        },
        ruleCoverage,
        advisoryReport,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);

export default router;

