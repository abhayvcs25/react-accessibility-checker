import { describe, expect, it, vi } from 'vitest';

vi.mock('parse5', async (importOriginal) => {
  const original = await importOriginal<typeof import('parse5')>();
  return {
    ...original,
    parse: (...args: Parameters<typeof original.parse>) => {
      const document = original.parse(...args);
      const pending: unknown[] = [document];
      while (pending.length > 0) {
        const node = pending.pop();
        if (typeof node !== 'object' || node === null) continue;
        Reflect.deleteProperty(node, 'sourceCodeLocation');
        const children = (node as { childNodes?: unknown[] }).childNodes;
        if (Array.isArray(children)) pending.push(...children);
      }
      return document;
    },
  };
});

import { extractHtmlContextV2 } from '../../src/services/contextExtractionV2.js';

describe('context V2 source locator fallback', () => {
  it('uses a deterministic DOM path when parser source offsets are unavailable', () => {
    const snapshot = extractHtmlContextV2(
      '<main><button>Run</button></main>',
    );
    const locator = snapshot.targets[0]?.sourceLocator;

    expect(locator).toEqual({
      kind: 'dom-path',
      format: 'element-index-path-v1',
      path: '/html[1]/body[1]/main[1]/button[1]',
    });
  });
});
