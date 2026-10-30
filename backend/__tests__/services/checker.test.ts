import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeHtml } from '../../src/services/checker.js';

const {
  close,
  getCompliance,
  getConfigUnsupported,
  extractHtmlContextResultV2,
  adaptContextSnapshotV2Mock,
} =
  vi.hoisted(() => ({
    close: vi.fn(),
    getCompliance: vi.fn(),
    getConfigUnsupported: vi.fn(),
    extractHtmlContextResultV2: vi.fn(),
    adaptContextSnapshotV2Mock: vi.fn(),
  }));

vi.mock('accessibility-checker', () => ({
  close,
  getCompliance,
  getConfigUnsupported,
}));

vi.mock('../../src/services/contextExtractionV2.js', () => ({
  extractHtmlContextResultV2,
}));

vi.mock('../../src/services/contextAdapterV2.js', () => ({
  adaptContextSnapshotV2: adaptContextSnapshotV2Mock,
}));

const html = '<main><img src="photo.png"></main>';
const filename = 'sample.html';
const checkerResult = {
  report: {
    summary: {
      counts: {
        violation: 1,
        potentialviolation: 0,
        recommendation: 0,
        potentialrecommendation: 0,
        manual: 0,
      },
    },
    results: [
      {
        ruleId: 'WCAG20_Img_HasAlt',
        level: 'violation',
        value: ['VIOLATION', 'FAIL'],
        message: 'Image has no alternative text.',
        path: { dom: '/html/body/main/img' },
        snippet: '<img src="photo.png">',
        help: 'https://example.test/rule',
      },
    ],
  },
};

describe('analyzeHtml context extraction integration', () => {
  beforeEach(() => {
    adaptContextSnapshotV2Mock.mockReset().mockReturnValue({
      status: 'empty',
      input: {
        document: {
          title: { status: 'absent' },
          language: { status: 'absent' },
        },
        units: [],
        extractionCompleteness: {
          status: 'complete',
          truncations: [],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount: 0, ambiguousCount: 0 },
        },
        adapterCompleteness: { status: 'complete', truncations: [] },
      },
    });
    extractHtmlContextResultV2.mockReset().mockReturnValue({
      status: 'available',
      snapshot: {
        schemaVersion: 2,
        document: {
          title: { status: 'absent' },
          language: { status: 'absent' },
        },
        targets: [],
        evidence: [],
        relationships: [],
        completeness: {
          status: 'complete',
          truncations: [],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount: 0, ambiguousCount: 0 },
        },
      },
    });
    getCompliance.mockReset().mockResolvedValue(checkerResult);
    getConfigUnsupported.mockReset().mockResolvedValue({
      ruleArchive: 'latest',
      policies: ['IBM_Accessibility'],
      outputFormat: ['disable'],
      perfMetrics: false,
      reportLevels: [
        'violation',
        'potentialviolation',
        'recommendation',
        'potentialrecommendation',
        'manual',
      ],
    });
  });

  it('extracts context while preserving the IBM input, findings, and response contract', async () => {
    const response = await analyzeHtml(html, filename);

    expect(extractHtmlContextResultV2).toHaveBeenCalledOnce();
    expect(extractHtmlContextResultV2).toHaveBeenCalledWith(html);
    expect(getCompliance).toHaveBeenCalledOnce();
    expect(getCompliance).toHaveBeenCalledWith(
      html,
      expect.stringMatching(/^accessibility-analyzer-/),
    );
    expect(response.filename).toBe(filename);
    expect(response).toMatchObject({
      summary: {
        total: 1,
        violations: 1,
        potentialViolations: 0,
        recommendations: 0,
        potentialRecommendations: 0,
        manual: 0,
      },
      issues: [
        {
          ruleId: 'WCAG20_Img_HasAlt',
          level: 'violation',
          message: 'Image has no alternative text.',
          path: '/html/body/main/img',
          snippet: '<img src="photo.png">',
          help: 'https://example.test/rule',
        },
      ],
    });
    expect(Object.keys(response).sort()).toEqual([
      'analyzedAt',
      'filename',
      'issues',
      'summary',
    ]);
  });

  it('continues IBM analysis when context extraction throws', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    extractHtmlContextResultV2.mockImplementation(() => {
      throw new Error(`Failed to extract from ${html}`);
    });

    try {
      const response = await analyzeHtml(html, filename);

      expect(response.filename).toBe(filename);
      expect(response.issues[0]?.ruleId).toBe('WCAG20_Img_HasAlt');
      expect(getCompliance).toHaveBeenCalledWith(
        html,
        expect.stringMatching(/^accessibility-analyzer-/),
      );
      expect(logError).toHaveBeenCalledWith(
        'Context extraction failed; continuing IBM accessibility analysis.',
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain(html);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        'Failed to extract',
      );
    } finally {
      logError.mockRestore();
    }
  });

  it.each([
    [
      'unavailable extraction',
      () => {
        extractHtmlContextResultV2.mockReturnValue({
          status: 'unavailable',
          reason: 'parser-failure',
        });
      },
    ],
    [
      'adapter error result',
      () => {
        adaptContextSnapshotV2Mock.mockReturnValue({
          status: 'error',
          errorCode: 'invalid-snapshot',
        });
      },
    ],
    [
      'adapter exception',
      () => {
        adaptContextSnapshotV2Mock.mockImplementation(() => {
          throw new Error('adapter failed');
        });
      },
    ],
  ])('continues IBM with the original HTML after %s', async (_case, setup) => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();

    try {
      const response = await analyzeHtml(html, filename);
      expect(response.filename).toBe(filename);
      expect(getCompliance).toHaveBeenCalledOnce();
      expect(getCompliance).toHaveBeenCalledWith(
        html,
        expect.stringMatching(/^accessibility-analyzer-/),
      );
    } finally {
      logError.mockRestore();
    }
  });
});
