import { describe, expect, it } from 'vitest';
import { extractHtmlContext } from '../../src/services/contextExtraction.js';

describe('deprecated extractHtmlContext compatibility projection', () => {
  it('preserves the V1 single-document shape for common targets', () => {
    const snapshot = extractHtmlContext(
      '<a href="/report"><img alt="Annual report"></a>' +
        '<label for="email">Work email</label><input id="email">',
    );
    const link = snapshot.elements.find((element) => element.tagName === 'a');
    const image = snapshot.elements.find((element) => element.tagName === 'img');
    const input = snapshot.elements.find((element) => element.tagName === 'input');

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.elementsTruncated).toBe(false);
    expect(link?.kind).toBe('link');
    expect(link?.relationships.childContextIds).toContain(image?.contextId);
    expect(image?.relationships.parentContextId).toBe(link?.contextId);
    expect(input?.relationships.labelContextIds).toHaveLength(1);
    expect(input?.nameEvidence).toContainEqual(
      expect.objectContaining({ source: 'explicit-label' }),
    );
  });

  it('keeps absent and explicitly empty image alternatives distinct', () => {
    const snapshot = extractHtmlContext(
      '<img src="first.png"><img src="second.png" alt="">',
    );
    const images = snapshot.elements.filter((element) => element.tagName === 'img');

    expect(images).toHaveLength(2);
    expect(images[0]?.attributes).not.toHaveProperty('alt');
    expect(images[0]?.nameEvidence).not.toContainEqual({ source: 'alt' });
    expect(images[1]?.attributes.alt).toBe('');
    expect(images[1]?.nameEvidence).toContainEqual({ source: 'alt' });
  });

  it('uses the V2 resolver for ARIA references and preserves source locators', () => {
    const snapshot = extractHtmlContext(
      '<button aria-labelledby="label">Go</button>' +
        '<span id="label">Open menu</span>',
    );
    const button = snapshot.elements.find((element) => element.tagName === 'button');
    const label = snapshot.elements.find((element) => element.tagName === 'span');

    expect(button?.relationships.labelledByContextIds).toEqual([
      label?.contextId,
    ]);
    expect(button?.attributes.aria['aria-labelledby']).toBe('label');
  });

  it('excludes editable text and executable/style contents', () => {
    const snapshot = extractHtmlContext(
      '<div contenteditable="true"><span role="button">private editor text</span></div>' +
        '<script>private script</script><style>private style</style>' +
        '<button>Save</button>',
    );
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain('private editor text');
    expect(serialized).not.toContain('private script');
    expect(serialized).not.toContain('private style');
    expect(snapshot.elements.some((element) => element.tagName === 'button')).toBe(
      true,
    );
  });

  it('reports the existing single-document extraction cap', () => {
    const snapshot = extractHtmlContext('<img>'.repeat(501));

    expect(snapshot.elements).toHaveLength(500);
    expect(snapshot.elementsTruncated).toBe(true);
  });
});
