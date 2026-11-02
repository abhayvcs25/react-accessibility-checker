import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeHtml } from '../../src/services/checker.js';

const mocks = vi.hoisted(() => ({
  getConfigUnsupported: vi.fn(),
  getCompliance: vi.fn(),
  extractHtmlContextResultV2: vi.fn(),
  adaptContextSnapshotV2: vi.fn(),
  assessAdaptedContext: vi.fn(),
}));

vi.mock('accessibility-checker', () => ({
  close: vi.fn(),
  getCompliance: mocks.getCompliance,
  getConfigUnsupported: mocks.getConfigUnsupported,
}));

vi.mock('../../src/services/contextExtractionV2.js', () => ({
  extractHtmlContextResultV2: mocks.extractHtmlContextResultV2,
}));

vi.mock('../../src/services/contextAdapterV2.js', () => ({
  adaptContextSnapshotV2: mocks.adaptContextSnapshotV2,
}));

vi.mock('../../src/services/contextualAssessment.js', () => ({
  assessAdaptedContext: mocks.assessAdaptedContext,
}));

describe('IBM analysis when contextual assessment fails', () => {
  beforeEach(() => {
    mocks.getConfigUnsupported.mockReset().mockResolvedValue({
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
    mocks.extractHtmlContextResultV2.mockReset().mockReturnValue({
      status: 'available',
      snapshot: {},
    });
    mocks.adaptContextSnapshotV2.mockReset().mockReturnValue({
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
    mocks.assessAdaptedContext.mockReset().mockRejectedValue(
      new Error('private model failure detail'),
    );
    mocks.getCompliance.mockReset().mockResolvedValue({
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
            path: { dom: '/html/body/img' },
            snippet: '<img src="photo.png">',
          },
        ],
      },
    });
  });

  it('returns the original IBM findings and explicitly reports contextual failure', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await analyzeHtml(
        '<img src="photo.png">',
        'sample.html',
      );

      expect(response.summary).toMatchObject({
        total: 1,
        violations: 1,
      });
      expect(response.issues).toMatchObject([
        {
          ruleId: 'WCAG20_Img_HasAlt',
          level: 'violation',
          message: 'Image has no alternative text.',
        },
      ]);
      expect(response.contextualAssessments).toMatchObject({
        inferenceStatus: 'failed',
        modelLoaded: false,
        assessments: [],
        errorCode: 'contextual-assessment-failed',
      });
      expect(logError).toHaveBeenCalledWith(
        'Contextual assessment failed; IBM accessibility results are unaffected.',
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        'private model failure detail',
      );
    } finally {
      logError.mockRestore();
    }
  });
});
