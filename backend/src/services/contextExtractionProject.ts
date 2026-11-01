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

const PROJECT_ORIGIN = 'https://project-context.invalid';

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

function virtualUrl(filePath: string): URL {
  return new URL(
    `/${filePath.split('/').map(encodeURIComponent).join('/')}`,
    PROJECT_ORIGIN,
  );
}

function destinationUrl(
  document: ProjectContextDocument,
  href: string,
): URL | undefined {
  const defaultBase = virtualUrl(document.filePath);
  let base = defaultBase;
  if (document.baseHref.status === 'present') {
    if (document.baseHref.truncated) return undefined;
    try {
      base = new URL(document.baseHref.value, defaultBase);
    } catch {
      return undefined;
    }
  } else if (
    document.baseHref.status !== 'confirmed-absent'
  ) {
    return undefined;
  }
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

function resolvedDestination(
  document: ProjectContextDocument,
  href: string,
  documentsByPath: Map<string, string>,
): ProjectLinkReference['destination'] {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) || href.startsWith('//')) {
    return {
      status: 'external',
      reason: 'The href uses an external scheme or authority.',
    };
  }
  const url = destinationUrl(document, href);
  if (!url) {
    return {
      status: 'unknown',
      reason: 'The href or applicable base URL is malformed or incomplete.',
    };
  }
  if (url.origin !== PROJECT_ORIGIN) {
    return {
      status: 'external',
      reason: 'The href resolves outside the supplied project origin.',
    };
  }

  let filePath: string;
  try {
    const segments = url.pathname
      .slice(1)
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => /[\\/]/.test(segment))) {
      return {
        status: 'unknown',
        reason: 'The destination path contains an encoded path separator.',
      };
    }
    filePath = segments.join('/');
  } catch {
    return {
      status: 'unknown',
      reason: 'The destination path contains invalid percent encoding.',
    };
  }
  filePath = posix.normalize(filePath);
  if (filePath === '.' || filePath === '..' || filePath.startsWith('../')) {
    return {
      status: 'unknown',
      reason: 'The destination path escapes the supplied project root.',
    };
  }
  const destinationDocumentId = documentsByPath.get(filePath);
  if (!destinationDocumentId) {
    return {
      status: 'unknown',
      reason: 'The destination is outside the supplied HTML files; no crawling was performed.',
    };
  }
  const hasQuery = (url.href.split('#', 1)[0] ?? '').includes('?');
  const hasFragment = url.href.includes('#');
  return {
    status: 'resolved',
    documentId: destinationDocumentId,
    filePath,
    ...(hasQuery ? { query: url.search.slice(1) } : {}),
    ...(hasFragment ? { fragment: url.hash.slice(1) } : {}),
  };
}

function distinctDocuments(records: ProjectRecordRef[]): boolean {
  return new Set(records.map((record) => record.documentId)).size > 1;
}

function buildComparisons(
  documents: ProjectContextDocument[],
): ProjectComparisonGroup[] {
  const linkTexts = new Map<string, ProjectRecordRef[]>();
  const targetTexts = new Map<string, ProjectRecordRef[]>();
  const contextTexts = new Map<string, ProjectRecordRef[]>();
  const destinations = new Map<
    string,
    {
      destination: NonNullable<ProjectComparisonGroup['destination']>;
      records: ProjectRecordRef[];
    }
  >();

  for (const document of documents) {
    const targets = new Map(
      document.snapshot.targets.map((target) => [target.id, target]),
    );
    for (const target of document.snapshot.targets) {
      if (
        !target.text?.value ||
        target.text.truncated ||
        target.completeness.status !== 'complete'
      ) {
        continue;
      }
      const authoredRole =
        target.attributes.role.status === 'present'
          ? target.attributes.role.value.value.toLowerCase()
          : '';
      const key = JSON.stringify([
        target.kind,
        target.tagName,
        authoredRole,
        target.text.value.replace(/\s+/g, ' ').trim(),
      ]);
      const ref: ProjectRecordRef = {
        documentId: document.documentId,
        recordType: 'target',
        id: target.id,
      };
      const records = targetTexts.get(key) ?? [];
      records.push(ref);
      targetTexts.set(key, records);
    }
    for (const record of document.contextRecords) {
      if (
        record.text.status !== 'present' ||
        record.text.value.truncated ||
        record.completeness !== 'complete'
      ) {
        continue;
      }
      const text = record.text.value.value.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const key = `${record.category}:${text}`;
      const records = contextTexts.get(key) ?? [];
      records.push({
        documentId: document.documentId,
        recordType: 'context',
        id: record.id,
      });
      contextTexts.set(key, records);
    }
    for (const link of document.links) {
      if (link.href.status !== 'present') continue;
      const target = targets.get(link.source.id);
      const authoredText =
        target?.completeness.status === 'complete' && !target.text?.truncated
          ? target.text?.value.replace(/\s+/g, ' ').trim()
          : undefined;
      if (authoredText) {
        const key = `link:${authoredText}`;
        const records = linkTexts.get(key) ?? [];
        records.push(link.source);
        linkTexts.set(key, records);
      }
      if (link.destination.status === 'resolved') {
        const destination = link.destination;
        const key = JSON.stringify([
          destination.documentId,
          destination.filePath,
          destination.query ?? null,
          destination.fragment ?? null,
        ]);
        const group = destinations.get(key) ?? {
          destination: {
            documentId: destination.documentId,
            filePath: destination.filePath,
            ...(destination.query !== undefined
              ? { query: destination.query }
              : {}),
            ...(destination.fragment !== undefined
              ? { fragment: destination.fragment }
              : {}),
          },
          records: [],
        };
        group.records.push(link.source);
        destinations.set(key, group);
      }
    }
  }

  const comparisons: ProjectComparisonGroup[] = [];
  for (const records of linkTexts.values()) {
    if (distinctDocuments(records)) {
      comparisons.push({ basis: 'exact-authored-link-text', records });
    }
  }
  for (const records of targetTexts.values()) {
    if (distinctDocuments(records)) {
      comparisons.push({ basis: 'exact-authored-target-text', records });
    }
  }
  for (const records of contextTexts.values()) {
    if (distinctDocuments(records)) {
      comparisons.push({ basis: 'exact-context-text', records });
    }
  }
  for (const { destination, records } of destinations.values()) {
    if (distinctDocuments(records)) {
      comparisons.push({
        basis: 'same-supplied-destination',
        destination,
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
            destination: resolvedDestination(
              document,
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
                  : link.href.status === 'omitted-incomplete'
                    ? ('omitted-incomplete' as const)
                    : ('unknown' as const),
              reason: 'No complete authored href value is available.',
            },
          },
    );
  }

  const partial = documents.some(
    (document) =>
      document.snapshot.completeness.status === 'partial' ||
      document.contextCompleteness.status === 'partial' ||
      document.parserDiagnostics.some((diagnostic) => diagnostic.affectsExtraction),
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
