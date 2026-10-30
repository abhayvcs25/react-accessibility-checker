import { describe, expect, it } from 'vitest';
import { extractHtmlContext } from '../../src/services/contextExtraction.js';

function getElement(
  html: string,
  tagName: string,
  index = 0,
) {
  const matches = extractHtmlContext(html).elements.filter(
    (element) => element.tagName === tagName,
  );
  const element = matches[index];
  if (!element) {
    throw new Error(`Expected ${tagName} context at index ${index}`);
  }
  return element;
}

describe('extractHtmlContext', () => {
  it('distinguishes missing image alt from an explicitly empty alt', () => {
    const snapshot = extractHtmlContext(
      '<img src="first.png"><img src="second.png" alt="">',
    );

    expect(snapshot.elements).toHaveLength(2);
    expect(snapshot.elements[0]?.attributes).not.toHaveProperty('alt');
    expect(snapshot.elements[0]?.nameEvidence).not.toContainEqual({
      source: 'alt',
    });
    expect(snapshot.elements[1]?.attributes.alt).toBe('');
    expect(snapshot.elements[1]?.nameEvidence).toContainEqual({
      source: 'alt',
    });
  });

  it('preserves nested link and image relationships without copying subtrees', () => {
    const snapshot = extractHtmlContext(
      '<a href="/report"><img alt="Annual report"></a>',
    );
    const link = snapshot.elements.find((element) => element.tagName === 'a');
    const image = snapshot.elements.find((element) => element.tagName === 'img');

    expect(link?.kind).toBe('link');
    expect(image?.kind).toBe('image');
    expect(link?.relationships.childContextIds).toEqual([image?.contextId]);
    expect(image?.relationships.parentContextId).toBe(link?.contextId);
  });

  it('resolves explicit and wrapping labels', () => {
    const snapshot = extractHtmlContext(
      '<label for="email">Work email</label><input id="email">' +
        '<label>Phone<input id="phone"></label>',
    );
    const email = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'email',
    );
    const phone = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'phone',
    );

    expect(email?.relationships.labelContextIds).toHaveLength(1);
    expect(email?.nameEvidence).toContainEqual({
      source: 'explicit-label',
      targetContextIds: email?.relationships.labelContextIds,
    });
    expect(phone?.relationships.labelContextIds).toHaveLength(1);
    expect(phone?.nameEvidence).toContainEqual({
      source: 'wrapping-label',
      targetContextIds: phone?.relationships.labelContextIds,
    });
  });

  it('associates explicit labels only with the first matching labelable element', () => {
    const snapshot = extractHtmlContext(
      '<div id="blocked">Not labelable</div><input id="blocked">' +
        '<input id="duplicate"><input id="duplicate">' +
        '<label for="blocked">Blocked label</label>' +
        '<label for="duplicate">Duplicate label</label>',
    );
    const blockedControls = snapshot.elements.filter(
      (element) => element.tagName === 'input' &&
        element.attributes.authoredId === 'blocked',
    );
    const duplicateControls = snapshot.elements.filter(
      (element) => element.tagName === 'input' &&
        element.attributes.authoredId === 'duplicate',
    );

    expect(blockedControls[0]?.relationships.labelContextIds).toEqual([]);
    expect(duplicateControls[0]?.relationships.labelContextIds).toHaveLength(1);
    expect(duplicateControls[1]?.relationships.labelContextIds).toEqual([]);
  });

  it('does not associate native labels with non-labelable ARIA-role controls', () => {
    const snapshot = extractHtmlContext(
      '<label for="custom">Custom action</label>' +
        '<div id="custom" role="button">Run</div>' +
        '<label>Custom wrapper <div role="button">Inside</div></label>',
    );
    const customControls = snapshot.elements.filter(
      (element) => element.attributes.role === 'button',
    );

    expect(customControls).toHaveLength(2);
    expect(customControls[0]?.relationships.labelContextIds).toEqual([]);
    expect(customControls[1]?.relationships.labelContextIds).toEqual([]);
  });

  it('associates a wrapping label with only its first labelable descendant', () => {
    const snapshot = extractHtmlContext(
      '<label>Contact <input id="first"><input id="second"></label>' +
        '<label for="missing">Explicit only <input id="not-wrapped"></label>',
    );
    const first = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'first',
    );
    const second = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'second',
    );
    const explicitlyTargetedMissing = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'not-wrapped',
    );

    expect(first?.relationships.labelContextIds).toHaveLength(1);
    expect(second?.relationships.labelContextIds).toEqual([]);
    expect(explicitlyTargetedMissing?.relationships.labelContextIds).toEqual(
      [],
    );
  });

  it('resolves ARIA references and safely retains duplicate IDs and cycles', () => {
    const snapshot = extractHtmlContext(
      '<span id="label">Label one</span><span id="label">Label two</span>' +
        '<button id="action" aria-labelledby="label action missing" ' +
        'aria-describedby="help"></button><span id="help">Help</span>',
    );
    const button = snapshot.elements.find(
      (element) => element.attributes.authoredId === 'action',
    );

    expect(button?.relationships.labelledByContextIds).toHaveLength(3);
    expect(button?.relationships.labelledByContextIds).toContain(
      button?.contextId,
    );
    expect(button?.relationships.describedByContextIds).toHaveLength(1);
    expect(button?.nameEvidence).toContainEqual({
      source: 'aria-labelledby',
      targetContextIds: button?.relationships.labelledByContextIds,
    });
    expect(
      snapshot.elements.every((element) => element.contextId.length > 0),
    ).toBe(true);
  });

  it('parses malformed markup and HTML fragments', () => {
    const snapshot = extractHtmlContext(
      '<section><h2>Fragment heading<h2><img alt="Map"><button>Go',
    );

    expect(snapshot.elements.map((element) => element.tagName)).toEqual([
      'h2',
      'h2',
      'img',
      'button',
    ]);
    expect(snapshot.elements[0]?.text?.ownText).toBe('Fragment heading');
    expect(snapshot.elements[3]?.text?.ownText).toBe('Go');
  });

  it('truncates captured text and omits script and stylesheet content', () => {
    const snapshot = extractHtmlContext(
      `<h1>${'Heading '.repeat(100)}</h1><p>${'Nearby '.repeat(40)}</p>` +
        '<script>script-private-content</script>' +
        '<style>.stylesheet-private-content { color: red }</style>',
    );
    const heading = snapshot.elements[0];

    expect(heading?.text?.ownText).toHaveLength(500);
    expect(heading?.text?.nearbyText?.length).toBeLessThanOrEqual(200);
    expect(heading?.text?.truncated).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('script-private-content');
    expect(JSON.stringify(snapshot)).not.toContain(
      'stylesheet-private-content',
    );
  });

  it('excludes editable text through inherited states and honors false boundaries', () => {
    const snapshot = extractHtmlContext(
      '<div contenteditable="true">' +
        '<span role="button">outer editable secret</span>' +
        '<section contenteditable="false">' +
        '<span role="button">noneditable boundary text</span>' +
        '<div contenteditable="true"><span role="button">inner editable secret</span></div>' +
        '</section>' +
        '</div>' +
        '<div contenteditable="false">' +
        '<span role="button">noneditable outer text</span>' +
        '<div contenteditable="true"><span role="button">nested editable secret</span></div>' +
        '</div>' +
        '<div contenteditable="true">' +
        '<div contenteditable="invalid"><span role="button">inherited editable secret</span></div>' +
        '</div>',
    );
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain('outer editable secret');
    expect(serialized).not.toContain('inner editable secret');
    expect(serialized).not.toContain('nested editable secret');
    expect(serialized).not.toContain('inherited editable secret');
    expect(serialized).toContain('noneditable boundary text');
    expect(serialized).toContain('noneditable outer text');
  });

  it('caps extracted elements and generates unique, consistent context IDs', () => {
    for (const [count, truncated] of [
      [499, false],
      [500, false],
      [501, true],
    ] as const) {
      const snapshot = extractHtmlContext('<img>'.repeat(count));
      const ids = new Set(snapshot.elements.map((element) => element.contextId));

      expect(snapshot.elements).toHaveLength(Math.min(count, 500));
      expect(snapshot.elementsTruncated).toBe(truncated);
      expect(ids.size).toBe(snapshot.elements.length);
      for (const element of snapshot.elements) {
        expect(
          element.relationships.childContextIds.every((id) => ids.has(id)),
        ).toBe(true);
        expect(
          element.relationships.labelledByContextIds.every((id) =>
            ids.has(id),
          ),
        ).toBe(true);
        expect(
          element.relationships.describedByContextIds.every((id) =>
            ids.has(id),
          ),
        ).toBe(true);
      }
    }
  });

  it('marks a resolved ARIA target omitted by the element cap', () => {
    const snapshot = extractHtmlContext(
      '<button aria-labelledby="late-label">Run</button>' +
        '<img>'.repeat(499) +
        '<span id="late-label">Accessible label text</span>',
    );
    const button = snapshot.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(snapshot.elementsTruncated).toBe(true);
    expect(button?.relationships.labelledByContextIds).toEqual([]);
    expect(button?.relationships.labelledByTargetsOmitted).toBe(true);
  });

  it('marks a known native label omitted by the element cap', () => {
    const snapshot = extractHtmlContext(
      '<input id="email">' +
        '<img>'.repeat(499) +
        '<label for="email">Email address</label>',
    );
    const input = snapshot.elements.find(
      (element) => element.tagName === 'input',
    );

    expect(snapshot.elements).toHaveLength(500);
    expect(snapshot.elementsTruncated).toBe(true);
    expect(input?.relationships.labelContextIds).toEqual([]);
    expect(input?.relationships.labelTargetsOmitted).toBe(true);
  });

  it('does not mark an ARIA target skipped by policy as cap-omitted', () => {
    const snapshot = extractHtmlContext(
      '<button aria-labelledby="script-label">Run</button>' +
        '<script id="script-label">ignored label</script>',
    );
    const button = snapshot.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(snapshot.elementsTruncated).toBe(false);
    expect(button?.relationships.labelledByContextIds).toEqual([]);
    expect(button?.relationships.labelledByTargetsOmitted).toBeUndefined();
  });

  it('bounds ARIA ID-reference tokens at the configured per-attribute limit', () => {
    const references = Array.from({ length: 50 }, (_, index) => `target-${index}`);
    const targets = references
      .map((id) => `<span id="${id}">Label</span>`)
      .join('');
    const atLimit = extractHtmlContext(
      `<button aria-labelledby="${references.join(' ')}">Run</button>${targets}`,
    );
    const overLimit = extractHtmlContext(
      `<button aria-labelledby="${[...references, 'target-50'].join(' ')}">` +
        `Run</button>${targets}<span id="target-50">Extra</span>`,
    );
    const atLimitButton = atLimit.elements.find(
      (element) => element.tagName === 'button',
    );
    const overLimitButton = overLimit.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(atLimitButton?.relationships.labelledByContextIds).toHaveLength(50);
    expect(
      atLimitButton?.relationships.labelledByReferencesTruncated,
    ).toBeUndefined();
    expect(
      overLimitButton?.relationships.labelledByContextIds,
    ).toHaveLength(50);
    expect(
      overLimitButton?.relationships.labelledByReferencesTruncated,
    ).toBe(true);
  });

  it('does not truncate an IDREF value at exactly 10,000 characters', () => {
    const value = `target${' '.repeat(9_994)}`;
    expect(value).toHaveLength(10_000);
    const snapshot = extractHtmlContext(
      `<button aria-labelledby="${value}">Run</button>` +
        '<span id="target">Label</span>',
    );
    const button = snapshot.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(button?.relationships.labelledByContextIds).toHaveLength(1);
    expect(
      button?.relationships.labelledByReferencesTruncated,
    ).toBeUndefined();
  });

  it('bounds overlong ARIA ID-reference values and duplicate-ID target expansion', () => {
    const longValue = extractHtmlContext(
      `<button aria-labelledby="${'x'.repeat(10_001)}">Run</button>`,
    );
    const duplicateTargets = extractHtmlContext(
      '<button aria-labelledby="duplicate">Run</button>' +
        '<span id="duplicate">Label</span>'.repeat(21),
    );
    const longValueButton = longValue.elements.find(
      (element) => element.tagName === 'button',
    );
    const duplicateButton = duplicateTargets.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(
      longValueButton?.relationships.labelledByReferencesTruncated,
    ).toBe(true);
    expect(longValueButton?.relationships.labelledByContextIds).toEqual([]);
    expect(
      duplicateButton?.relationships.labelledByContextIds,
    ).toHaveLength(20);
    expect(duplicateButton?.relationships.labelledByTargetsTruncated).toBe(
      true,
    );
  });

  it('bounds duplicate target expansion across multiple IDREF tokens', () => {
    const snapshot = extractHtmlContext(
      '<button aria-labelledby="first second">Run</button>' +
        '<span id="first">First</span>'.repeat(21) +
        '<span id="second">Second</span>'.repeat(21),
    );
    const button = snapshot.elements.find(
      (element) => element.tagName === 'button',
    );

    expect(button?.relationships.labelledByContextIds).toHaveLength(40);
    expect(button?.relationships.labelledByTargetsTruncated).toBe(true);
  });

  it('does not capture live values, full URLs, or embedded executable/style text', () => {
    const snapshot = extractHtmlContext(
      '<input name="email" value="typed private value">' +
        '<a href="https://example.test/private?token=secret">Open</a>' +
        '<textarea>live textarea secret</textarea>' +
        '<div contenteditable="true" role="textbox">live editor secret</div>' +
        '<script>embedded-private-script</script>' +
        '<style>embedded-private-style</style>',
    );
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain('typed private value');
    expect(serialized).not.toContain('live textarea secret');
    expect(serialized).not.toContain('live editor secret');
    expect(serialized).not.toContain('https://example.test/private');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('embedded-private-script');
    expect(serialized).not.toContain('embedded-private-style');
    expect(getElement('<a href="#section">Open</a>', 'a').attributes.hrefKind)
      .toBe('fragment');
    expect(getElement('<a href="/path">Open</a>', 'a').attributes.hrefKind).toBe(
      'same-document',
    );
    expect(
      getElement(
        '<a href="https://context.invalid/private?token=secret">Open</a>',
        'a',
      ).attributes.hrefKind,
    ).toBe('external');
    expect(
      getElement(
        '<a href="https://example.test/private?token=secret">Open</a>',
        'a',
      ).attributes.hrefKind,
    ).toBe('external');
  });

  it('includes image inputs without requiring ARIA attributes', () => {
    const imageInput = getElement(
      '<input type="image" alt="Search">',
      'input',
    );

    expect(imageInput.kind).toBe('image');
    expect(imageInput.attributes.inputType).toBe('image');
    expect(imageInput.attributes.alt).toBe('Search');
    expect(imageInput.attributes.aria).toEqual({});
  });

  it('bounds ARIA attribute names and values and caps accepted attributes', () => {
    const maximumName = `aria-${'a'.repeat(95)}`;
    const oversizedName = `aria-${'b'.repeat(96)}`;
    const countAttributes = Array.from(
      { length: 21 },
      (_, index) => `aria-test-${index}="value-${index}"`,
    ).join(' ');
    const snapshot = extractHtmlContext(
      `<div role="region" ${maximumName}="${'v'.repeat(250)}" ` +
        `${oversizedName}="rejected" aria-short="${'x'.repeat(251)}" ` +
        `${countAttributes}></div>`,
    );
    const region = snapshot.elements[0];
    const aria = region?.attributes.aria ?? {};

    expect(aria[maximumName]).toHaveLength(250);
    expect(aria).not.toHaveProperty(oversizedName);
    expect(aria['aria-short']).toHaveLength(250);
    expect(Object.keys(aria)).toHaveLength(20);
    expect(Object.keys(aria).every((name) => name.length <= 100)).toBe(true);
    expect(
      Object.values(aria).every((value) => value.length <= 250),
    ).toBe(true);
  });

  it('labels captured text as content, not rendered visibility', () => {
    const button = getElement('<button>Continue</button>', 'button');

    expect(button.nameEvidence).toContainEqual({ source: 'text-content' });
    expect(button.nameEvidence).not.toContainEqual({
      source: 'visible-text',
    });
  });
});
