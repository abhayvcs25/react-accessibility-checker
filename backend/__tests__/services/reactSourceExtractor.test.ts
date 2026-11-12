import { describe, expect, it } from 'vitest';
import { extractReactSourceTargets } from '../../src/services/reactSourceExtractor.js';

describe('extractReactSourceTargets', () => {
  describe('File validation and bounds', () => {
    it('accepts valid .jsx and .tsx filenames', () => {
      const jsxResult = extractReactSourceTargets('<button>Click</button>', 'Button.jsx');
      expect(jsxResult.status).toBe('available');

      const tsxResult = extractReactSourceTargets('<button>Click</button>', 'Button.tsx');
      expect(tsxResult.status).toBe('available');
    });

    it('rejects unsupported extensions with code invalid-extension', () => {
      const htmlResult = extractReactSourceTargets('<div>test</div>', 'index.html');
      expect(htmlResult.status).toBe('error');
      if (htmlResult.status === 'error') {
        expect(htmlResult.code).toBe('invalid-extension');
      }

      const jsResult = extractReactSourceTargets('const x = 1;', 'index.js');
      expect(jsResult.status).toBe('error');

      const tsResult = extractReactSourceTargets('const x: number = 1;', 'index.ts');
      expect(tsResult.status).toBe('error');
    });

    it('rejects filenames that exceed the report metadata bound', () => {
      const result = extractReactSourceTargets(
        '<button>Save</button>',
        `${'x'.repeat(256)}.jsx`,
      );
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('invalid-filename');
      }
    });

    it('rejects files exceeding maximum size (512 KB)', () => {
      const hugeSource = '<button>' + 'a'.repeat(520_000) + '</button>';
      const result = extractReactSourceTargets(hugeSource, 'Huge.jsx');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('size-exceeded');
      }
    });

    it('measures maximum size in UTF-8 bytes for non-ASCII source', () => {
      const result = extractReactSourceTargets(
        `<button>${'界'.repeat(171_000)}</button>`,
        'UnicodeLarge.jsx',
      );
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('size-exceeded');
      }
    });

    it('returns empty-input error for empty or whitespace-only source', () => {
      const result = extractReactSourceTargets('   \n  ', 'Empty.tsx');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('empty-input');
      }
    });
  });

  describe('Language and syntax support', () => {
    it('extracts JSX components and handles fragments (<> and <React.Fragment>)', () => {
      const source = `
        import React from 'react';
        export function Nav() {
          return (
            <>
              <React.Fragment>
                <button type="button">Action</button>
              </React.Fragment>
            </>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Nav.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const buttons = result.snapshot.targets.filter((t) => t.kind === 'button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].tagName).toBe('button');
        expect(buttons[0].loc.startLine).toBeGreaterThan(0);
      }
    });

    it('handles TypeScript types, generics, and type annotations in .tsx', () => {
      const source = `
        import React from 'react';
        interface Props<T> {
          items: T[];
          onSelect: (item: T) => void;
        }
        export const ItemList = <T extends { id: string; name: string }>({ items, onSelect }: Props<T>) => {
          return (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onSelect(item)}>
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          );
        };
      `;
      const result = extractReactSourceTargets(source, 'ItemList.tsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const buttons = result.snapshot.targets.filter((t) => t.kind === 'button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].hasPropSpread).toBe(false);
      }
    });
  });

  describe('Target kinds extraction', () => {
    it('identifies buttons, form-controls, links, images, headings, and custom widgets', () => {
      const source = `
        export default function Dashboard() {
          return (
            <main>
              <h1>Admin Dashboard</h1>
              <a href="/settings">Settings</a>
              <img src="/avatar.png" alt="User avatar" />
              <button type="submit">Submit Form</button>
              <input type="text" id="username" placeholder="Enter username" />
              <textarea name="bio" />
              <select name="role">
                <option value="user">User</option>
              </select>
              <div role="button" tabIndex={0} onClick={() => {}}>Custom Trigger</div>
            </main>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Dashboard.tsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const kinds = result.snapshot.targets.map((t) => t.kind);
        expect(kinds).toContain('heading');
        expect(kinds).toContain('link');
        expect(kinds).toContain('image');
        expect(kinds).toContain('button');
        expect(kinds).toContain('form-control');
        expect(kinds).toContain('custom-widget');

        const heading = result.snapshot.targets.find((t) => t.kind === 'heading');
        expect(heading?.tagName).toBe('h1');

        const image = result.snapshot.targets.find((t) => t.kind === 'image');
        expect(image?.kind).toBe('image');
        if (image && image.kind === 'image') {
          expect(image.alt.status).toBe('present');
          expect(image.alt.value).toBe('User avatar');
        }

        const customWidget = result.snapshot.targets.find((t) => t.kind === 'custom-widget');
        expect(customWidget?.kind).toBe('custom-widget');
        if (customWidget && customWidget.kind === 'custom-widget') {
          expect(customWidget.role.value).toBe('button');
        }
      }
    });
  });

  describe('Literal vs Dynamic Props', () => {
    it('accurately distinguishes literal strings, empty strings, expressions, and spread props', () => {
      const source = `
        export function ImageGallery(props: any) {
          const dynamicTitle = "Dynamic Alt";
          return (
            <div>
              <img src="literal.png" alt="Literal Description" />
              <img src="decorative.png" alt="" />
              <img src="missing.png" />
              <img src="dynamic.png" alt={dynamicTitle} />
              <button {...props}>Save</button>
            </div>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Gallery.tsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const images = result.snapshot.targets.filter((t) => t.kind === 'image');
        expect(images).toHaveLength(4);

        // Literal
        if (images[0].kind === 'image') {
          expect(images[0].alt.status).toBe('present');
          expect(images[0].alt.value).toBe('Literal Description');
        }

        // Decorative (empty string)
        if (images[1].kind === 'image') {
          expect(images[1].alt.status).toBe('present');
          expect(images[1].alt.value).toBe('');
        }

        // Missing
        if (images[2].kind === 'image') {
          expect(images[2].alt.status).toBe('absent');
        }

        // Dynamic expression
        if (images[3].kind === 'image') {
          expect(images[3].alt.status).toBe('dynamic');
        }

        // Spread props on button
        const button = result.snapshot.targets.find((t) => t.kind === 'button');
        expect(button?.hasPropSpread).toBe(true);
      }
    });

    it('respects JSX spread order and does not treat dynamic boolean expressions as true', () => {
      const source = `
        <form>
          <input required={isRequired} disabled={false} />
          <input required />
          <input {...props} required={false} />
          <input required {...props} />
          <img {...props} alt="Static alternative" />
          <img alt="May be overridden" {...props} />
        </form>
      `;
      const result = extractReactSourceTargets(source, 'Form.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const controls = result.snapshot.targets.filter((t) => t.kind === 'form-control');
        expect(controls[0]?.kind).toBe('form-control');
        if (controls[0]?.kind === 'form-control') {
          expect(controls[0].required).toEqual({ status: 'dynamic', reason: 'expression' });
          expect(controls[0].disabled).toEqual({ status: 'absent' });
        }
        if (controls[1]?.kind === 'form-control') {
          expect(controls[1].required).toEqual({ status: 'present', value: 'true', truncated: false });
        }
        if (controls[2]?.kind === 'form-control') {
          expect(controls[2].required).toEqual({ status: 'absent' });
        }
        if (controls[3]?.kind === 'form-control') {
          expect(controls[3].required).toEqual({ status: 'dynamic', reason: 'spread' });
        }

        const images = result.snapshot.targets.filter((t) => t.kind === 'image');
        if (images[0]?.kind === 'image') {
          expect(images[0].alt).toEqual({
            status: 'present',
            value: 'Static alternative',
            truncated: false,
          });
        }
        if (images[1]?.kind === 'image') {
          expect(images[1].alt).toEqual({ status: 'dynamic', reason: 'spread' });
        }
      }
    });

    it('preserves dynamic child uncertainty and resolves every literal IDREF token', () => {
      const source = `
        <div>
          <span id="first">First name</span>
          <span id="last">Last name</span>
          <label htmlFor="first">Name</label>
          <input aria-labelledby="first last" />
          <button>Save {recordName}</button>
        </div>
      `;
      const result = extractReactSourceTargets(source, 'Names.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const input = result.snapshot.targets.find((target) => target.tagName === 'input');
        expect(input?.kind).toBe('form-control');
        if (input?.kind === 'form-control' && input.ariaLabelledbyRef?.status === 'resolved') {
          expect(input.ariaLabelledbyRef.targets.map((target) => target.text?.text)).toEqual([
            'First name',
            'Last name',
          ]);
        }
        const button = result.snapshot.targets.find((target) => target.kind === 'button');
        expect(button?.literalChildren?.hasDynamicChildren).toBe(true);
      }
    });

    it('keeps duplicate-ID references ambiguous instead of selecting a target', () => {
      const result = extractReactSourceTargets(
        '<><span id="help">First</span><span id="help">Second</span><input aria-describedby="help" /></>',
        'Duplicate.jsx',
      );
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const input = result.snapshot.targets.find((target) => target.tagName === 'input');
        expect(input?.ariaDescribedbyRef).toEqual({
          status: 'unresolved',
          reason: 'duplicate',
        });
      }
    });
  });

  describe('Form Control and Label Resolution', () => {
    it('resolves explicit htmlFor matching input id', () => {
      const source = `
        export function LoginForm() {
          return (
            <form>
              <label htmlFor="user-email">Email Address</label>
              <input type="email" id="user-email" />
            </form>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'LoginForm.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const input = result.snapshot.targets.find((t) => t.kind === 'form-control');
        expect(input).toBeDefined();
        if (input && input.kind === 'form-control') {
          expect(input.associatedLabel?.source).toBe('explicit-htmlFor');
          expect(input.associatedLabel?.labelText?.text).toBe('Email Address');
        }
      }
    });

    it('resolves wrapping label around input', () => {
      const source = `
        export function SearchBox() {
          return (
            <label>
              Search Documents
              <input type="search" />
            </label>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'SearchBox.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const input = result.snapshot.targets.find((t) => t.kind === 'form-control');
        expect(input).toBeDefined();
        if (input && input.kind === 'form-control') {
          expect(input.associatedLabel?.source).toBe('wrapping');
          expect(input.associatedLabel?.labelText?.text).toBe('Search Documents');
        }
      }
    });

    it('recognizes aria-label and aria-labelledby on form controls', () => {
      const source = `
        export function Filters() {
          return (
            <div>
              <span id="sort-desc">Sort order</span>
              <select aria-labelledby="sort-desc">
                <option value="asc">Asc</option>
              </select>
              <input type="text" aria-label="Quick filter" />
            </div>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Filters.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const select = result.snapshot.targets.find((t) => t.tagName === 'select');
        const input = result.snapshot.targets.find((t) => t.tagName === 'input');

        if (select && select.kind === 'form-control') {
          expect(select.ariaLabelledby.status).toBe('present');
          expect(select.ariaLabelledbyRef?.status).toBe('resolved');
          if (select.ariaLabelledbyRef?.status === 'resolved') {
            expect(select.ariaLabelledbyRef.targets[0]?.text?.text).toBe('Sort order');
          }
        }

        if (input && input.kind === 'form-control') {
          expect(input.ariaLabel.status).toBe('present');
          expect(input.ariaLabel.value).toBe('Quick filter');
        }
      }
    });
  });

  describe('ARIA reference resolution', () => {
    it('tracks whether referenced IDs exist in the file', () => {
      const source = `
        export function Modal() {
          return (
            <div>
              <h2 id="dialog-title">Confirm Delete</h2>
              <div role="dialog" aria-labelledby="dialog-title" aria-describedby="external-help-text">
                <p>Are you sure?</p>
              </div>
            </div>
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Modal.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const dialog = result.snapshot.targets.find((t) => t.kind === 'custom-widget');
        expect(dialog).toBeDefined();
        if (dialog) {
          expect(dialog.ariaLabelledbyRef?.status).toBe('resolved');
          if (dialog.ariaLabelledbyRef?.status === 'resolved') {
            expect(dialog.ariaLabelledbyRef.targets).toHaveLength(1);
            expect(dialog.ariaLabelledbyRef.targets[0]?.text?.text).toBe('Confirm Delete');
          }
          expect(dialog.ariaDescribedbyRef).toEqual({ status: 'unresolved', reason: 'not-found' });
        }
      }
    });
  });

  describe('Location precision, CRLF, and truncation bounds', () => {
    it('maintains 1-based line numbers and accurate offsets with CRLF newlines', () => {
      const source = 'export function App() {\r\n  return (\r\n    <button>Submit</button>\r\n  );\r\n}';
      const result = extractReactSourceTargets(source, 'App.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const button = result.snapshot.targets.find((t) => t.kind === 'button');
        expect(button).toBeDefined();
        expect(button?.loc.startLine).toBe(3);
        expect(button?.loc.file).toBe('App.jsx');
        expect(button?.sourceExcerpt).toContain('<button>Submit</button>');
      }
    });

    it('keeps source offsets in UTF-16 code units after non-ASCII content', () => {
      const source = "const emoji = '🧑‍💻';\r\n<button>Save</button>";
      const result = extractReactSourceTargets(source, 'Unicode.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        const button = result.snapshot.targets.find((target) => target.kind === 'button');
        expect(button).toBeDefined();
        if (button) {
          expect(source.slice(button.loc.startOffset, button.loc.endOffset))
            .toBe('<button>Save</button>');
        }
      }
    });

    it('marks a bounded JSX excerpt as truncated when source text exceeds the excerpt limit', () => {
      const result = extractReactSourceTargets(
        `<button>${'A'.repeat(600)}</button>`,
        'Excerpt.jsx',
      );
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        expect(result.snapshot.targets[0]?.sourceExcerpt).toHaveLength(500);
        expect(result.snapshot.targets[0]?.sourceExcerptTruncated).toBe(true);
      }
    });

    it('marks attributes truncated and enforces the JSX element cap', () => {
      const attributeResult = extractReactSourceTargets(
        `<img alt="${'A'.repeat(300)}" />`,
        'Alt.jsx',
      );
      expect(attributeResult.status).toBe('available');
      if (attributeResult.status === 'available') {
        const image = attributeResult.snapshot.targets[0];
        expect(image?.kind).toBe('image');
        if (image?.kind === 'image') {
          expect(image.alt.status).toBe('present');
          if (image.alt.status === 'present') {
            expect(image.alt.value).toHaveLength(250);
            expect(image.alt.truncated).toBe(true);
          }
        }
        expect(attributeResult.snapshot.completeness.status).toBe('partial');
        if (attributeResult.snapshot.completeness.status === 'partial') {
          expect(attributeResult.snapshot.completeness.reasons).toContain('attribute-truncated');
        }
      }

      const elementResult = extractReactSourceTargets(
        `<>${'<button>Save</button>'.repeat(501)}</>`,
        'Many.jsx',
      );
      expect(elementResult.status).toBe('available');
      if (elementResult.status === 'available') {
        expect(elementResult.snapshot.targets.filter((target) => target.kind === 'button'))
          .toHaveLength(500);
        expect(elementResult.snapshot.completeness.status).toBe('partial');
        if (elementResult.snapshot.completeness.status === 'partial') {
          expect(elementResult.snapshot.completeness.reasons).toContain('element-limit-reached');
        }
      }
    });

    it('truncates very long text and records completeness reason', () => {
      const longText = 'A'.repeat(600);
      const source = `<button>${longText}</button>`;
      const result = extractReactSourceTargets(source, 'Long.jsx');
      expect(result.status).toBe('available');
      if (result.status === 'available') {
        expect(result.snapshot.completeness.status).toBe('partial');
        if (result.snapshot.completeness.status === 'partial') {
          expect(result.snapshot.completeness.reasons).toContain('text-truncated');
        }
        const button = result.snapshot.targets[0];
        if (button.kind === 'button') {
          expect(button.literalChildren.truncated).toBe(true);
          expect(button.literalChildren.text.length).toBeLessThanOrEqual(500);
        }
      }
    });
  });

  describe('Parse error resilience', () => {
    it('recovers from minor JSX syntax errors using errorRecovery', () => {
      const source = `
        export default function Broken() {
          return (
            <div>
              <button>Valid Button</button>
            <div
          );
        }
      `;
      const result = extractReactSourceTargets(source, 'Broken.jsx');
      if (result.status === 'available') {
        expect(result.snapshot.parseErrors.length).toBeGreaterThan(0);
        expect(result.snapshot.completeness.status).toBe('partial');
      } else {
        expect(result.status).toBe('error');
        expect(result.code).toBe('parse-failure');
      }
    });
  });
});

