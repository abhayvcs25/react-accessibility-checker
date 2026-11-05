import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

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

    process.loadEnvFile(envFile);
  }
}

loadBackendEnv();
