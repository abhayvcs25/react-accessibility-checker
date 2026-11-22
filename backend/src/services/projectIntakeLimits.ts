export const PROJECT_INTAKE_LIMITS = {
  maxAcceptedFiles: 200,
  maxInspectedFiles: 500,
  maxFileBytes: 512_000,
  maxTotalAcceptedBytes: 4_000_000,
  maxRelativePathLength: 240,
  maxPathSegments: 16,
  maxProjectLabelLength: 120,
  multipartTransportCeiling: 10_000_000,
} as const;

export const ALLOWED_EXTENSIONS = new Set([
  '.jsx',
  '.tsx',
  '.js',
  '.ts',
  '.html',
  '.htm',
]);

export const CONFIG_FILENAMES = new Set(['tsconfig.json', 'jsconfig.json']);

export const DENY_SEGMENTS = [
  '.env',
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'out',
  'secrets',
  'private',
];

export const SECRET_FILENAMES = new Set([
  'credentials.json',
  'id_rsa',
  'id_dsa',
]);

export const SECRET_EXTENSIONS = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.cer',
  '.crt',
];

export const DENY_EXTENSIONS = new Set([
  ...SECRET_EXTENSIONS,
  '.map',
  '.lock',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
]);

export function isConfigFile(filename: string): boolean {
  return CONFIG_FILENAMES.has(filename.toLowerCase());
}

export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

export function isDeniedSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (lower.startsWith('.env')) return true;
  return DENY_SEGMENTS.includes(lower);
}

export function isSecretFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (SECRET_FILENAMES.has(lower)) return true;
  for (const ext of SECRET_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function isDeniedFilename(filename: string): boolean {
  return isSecretFilename(filename);
}
