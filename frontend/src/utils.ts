export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(size)} ${units[unitIndex]}`
}

export function getDocumentTitle(content: string): string | null {
  const document = new DOMParser().parseFromString(content, 'text/html')
  const title = document.querySelector('title')?.textContent?.trim()
  return title || null
}

export function getIssueCategory(level: string): string {
  switch (level.toLowerCase()) {
    case 'violation':
      return 'Confirmed violation'
    case 'potentialviolation':
      return 'Potential violation'
    case 'recommendation':
      return 'Recommendation'
    case 'potentialrecommendation':
      return 'Potential recommendation'
    case 'manual':
      return 'Manual review'
    default:
      return level || 'Finding'
  }
}

export function getSafeHelpUrl(help: string): string | null {
  try {
    const url = new URL(help)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null
  } catch {
    return null
  }
}

export function getAdvisoryStatusMessage(report: { status: string; models: Array<{ status: string; validatedCount: number }> }): string {
  const validatedCount = report.models.reduce(
    (total, model) => total + model.validatedCount,
    0,
  )
  const allModelsBlocked =
    report.models.length > 0 &&
    report.models.every((model) => model.status === 'blocked')

  switch (report.status) {
    case 'not_run':
      return allModelsBlocked
        ? 'No model assessments ran because every configured model is blocked. Review each eligibility reason below.'
        : 'No model assessment jobs have run. Review the model states below; no result is a negative assessment.'
    case 'queued':
      return 'Assessment jobs are queued and have not produced validated results yet.'
    case 'in_progress':
      return 'Assessment jobs are still in progress. Only validated results are included below.'
    case 'completed':
      return 'All reported jobs completed with validated results. This advisory output is not an IBM finding or a conformance determination.'
    case 'partial':
      return `${validatedCount} assessment(s) were validated; other work was blocked, invalid, failed, or not completed. Missing results are not negative assessments.`
    case 'failed':
      return 'No validated assessment results are available. Review model and job states below for blocked, invalid, or failed work.'
    default:
      return ''
  }
}

export function getEmptyAssessmentMessage(report: { status: string; models: Array<{ status: string; validatedCount: number }> }): string {
  if (report.status === 'not_run') {
    const allModelsBlocked =
      report.models.length > 0 &&
      report.models.every((model) => model.status === 'blocked')

    return allModelsBlocked
      ? 'No model assessments ran because every configured model is blocked. Review each eligibility reason below.'
      : 'No model assessment jobs have run. Review the model states below; no result is a negative assessment.'
  }
  if (report.status === 'failed') {
    return 'No validated assessments are available. Failed, blocked, and invalid jobs are not shown as findings; inspect the per-model and per-job outcomes.'
  }
  if (report.status === 'queued' || report.status === 'in_progress') {
    return 'No validated assessment groups are available yet. Queued or running jobs are not treated as findings.'
  }
  if (report.status === 'partial') {
    const validatedCount = report.models.reduce(
      (total, model) => total + model.validatedCount,
      0,
    )
    return `${validatedCount} assessment(s) were validated; other work was blocked, invalid, failed, or not completed. Missing results are not negative assessments.`
  }
  return 'No validated assessment groups were returned.'
}

export function getEmptyPromptMessage(report: { status: string; findings: unknown[]; assessmentGroups: unknown[] }): string {
  if (report.findings.length === 0 && report.assessmentGroups.length > 0) {
    return 'No prompt was generated because validated assessments did not identify a potential issue. "No issue detected" and "insufficient context" results are not turned into fixes.'
  }
  if (report.status === 'failed') {
    return 'No prompt was generated because there are no validated actionable results. Failed, blocked, and invalid assessments are never used as fixing instructions.'
  }
  if (report.status === 'queued' || report.status === 'in_progress') {
    return 'No prompt is available yet. A prompt is generated only from validated actionable results.'
  }
  return 'No prompt was generated because there are no validated actionable advisory findings.'
}

export function getEquivalentModelNames(
  finding: { assessments: Array<{ jobId: string; providerId: string; modelId: string }> },
  equivalent: { jobIds: string[] },
): string[] {
  return Array.from(
    new Set(
      equivalent.jobIds.flatMap((jobId) => {
        const assessment = finding.assessments.find(
          (item) => item.jobId === jobId,
        )
        return assessment
          ? [`${assessment.providerId}/${assessment.modelId}`]
          : []
      }),
    ),
  )
}

// --- Constants (shared with backend projectIntakeClassifier) ---

const DENY_SEGMENTS = new Set([
  '.git', '.svn', '.hg',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'out',
  'secrets', 'private',
])

const SECRET_FILENAMES = new Set([
  'credentials.json', 'id_rsa', 'id_dsa',
])

const SECRET_EXTENSIONS = [
  '.pem', '.key', '.p12', '.pfx', '.cer', '.crt',
]

const DENY_EXTENSIONS = new Set([
  ...SECRET_EXTENSIONS,
  '.map', '.lock',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.md', '.markdown', '.txt', '.log',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
])

const ALLOWED_EXTENSIONS = new Set([
  '.jsx', '.tsx', '.js', '.ts', '.html', '.htm',
])

const CONFIG_FILENAMES = new Set(['tsconfig.json', 'jsconfig.json'])

// --- Pure Functions ---

function isDeniedSegment(segment: string): boolean {
  const lower = segment.toLowerCase()
  if (lower.startsWith('.env')) return true
  return DENY_SEGMENTS.has(lower)
}

function isSecretFilename(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (SECRET_FILENAMES.has(lower)) return true
  for (const ext of SECRET_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

function isAllowedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase())
}

function isConfigFile(filename: string): boolean {
  return CONFIG_FILENAMES.has(filename.toLowerCase())
}

export function normalizePathClient(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null

  // Check for NUL and control characters
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return null
  }

  // Absolute paths (POSIX / or Windows \)
  if (raw.startsWith('/') || raw.startsWith('\\')) return null

  // UNC paths
  if (raw.startsWith('//') || raw.startsWith('\\\\')) return null

  // Drive letter prefix (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(raw)) return null

  // Traversal check
  const replaced = raw.replace(/\\/g, '/')
  if (replaced.startsWith('../') || replaced === '..') return null
  const segments = replaced.split('/')
  if (segments.some((s) => s === '..')) return null

  // Filter empty segments and '.'
  const filtered = segments.filter((s) => s.length > 0 && s !== '.')
  if (filtered.length === 0) return null
  if (filtered.length > 16) return null

  const normalized = filtered.join('/')
  if (normalized.length > 240) return null
  if (normalized.includes('\\')) return null

  return normalized
}

export function classifyFileClient(relativePath: string): { status: 'accepted' | 'ignored' | 'rejected'; reason: string | null } {
  const segments = relativePath.split('/')
  const filename = segments[segments.length - 1] ?? ''
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''

  for (const segment of segments) {
    if (isDeniedSegment(segment)) return { status: 'ignored', reason: 'secret-or-dependency-path' }
  }

  const lowerFilename = filename.toLowerCase()
  if (isSecretFilename(lowerFilename)) return { status: 'ignored', reason: 'secret-file' }
  for (const secretExt of SECRET_EXTENSIONS) {
    if (lowerFilename.endsWith(secretExt)) return { status: 'ignored', reason: 'secret-file' }
  }
  for (const deniedExt of DENY_EXTENSIONS) {
    if (lowerFilename.endsWith(deniedExt)) return { status: 'ignored', reason: 'unsupported-extension' }
  }

  if (isConfigFile(filename.toLowerCase())) return { status: 'accepted', reason: null }
  if (isAllowedExtension(ext.toLowerCase())) return { status: 'accepted', reason: null }

  return { status: 'ignored', reason: 'unsupported-extension' }
}