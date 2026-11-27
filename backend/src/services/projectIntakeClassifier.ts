/**
 * Shared project intake classification logic.
 * Single source of truth for both client (frontend) and server (backend).
 * 
 * This module contains pure functions with no Node.js dependencies,
 * making it safe to import in browser environments.
 */

// --- Constants ---

export const DENY_SEGMENTS = new Set([
  '.git', '.svn', '.hg',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'out',
  'secrets', 'private',
]);

export const SECRET_FILENAMES = new Set([
  'credentials.json', 'id_rsa', 'id_dsa',
]);

export const SECRET_EXTENSIONS = [
  '.pem', '.key', '.p12', '.pfx', '.cer', '.crt',
];

export const DENY_EXTENSIONS = new Set([
  ...SECRET_EXTENSIONS,
  '.map', '.lock',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.md', '.markdown', '.txt', '.log',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
]);

export const ALLOWED_EXTENSIONS = new Set([
  '.jsx', '.tsx', '.js', '.ts', '.html', '.htm',
]);

export const CONFIG_FILENAMES = new Set(['tsconfig.json', 'jsconfig.json']);

// --- Pure Functions ---

/**
 * Checks if a path segment is a denied segment (dependency, secret, or build directory).
 */
export function isDeniedSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (lower.startsWith('.env')) return true;
  return DENY_SEGMENTS.has(lower);
}

/**
 * Checks if a filename is a known secret file.
 */
export function isSecretFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (SECRET_FILENAMES.has(lower)) return true;
  for (const ext of SECRET_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Checks if an extension is allowed for project intake.
 */
export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Checks if a filename is a config file (tsconfig.json, jsconfig.json).
 */
export function isConfigFile(filename: string): boolean {
  return CONFIG_FILENAMES.has(filename.toLowerCase());
}

/**
 * Classifies a file by its relative path.
 * Returns status and reason (if not accepted).
 * 
 * @param relativePath - Normalized relative path (forward slashes, no leading/trailing slash)
 * @returns { status: 'accepted' | 'ignored' | 'rejected', reason: string | null }
 */
export function classifyFile(relativePath: string): { status: 'accepted' | 'ignored' | 'rejected'; reason: string | null } {
  const segments = relativePath.split('/');
  const filename = segments[segments.length - 1] ?? '';
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';

  // Check path segments for denied directories
  for (const segment of segments) {
    if (isDeniedSegment(segment)) {
      return { status: 'ignored', reason: 'secret-or-dependency-path' };
    }
  }

  // Check for secret filenames
  const lowerFilename = filename.toLowerCase();
  if (isSecretFilename(lowerFilename)) {
    return { status: 'ignored', reason: 'secret-file' };
  }

  // Check for denied extensions
  for (const deniedExt of DENY_EXTENSIONS) {
    if (lowerFilename.endsWith(deniedExt)) {
      return { status: 'ignored', reason: 'unsupported-extension' };
    }
  }

  // Check for config files (accepted)
  if (isConfigFile(filename.toLowerCase())) {
    return { status: 'accepted', reason: null };
  }

  // Check for allowed extensions
  if (isAllowedExtension(ext.toLowerCase())) {
    return { status: 'accepted', reason: null };
  }

  // Default: ignored with unsupported extension
  return { status: 'ignored', reason: 'unsupported-extension' };
}

/**
 * Normalizes a client-provided path, checking for hostile patterns.
 * Returns normalized path or null if hostile/invalid.
 * 
 * This mirrors the server-side isHostilePath + normalizePath logic.
 */
export function normalizePathClient(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  
  // Check for NUL and control characters
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  
  // Absolute paths (POSIX / or Windows \)
  if (raw.startsWith('/') || raw.startsWith('\\')) return null;
  
  // UNC paths
  if (raw.startsWith('//') || raw.startsWith('\\\\')) return null;
  
  // Drive letter prefix (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(raw)) return null;
  
  // Traversal check
  const replaced = raw.replace(/\\/g, '/');
  if (replaced.startsWith('../') || replaced === '..') return null;
  const segments = replaced.split('/');
  if (segments.some((s) => s === '..')) return null;
  
  // Filter empty segments and '.'
  const filtered = segments.filter((s) => s.length > 0 && s !== '.');
  if (filtered.length === 0) return null;
  if (filtered.length > 16) return null;
  
  const normalized = filtered.join('/');
  if (normalized.length > 240) return null;
  if (normalized.includes('\\')) return null;
  
  return normalized;
}

export type FileStatus = 'accepted' | 'ignored' | 'rejected';

export interface ProjectFileManifest {
  relativePath: string;
  status: FileStatus;
  byteLength: number;
  reason: string | null;
}

export interface ProjectIntakeResponse {
  snapshotId: string | null;
  projectLabel: string | null;
  completeness: 'complete' | 'partial';
  files: ProjectFileManifest[];
  counts: {
    selected: number;
    accepted: number;
    ignored: number;
    rejected: number;
    omitted: number;
  };
  omissionReasons: string[];
}