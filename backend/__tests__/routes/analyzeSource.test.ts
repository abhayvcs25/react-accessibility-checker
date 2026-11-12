import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_SIZE } from '../../src/config.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import analyzeSourceRouter from '../../src/routes/analyzeSource.js';

const mocks = vi.hoisted(() => ({
  runContextualAssessmentJobs: vi.fn(),
}));

vi.mock('../../src/services/contextualAssessmentScheduler.js', () => ({
  runContextualAssessmentJobs: mocks.runContextualAssessmentJobs,
}));

describe('POST /api/analyze-source', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: MAX_BODY_SIZE }));
    app.use(analyzeSourceRouter);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    mocks.runContextualAssessmentJobs.mockReset().mockResolvedValue({
      outcomes: [],
    });
  });

  it('runs the React source adapter and clearly reports that IBM was not run', async () => {
    const response = await fetch(`${baseUrl}/api/analyze-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'SaveButton.tsx',
        source: '<button>Save</button>',
      }),
    });
    expect(response.status).toBe(200);
    const report = await response.json() as {
      ibmStatus: string;
      sourceExtraction: { totalTargets: number };
      ruleCoverage: Array<{ ruleId: string; assessableFromSingleFile: boolean }>;
    };
    expect(report.ibmStatus).toBe('not_run_source_input');
    expect(report.sourceExtraction.totalTargets).toBe(1);
    expect(report.ruleCoverage).toHaveLength(20);
    expect(report).not.toHaveProperty('ibmReport');
    expect(report).not.toHaveProperty('ibmSummary');
    expect(report.ruleCoverage.find((rule) => rule.ruleId === 'ARIA-NAME-CLARITY'))
      .toMatchObject({ assessableFromSingleFile: false });
    expect(report.ruleCoverage.find((rule) => rule.ruleId === 'IMG-ALT-RELEVANCE'))
      .toMatchObject({ assessableFromSingleFile: false });
    expect(mocks.runContextualAssessmentJobs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
      '<button>Save</button>',
      'SaveButton.tsx',
      { sourceKind: 'react-source-file' },
    );
  });

  it('rejects invalid input without invoking the assessment pipeline', async () => {
    const response = await fetch(`${baseUrl}/api/analyze-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'index.html', source: '<p>text</p>' }),
    });
    expect(response.status).toBe(400);
    expect(mocks.runContextualAssessmentJobs).not.toHaveBeenCalled();
  });
});
