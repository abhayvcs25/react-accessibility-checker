import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (typeof process.loadEnvFile === 'function') {
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}
