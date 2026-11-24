/**
 * Centralized bounds configuration for all extraction pipelines.
 * Single source of truth for limits to ensure consistency across client/server.
 */
export const BOUNDS = {
  /** Maximum number of elements to process in a single document */
  maxElements: 500,

  /** Maximum length of extracted text content */
  maxTextLength: 500,

  /** Maximum length of attribute values */
  maxAttributeValueLength: 250,

  /** Maximum length of source excerpts */
  maxSourceExcerptLength: 500,

  /** Maximum number of ancestor levels to track */
  maxAncestors: 4,

  /** Maximum number of ARIA attributes to capture per element */
  maxAriaAttributes: 20,

  /** Maximum length of target HTML snippets */
  maxTargetHtmlSnippetLength: 500,

  /** Maximum file size in bytes for project intake */
  maxFileBytes: 512_000,

  /** Maximum relative path length */
  maxRelativePathLength: 240,

  /** Maximum path segments */
  maxPathSegments: 16,

  /** Maximum project context records */
  maxProjectContextRecords: 500,

  /** Maximum accepted files per project */
  maxAcceptedFiles: 200,

  /** Maximum inspected files per project */
  maxInspectedFiles: 500,

  /** Maximum total accepted bytes per project */
  maxTotalAcceptedBytes: 4_000_000,

  /** Multipart transport ceiling in bytes */
  multipartTransportCeiling: 10_000_000,

  /** Maximum project label length */
  maxProjectLabelLength: 120,

  /** Maximum filename length */
  maxFilenameLength: 255,

  /** Maximum source length for React source analysis (characters) */
  maxSourceLength: 512_000,

  /** Maximum ID reference attribute length */
  maxIdReferenceAttributeLength: 10_000,

  /** Maximum ID reference tokens */
  maxIdReferenceTokens: 50,

  /** Maximum ID reference targets per ID */
  maxIdReferenceTargetsPerId: 20,

  /** Maximum attribute name length */
  maxAttributeNameLength: 100,
} as const;

export type Bounds = typeof BOUNDS;