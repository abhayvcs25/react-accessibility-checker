import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractHtmlContextResultV2 } from '../../src/services/contextExtractionV2.js';

const fixturesDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../test-fixtures/accessibility-known-cases',
);

const expectedTargetKindByRule = new Map<string, string>([
  ['01', 'image'],
  ['02', 'image'],
  ['03', 'image'],
  ['04', 'button'],
  ['05', 'button'],
  ['06', 'button'],
  ['07', 'link'],
  ['08', 'link'],
  ['09', 'link'],
  ['10', 'form-control'],
  ['11', 'form-control'],
  ['12', 'form-control'],
  ['13', 'custom-widget'],
  ['14', 'button'],
  ['15', 'button'],
  ['16', 'heading'],
  ['17', 'heading'],
  ['18', 'form-control'],
  ['19', 'form-control'],
  ['20', 'link'],
]);

describe('accessibility known-case extraction', () => {
  it('extracts the intended target kind from every paired fixture without provider calls', async () => {
    const filenames = (await readdir(fixturesDirectory))
      .filter((name) => /^\d{2}-.+-(?:no-)?violation\.html$/.test(name))
      .sort();

    expect(filenames).toHaveLength(40);

    for (const filename of filenames) {
      const ruleNumber = filename.slice(0, 2);
      const expectedKind = expectedTargetKindByRule.get(ruleNumber);
      const html = await readFile(join(fixturesDirectory, filename), 'utf8');
      const extraction = extractHtmlContextResultV2(
        html,
        'single-document',
        filename,
      );

      expect(extraction.status, filename).toBe('available');
      if (extraction.status !== 'available') {
        throw new Error(`Could not extract ${filename}.`);
      }

      expect(
        extraction.snapshot.targets.some(
          (target) => target.kind === expectedKind,
        ),
        filename,
      ).toBe(true);
      expect(extraction.projectContext.targetEvidence).toHaveLength(
        extraction.snapshot.targets.length,
      );
    }
  });

  it('keeps the two aria-naming buttons distinct from IBM DOM paths', async () => {
    const filename = '14-aria-naming-consistency-violation.html';
    const html = await readFile(join(fixturesDirectory, filename), 'utf8');
    const extraction = extractHtmlContextResultV2(
      html,
      'single-document',
      filename,
    );

    expect(extraction.status).toBe('available');
    if (extraction.status !== 'available') {
      throw new Error(`Could not extract ${filename}.`);
    }

    expect(
      extraction.snapshot.targets
        .filter((target) => target.kind === 'button')
        .map((target) => target.text?.value),
    ).toEqual(['Remove', 'Cancel']);
  });
});
