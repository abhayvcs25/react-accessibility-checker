import { randomUUID } from 'node:crypto'
import * as aChecker from 'accessibility-checker'
import type { AnalyzeIssue, AnalyzeResponse } from '../types/checker.js'

const REQUIRED_POLICY = 'IBM_Accessibility'
const REQUIRED_REPORT_LEVELS = [
  'violation',
  'potentialviolation',
  'recommendation',
  'potentialrecommendation',
  'manual',
] as const

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
    await ensureConfiguration()

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
    }
  })
}

export function closeChecker(): Promise<void> {
  if (!closePromise) {
    closePromise = scanQueue.then(() => aChecker.close())
    scanQueue = closePromise.then(
      () => undefined,
      () => undefined,
    )
  }

  return closePromise
}
