import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBackendEnv } from '../src/env.js';

const variableNames = [
  'RAC_AI_ENABLED',
  'RAC_AI_MODEL',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
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
        'RAC_AI_ENABLED=1',
        'RAC_AI_MODEL=gemini-3.8-flash',
        'GEMINI_API_KEY=test-gemini-key',
      ].join('\n'),
    );
    writeFileSync(
      join(directory, '.env'),
      'GEMINI_API_KEY=root-gemini-key\nOPENROUTER_API_KEY=root-openrouter-key\n',
    );
    process.env.GEMINI_API_KEY = '';

    try {
      loadBackendEnv(backendDirectory);

      expect(process.env.RAC_AI_ENABLED).toBe('1');
      expect(process.env.RAC_AI_MODEL).toBe('gemini-3.8-flash');
      expect(process.env.GEMINI_API_KEY).toBe('test-gemini-key');
      expect(process.env.OPENROUTER_API_KEY).toBe('root-openrouter-key');
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
      'GEMINI_API_KEY=root-gemini-key\n',
    );

    try {
      loadBackendEnv(backendDirectory);

      expect(process.env.GEMINI_API_KEY).toBe('root-gemini-key');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
