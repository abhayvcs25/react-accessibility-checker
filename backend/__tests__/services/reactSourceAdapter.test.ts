import { describe, expect, it } from 'vitest';
import { adaptReactSourceSnapshot } from '../../src/services/reactSourceAdapter.js';
import { extractReactSourceTargets } from '../../src/services/reactSourceExtractor.js';

describe('adaptReactSourceSnapshot', () => {
  it('uses JSX source locators, preserves source uncertainty, and gates deferred rules', () => {
    const extraction = extractReactSourceTargets(
      'function ActionButton() { return <button {...props} className="primary">Save {recordName}</button>; }',
      'Action.tsx',
    );
    expect(extraction.status).toBe('available');
    if (extraction.status !== 'available') return;

    const adapted = adaptReactSourceSnapshot(extraction.snapshot);
    expect(adapted.status).toBe('ready');
    if (adapted.status !== 'ready') return;

    const unit = adapted.input.units.find(
      (candidate) => candidate.ruleId === 'BUTTON-PURPOSE-CLARITY',
    );
    expect(unit).toBeDefined();
    expect(unit?.sourceLanguage).toBe('tsx');
    expect(unit?.snippet).toContain('<button {...props} className="primary">');
    expect(unit?.sourceEvidence).toMatchObject({
      hasDynamicChildren: true,
      hasPropSpread: true,
      componentName: 'ActionButton',
      className: {
        status: 'present',
        value: { value: 'primary', truncated: false },
      },
    });
    expect(unit?.focal.sourceLocator?.kind).toBe('jsx-source-range');
    expect(adapted.input.units.some(
      (candidate) => candidate.ruleId === 'BUTTON-ACTION-CONSISTENCY',
    )).toBe(false);
  });

  it('passes resolved multi-token ARIA references and distinct relationship kinds', () => {
    const extraction = extractReactSourceTargets(
      '<><span id="one">First</span><span id="two">Last</span><input aria-labelledby="one two" aria-describedby="help" /><p id="help">Choose a value</p></>',
      'Fields.jsx',
    );
    expect(extraction.status).toBe('available');
    if (extraction.status !== 'available') return;

    const adapted = adaptReactSourceSnapshot(extraction.snapshot);
    expect(adapted.status).toBe('ready');
    if (adapted.status !== 'ready') return;

    const unit = adapted.input.units.find(
      (candidate) => candidate.ruleId === 'FORM-LABEL-AMBIGUITY',
    );
    expect(unit).toBeDefined();
    const labelledBy = unit?.relationships.filter(
      (relationship) => relationship.kind === 'aria-labelledby',
    );
    expect(labelledBy).toHaveLength(2);
    expect(unit?.associatedEvidence.map(({ evidence }) => evidence.text?.value)).toContain('First');
    expect(unit?.associatedEvidence.map(({ evidence }) => evidence.text?.value)).toContain('Last');
    expect(unit?.relationships.some(
      (relationship) => relationship.kind === 'aria-describedby',
    )).toBe(true);
  });
});
