import { BOUNDS } from '../config/bounds.js';
import {
  DENY_SEGMENTS,
  SECRET_FILENAMES,
  SECRET_EXTENSIONS,
  DENY_EXTENSIONS,
  ALLOWED_EXTENSIONS,
  CONFIG_FILENAMES,
  isDeniedSegment,
  isSecretFilename,
  isAllowedExtension,
  isConfigFile,
} from './projectIntakeClassifier.js';

export const PROJECT_INTAKE_LIMITS = {
  maxAcceptedFiles: BOUNDS.maxAcceptedFiles,
  maxInspectedFiles: BOUNDS.maxInspectedFiles,
  maxFileBytes: BOUNDS.maxFileBytes,
  maxTotalAcceptedBytes: BOUNDS.maxTotalAcceptedBytes,
  maxRelativePathLength: BOUNDS.maxRelativePathLength,
  maxPathSegments: BOUNDS.maxPathSegments,
  maxProjectLabelLength: BOUNDS.maxProjectLabelLength,
  multipartTransportCeiling: BOUNDS.multipartTransportCeiling,
} as const;

// Re-export classifier constants and functions for backward compatibility
export {
  ALLOWED_EXTENSIONS,
  CONFIG_FILENAMES,
  DENY_SEGMENTS,
  SECRET_FILENAMES,
  SECRET_EXTENSIONS,
  DENY_EXTENSIONS,
  isConfigFile,
  isAllowedExtension,
  isDeniedSegment,
  isSecretFilename,
  isDeniedSegment as isDeniedFilename, // alias for backward compat
};
