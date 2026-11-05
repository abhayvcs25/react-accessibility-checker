import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBackendEnv } from '../src/env.js';

const variableNames = [
  'RAC_LOG_ANALYSIS',
  'PORT',
] as const;
const previousValues = new Map(
  variableNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of variableNames) {
    const value = previousValues.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('backend environment loading', () => {
  beforeEach(() => {
    for (const name of variableNames) {
      delete process.env[name];
    }
  });

  it('loads backend/.env from the backend path and fills blank inherited values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rac-env-'));
    const backendDirectory = join(directory, 'backend');
    mkdirSync(backendDirectory);
    writeFileSync(
      join(backendDirectory, '.env'),
      [
        'RAC_LOG_ANALYSIS=0',
      ].join('\n'),
    );
    writeFileSync(
      join(directory, '.env'),
      'PORT=3001\n',
    );

    try {
      loadBackendEnv(backendDirectory);

      expect(process.env.RAC_LOG_ANALYSIS).toBe('0');
      expect(process.env.PORT).toBe('3001');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads a repository-root .env when backend/.env is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rac-env-'));
    const backendDirectory = join(directory, 'backend');
    mkdirSync(backendDirectory);
    writeFileSync(
      join(directory, '.env'),
      'PORT=3002\n',
    );

    try {
      loadBackendEnv(backendDirectory);

      expect(process.env.PORT).toBe('3002');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
