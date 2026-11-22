import { createHash } from 'node:crypto';
import {
  PROJECT_INTAKE_LIMITS,
  isAllowedExtension,
  isConfigFile,
  isDeniedSegment,
  isSecretFilename,
} from './projectIntakeLimits.js';

export interface ProjectFileResult {
  relativePath: string;
  status: 'accepted' | 'ignored' | 'rejected';
  byteLength: number;
  reason: string | null;
}

export interface ProjectIntakeResponse {
  snapshotId: string | null;
  projectLabel: string | null;
  completeness: 'complete' | 'partial';
  files: ProjectFileResult[];
  counts: {
    selected: number;
    accepted: number;
    ignored: number;
    rejected: number;
    omitted: number;
  };
  omissionReasons: string[];
}

export interface ParsedPart {
  relativePath: string;
  content: Buffer;
  originalFilename?: string;
}

export function isHostilePath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return true;
  // Check NUL and control characters
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  // Absolute paths (POSIX / or Windows \)
  if (raw.startsWith('/') || raw.startsWith('\\')) return true;
  // UNC paths
  if (raw.startsWith('//') || raw.startsWith('\\\\')) return true;
  // Drive letter prefix (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(raw)) return true;

  // Traversal check
  const replaced = raw.replace(/\\/g, '/');
  if (replaced.startsWith('../') || replaced === '..') return true;
  const segments = replaced.split('/');
  if (segments.some((s) => s === '..')) return true;

  return false;
}

export function normalizePath(raw: string): string | null {
  if (isHostilePath(raw)) return null;

  const replaced = raw.replace(/\\/g, '/');
  const segments = replaced.split('/').filter((s) => s.length > 0 && s !== '.');

  if (segments.length === 0) return null;
  if (segments.length > PROJECT_INTAKE_LIMITS.maxPathSegments) return null;

  const normalized = segments.join('/');
  if (normalized.length > PROJECT_INTAKE_LIMITS.maxRelativePathLength) return null;
  if (normalized.includes('\\')) return null;

  return normalized;
}

export function classifyFile(
  relativePath: string,
  content: Buffer,
): { status: ProjectFileResult['status']; reason: string | null } {
  const segments = relativePath.split('/');
  const filename = segments[segments.length - 1] ?? '';
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';

  for (const segment of segments) {
    if (isDeniedSegment(segment)) {
      return { status: 'ignored', reason: 'secret-or-dependency-path' };
    }
  }

  if (isSecretFilename(filename)) {
    return { status: 'ignored', reason: 'secret-file' };
  }

  if (isConfigFile(filename)) {
    if (content.length > 100_000) {
      return { status: 'ignored', reason: 'config-too-large' };
    }
    return { status: 'accepted', reason: null };
  }

  if (isAllowedExtension(ext)) {
    if (content.length > PROJECT_INTAKE_LIMITS.maxFileBytes) {
      return { status: 'rejected', reason: 'file-too-large' };
    }
    return { status: 'accepted', reason: null };
  }

  return { status: 'ignored', reason: 'unsupported-extension' };
}

export function computeSnapshotId(
  acceptedFiles: Array<{ relativePath: string; content: Buffer }>,
): string | null {
  if (acceptedFiles.length === 0) return null;
  const sorted = [...acceptedFiles].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
  const parts = sorted.map((f) => {
    const fileHash = createHash('sha256').update(f.content).digest('hex');
    return `${f.relativePath}\n${fileHash}`;
  });
  return createHash('sha256').update(parts.join('')).digest('hex');
}

export async function processProjectIntake(
  parts: ParsedPart[],
  projectLabel: string | null,
): Promise<ProjectIntakeResponse> {
  const omissionReasons: string[] = [];
  let totalAcceptedBytes = 0;
  let acceptedCount = 0;
  let inspectedCount = 0;
  const seenPaths = new Set<string>();
  const files: ProjectFileResult[] = [];
  const acceptedFiles: Array<{ relativePath: string; content: Buffer }> = [];

  for (const part of parts) {
    if (inspectedCount >= PROJECT_INTAKE_LIMITS.maxInspectedFiles) {
      omissionReasons.push('inspected-file-cap');
      break;
    }
    inspectedCount++;

    const normalized = normalizePath(part.relativePath);
    if (!normalized) {
      files.push({
        relativePath: part.relativePath,
        status: 'rejected',
        byteLength: part.content.length,
        reason: 'invalid-path',
      });
      continue;
    }

    if (seenPaths.has(normalized)) {
      files.push({
        relativePath: normalized,
        status: 'rejected',
        byteLength: part.content.length,
        reason: 'duplicate-path',
      });
      continue;
    }
    seenPaths.add(normalized);

    const { status, reason } = classifyFile(normalized, part.content);

    if (status === 'accepted') {
      if (acceptedCount >= PROJECT_INTAKE_LIMITS.maxAcceptedFiles) {
        omissionReasons.push('accepted-file-cap');
        files.push({
          relativePath: normalized,
          status: 'ignored',
          byteLength: part.content.length,
          reason: 'accepted-file-cap',
        });
        continue;
      }
      if (totalAcceptedBytes + part.content.length > PROJECT_INTAKE_LIMITS.maxTotalAcceptedBytes) {
        omissionReasons.push('total-byte-cap');
        files.push({
          relativePath: normalized,
          status: 'ignored',
          byteLength: part.content.length,
          reason: 'total-byte-cap',
        });
        continue;
      }
      totalAcceptedBytes += part.content.length;
      acceptedCount++;
      acceptedFiles.push({ relativePath: normalized, content: part.content });
    }

    files.push({
      relativePath: normalized,
      status,
      byteLength: part.content.length,
      reason,
    });
  }

  const uninspectedCount = parts.length - inspectedCount;
  const omittedCount =
    files.filter(
      (f) =>
        f.reason === 'accepted-file-cap' ||
        f.reason === 'total-byte-cap' ||
        f.reason === 'inspected-file-cap',
    ).length + uninspectedCount;

  const snapshotId = computeSnapshotId(acceptedFiles);

  const boundedLabel = projectLabel
    ? projectLabel.slice(0, PROJECT_INTAKE_LIMITS.maxProjectLabelLength)
    : null;

  return {
    snapshotId,
    projectLabel: boundedLabel,
    completeness: omissionReasons.length === 0 && uninspectedCount === 0 ? 'complete' : 'partial',
    files,
    counts: {
      selected: parts.length,
      accepted: acceptedCount,
      ignored: files.filter((f) => f.status === 'ignored').length,
      rejected: files.filter((f) => f.status === 'rejected').length,
      omitted: omittedCount,
    },
    omissionReasons: [...new Set(omissionReasons)],
  };
}
