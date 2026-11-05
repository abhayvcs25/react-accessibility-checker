import { randomUUID } from 'node:crypto'
import * as aChecker from 'accessibility-checker'
import type { AnalyzeIssue, AnalyzeResponse } from '../types/checker.js'
import type { ContextAdapterResult } from '../types/contextV2.js'
import { adaptContextSnapshotV2 } from './contextAdapterV2.js'
import { extractHtmlContextResultV2 } from './contextExtractionV2.js'
import { assessAdaptedContext } from './contextualAssessment.js'

const REQUIRED_POLICY = 'IBM_Accessibility'
const REQUIRED_REPORT_LEVELS = [
  'violation',
  'potentialviolation',
  'recommendation',
  'potentialrecommendation',
  'manual',
] as const

function logAnalysis(event: string, details: Record<string, unknown>): void {
  if (process.env.RAC_LOG_ANALYSIS === '1') {
    console.info(`[analysis] ${event} ${JSON.stringify(details)}`)
  }
}

let scanQueue: Promise<void> = Promise.resolve()
let configurationPromise: Promise<void> | undefined
let closePromise: Promise<void> | undefined

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = scanQueue.then(operation)
  scanQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function ensureConfiguration(): Promise<void> {
  if (!configurationPromise) {
    configurationPromise = (async () => {
      const config = await aChecker.getConfigUnsupported()
      const policies = config.policies ?? []
      const outputFormats = config.outputFormat ?? []
      const reportLevels = config.reportLevels ?? []
      const configuredReportLevels = reportLevels.map(String)

      if (
        config.ruleArchive !== 'latest' ||
        !policies.includes(REQUIRED_POLICY) ||
        !outputFormats.includes('disable') ||
        config.perfMetrics !== false ||
        !REQUIRED_REPORT_LEVELS.every((level) =>
          configuredReportLevels.includes(level),
        )
      ) {
        throw new Error(
          'IBM checker configuration was not loaded. Start the backend with backend/ as the working directory and verify backend/.achecker.yml.',
        )
      }
    })()
  }

  await configurationPromise
}

async function getContextualAssessments(
  result: ContextAdapterResult | undefined,
): Promise<AnalyzeResponse['contextualAssessments']> {
  try {
    return await assessAdaptedContext(result)
  } catch {
    console.error(
      'Contextual assessment failed; IBM accessibility results are unaffected.',
    )
    return {
      modelId: 'not-configured',
      modelRevision: 'provider-migration-pending',
      inferenceStatus: 'failed',
      modelLoaded: false,
      assessments: [],
      errorCode: 'contextual-assessment-failed',
    }
  }
}

function getIssueLevel(result: {
  level?: string
  value: [string, string]
}): string {
  if (result.level) {
    return result.level
  }

  const [category, outcome] = result.value

  if (outcome === 'MANUAL') {
    return 'manual'
  }
  if (category === 'VIOLATION' && outcome === 'FAIL') {
    return 'violation'
  }
  if (category === 'VIOLATION' && outcome === 'POTENTIAL') {
    return 'potentialviolation'
  }
  if (category === 'RECOMMENDATION' && outcome === 'FAIL') {
    return 'recommendation'
  }
  if (category === 'RECOMMENDATION' && outcome === 'POTENTIAL') {
    return 'potentialrecommendation'
  }

  return ''
}

function getCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeIssue(
  result: aChecker.IBaselineReport['results'][number],
): AnalyzeIssue {
  const issue: AnalyzeIssue = {
    ruleId: result.ruleId,
    level: getIssueLevel(result),
    message: result.message,
    path: result.path?.['dom'] ?? '',
    snippet: result.snippet ?? '',
  }

  if (typeof result.help === 'string') {
    issue.help = result.help
  }

  return issue
}

export function analyzeHtml(
  html: string,
  filename: string,
): Promise<AnalyzeResponse> {
  if (closePromise) {
    return Promise.reject(
      new Error('The IBM accessibility checker is shutting down.'),
    )
  }

  return enqueue(async () => {
    const analysisStartedAt = performance.now()
    await ensureConfiguration()

    let contextAdapter: ContextAdapterResult | undefined
    const extractionStartedAt = performance.now()
    try {
      const contextExtraction = extractHtmlContextResultV2(html)
      contextAdapter = adaptContextSnapshotV2(contextExtraction)
      if (
        contextExtraction.status === 'unavailable' ||
        contextAdapter.status === 'unavailable' ||
        contextAdapter.status === 'error'
      ) {
        console.error(
          'Context extraction was unavailable; continuing IBM accessibility analysis.',
        )
      }
    } catch {
      console.error(
        'Context extraction failed; continuing IBM accessibility analysis.',
      )
    }
    logAnalysis('context processing finished', {
      filename,
      htmlCharacters: html.length,
      elapsedMilliseconds: Math.round(
        performance.now() - extractionStartedAt,
      ),
      contextStatus: contextAdapter?.status ?? 'unavailable',
    })

    const ibmStartedAt = performance.now()
    const label = `accessibility-analyzer-${randomUUID()}`
    const result = await aChecker.getCompliance(html, label)
    const report = result.report

    if (!('results' in report) || !Array.isArray(report.results)) {
      throw new Error('IBM accessibility checker returned an invalid report.')
    }

    const counts = report.summary?.counts
    const violations = getCount(counts?.violation)
    const potentialViolations = getCount(counts?.potentialviolation)
    const recommendations = getCount(counts?.recommendation)
    const potentialRecommendations = getCount(counts?.potentialrecommendation)
    const manual = getCount(counts?.manual)
    logAnalysis('IBM scan completed', {
      filename,
      elapsedMilliseconds: Math.round(performance.now() - ibmStartedAt),
      findingCount: report.results.length,
    })

    const contextualAssessments =
      await getContextualAssessments(contextAdapter)
    const totalElapsedMilliseconds = Math.round(
      performance.now() - analysisStartedAt,
    )
    logAnalysis('analysis completed', {
      filename,
      totalElapsedMilliseconds,
      contextualStatus: contextualAssessments.inferenceStatus,
      contextualAssessmentCount: contextualAssessments.assessments.length,
    })

    return {
      filename,
      analyzedAt: new Date().toISOString(),
      summary: {
        total:
          violations +
          potentialViolations +
          recommendations +
          potentialRecommendations +
          manual,
        violations,
        potentialViolations,
        recommendations,
        potentialRecommendations,
        manual,
      },
      issues: report.results
        .filter((issue) => issue.value[1] !== 'PASS')
        .map(normalizeIssue),
      contextualAssessments,
    }
  })
}

export function closeChecker(): Promise<void> {
  if (!closePromise) {
    closePromise = scanQueue.then(async () => {
      await aChecker.close()
    })
    scanQueue = closePromise.then(
      () => undefined,
      () => undefined,
    )
  }

  return closePromise
}
