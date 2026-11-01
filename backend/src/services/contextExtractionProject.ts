import { posix } from 'node:path';
import type {
  ProjectComparisonGroup,
  ProjectContextDocument,
  ProjectContextSnapshot,
  ProjectDocumentInput,
  ProjectLinkReference,
  ProjectRecordRef,
} from '../types/contextProject.js';
import { ProjectExtractionError } from '../types/contextProject.js';
import { extractHtmlContextDocumentV2 } from './contextExtractionV2.js';

function normalizeFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new ProjectExtractionError(
      'invalid-document',
      'Project HTML file paths must be non-empty relative paths.',
    );
  }
  const result = posix.normalize(normalized);
  if (result === '.' || result === '..' || result.startsWith('../')) {
    throw new ProjectExtractionError(
      'invalid-document',
      'Project HTML file paths must remain inside the supplied project root.',
    );
  }
  return result;
}

function resolveProjectPath(filePath: string, hrefPath: string): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(hrefPath);
  } catch {
    return undefined;
  }
  const resolved = posix.normalize(
    decodedPath.startsWith('/')
      ? decodedPath.slice(1)
      : posix.join(posix.dirname(filePath), decodedPath),
  );
  return resolved === '..' || resolved.startsWith('../')
    ? undefined
    : resolved;
}

function resolveLinkDestination(
  filePath: string,
  documentId: string,
  href: string,
  documentsByPath: Map<string, string>,
): ProjectLinkReference['destination'] {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) || href.startsWith('//')) {
    return { status: 'external', reason: 'The href uses an external scheme or authority.' };
  }

  const hashIndex = href.indexOf('#');
  const fragment =
    hashIndex >= 0 ? href.slice(hashIndex + 1) || undefined : undefined;
  const beforeFragment = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = beforeFragment.indexOf('?');
  const hrefPath =
    queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment;

  if (!hrefPath) {
    return { status: 'resolved', documentId, ...(fragment ? { fragment } : {}) };
  }
  const resolvedPath = resolveProjectPath(filePath, hrefPath);
  if (!resolvedPath) {
    return { status: 'unknown', reason: 'The relative href path is malformed or escapes the supplied project root.' };
  }
  const destinationDocumentId = documentsByPath.get(resolvedPath);
  return destinationDocumentId
    ? {
        status: 'resolved',
        documentId: destinationDocumentId,
        ...(fragment ? { fragment } : {}),
      }
    : {
        status: 'unknown',
        reason: 'The href destination is outside the supplied HTML files; no crawling was performed.',
      };
}

function buildComparisons(
  documents: ProjectContextDocument[],
): ProjectComparisonGroup[] {
  const groups = new Map<string, ProjectRecordRef[]>();
  const labels = new Map<string, ProjectRecordRef[]>();

  for (const document of documents) {
    const targets = new Map(
      document.snapshot.targets.map((target) => [target.id, target]),
    );
    for (const link of document.links) {
      if (link.href.status !== 'present') continue;
      const target = targets.get(link.source.id);
      const authoredText =
        target?.completeness.status === 'complete' && !target.text?.truncated
          ? target.text?.value.replace(/\s+/g, ' ').trim()
          : undefined;
      if (authoredText) {
        const key = `text:${authoredText}`;
        const records = labels.get(key) ?? [];
        records.push(link.source);
        labels.set(key, records);
      }
      if (link.destination.status === 'resolved') {
        const key = `destination:${link.destination.documentId}`;
        const records = groups.get(key) ?? [];
        records.push(link.source);
        groups.set(key, records);
      }
    }
  }

  const comparisons: ProjectComparisonGroup[] = [];
  for (const records of labels.values()) {
    if (new Set(records.map((record) => record.documentId)).size > 1) {
      comparisons.push({
        basis: 'exact-authored-link-text',
        records,
      });
    }
  }
  for (const records of groups.values()) {
    if (new Set(records.map((record) => record.documentId)).size > 1) {
      comparisons.push({
        basis: 'same-supplied-destination',
        records,
      });
    }
  }
  return comparisons;
}

export function extractHtmlProjectContext(
  inputs: ProjectDocumentInput[],
): ProjectContextSnapshot {
  const documentIds = new Set<string>();
  const normalizedInputs = inputs.map((input) => {
    if (
      !input ||
      typeof input.documentId !== 'string' ||
      !input.documentId.trim() ||
      typeof input.filePath !== 'string' ||
      typeof input.html !== 'string'
    ) {
      throw new ProjectExtractionError(
        'invalid-document',
        'Each project document requires a non-empty ID, a relative file path, and an HTML string.',
      );
    }
    const documentId = input.documentId.trim();
    if (documentIds.has(documentId)) {
      throw new ProjectExtractionError(
        'duplicate-document-id',
        `Duplicate project document ID: ${documentId}`,
      );
    }
    documentIds.add(documentId);
    return {
      ...input,
      documentId,
      filePath: normalizeFilePath(input.filePath),
    };
  });

  const filePaths = new Set<string>();
  for (const input of normalizedInputs) {
    if (filePaths.has(input.filePath)) {
      throw new ProjectExtractionError(
        'duplicate-file-path',
        `Duplicate project HTML file path: ${input.filePath}`,
      );
    }
    filePaths.add(input.filePath);
  }

  const documentsByPath = new Map(
    normalizedInputs.map((input) => [input.filePath, input.documentId]),
  );
  const documents = normalizedInputs.map((input) =>
    extractHtmlContextDocumentV2(
      input.html,
      input.documentId,
      input.filePath,
    ),
  );

  for (const document of documents) {
    document.links = document.links.map((link) =>
      link.href.status === 'present'
        ? {
            ...link,
            destination: resolveLinkDestination(
              document.filePath,
              document.documentId,
              link.href.value,
              documentsByPath,
            ),
          }
        : {
            ...link,
            destination: {
              status:
                link.href.status === 'confirmed-absent'
                  ? ('not-applicable' as const)
                  : ('omitted-incomplete' as const),
              reason: 'No complete authored href value is available.',
            },
          },
    );
  }

  const partial = documents.some(
    (document) =>
      document.snapshot.completeness.status === 'partial' ||
      document.evidenceAvailability.surroundingText === 'omitted-incomplete' ||
      document.contextRecords.some((record) => record.completeness === 'partial'),
  );
  return {
    schemaVersion: 1,
    scope: 'provided-html-files-only',
    documents,
    comparisons: buildComparisons(documents),
    completeness: {
      status: partial ? 'partial' : 'complete',
      omittedDocumentIds: [],
      projectCoverage: 'provided-files-only',
    },
  };
}
