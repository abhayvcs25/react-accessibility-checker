import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const envVariables = [
  'RAC_AI_ENABLED',
  'RAC_AI_MODEL',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
];

export function loadBackendEnv(directory = backendDirectory): void {
  const envFiles = [
    join(directory, '.env'),
    join(directory, '..', '.env'),
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }
    if (typeof process.loadEnvFile !== 'function') {
      throw new Error(
        `Loading ${envFile} requires Node.js with process.loadEnvFile support.`,
      );
    }

    const emptyVariables = envVariables.filter(
      (name) => process.env[name] !== undefined && !process.env[name]?.trim(),
    );
    for (const name of emptyVariables) {
      delete process.env[name];
    }
    process.loadEnvFile(envFile);
  }
}

loadBackendEnv();
