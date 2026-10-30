import { describe, expect, it } from 'vitest';
import {
  adaptContextSnapshotV2,
} from '../../src/services/contextAdapterV2.js';
import {
  extractHtmlContextResultV2,
  extractHtmlContextV2,
} from '../../src/services/contextExtractionV2.js';

describe('extractHtmlContextV2', () => {
  it('separates a native control target from label and description evidence', () => {
    const snapshot = extractHtmlContextV2(
      '<!doctype html><html lang="en"><head><title>Account</title></head>' +
        '<body><label for="email">Work email</label>' +
        '<input id="email" name="email" aria-describedby="hint">' +
        '<p id="hint">Used for account notices.</p></body></html>',
    );
    const target = snapshot.targets.find(
      (item) => item.tagName === 'input',
    );

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.document).toEqual({
      title: { status: 'present', value: 'Account', truncated: false },
      language: { status: 'present', value: 'en', truncated: false },
    });
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.evidence.map((item) => item.kind)).toEqual([
      'aria-reference',
      'native-label',
    ]);
    expect(snapshot.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'aria-describedby',
          source: { recordType: 'target', id: target?.id },
          destination: {
            status: 'resolved',
            record: expect.objectContaining({ recordType: 'evidence' }),
          },
        }),
        expect.objectContaining({
          kind: 'native-label',
          source: { recordType: 'target', id: target?.id },
        }),
      ]),
    );
  });

  it('preserves explicit false ARIA states and HTML boolean presence separately', () => {
    const { targets } = extractHtmlContextV2(
      '<button aria-expanded="false" aria-checked="false" disabled>Open</button>',
    );
    const button = targets[0];
    expect(button?.kind).toBe('button');
    expect(button?.attributes.aria.values['aria-expanded']).toEqual({
      status: 'present',
      value: false,
    });
    expect(button?.attributes.aria.values['aria-checked']).toEqual({
      status: 'present',
      value: false,
    });
    if (button?.kind === 'button') {
      expect(button.attributes.disabled).toBe('present');
      expect(button.attributes).not.toHaveProperty('inputType');
      expect(button.attributes).not.toHaveProperty('value');
    }
  });

  it('rejects invalid ARIA boolean and enumeration values without normalizing them', () => {
    const snapshot = extractHtmlContextV2(
      '<div role="slider" aria-expanded="sometimes" aria-orientation="diagonal"></div>',
    );
    const aria = snapshot.targets[0]?.attributes.aria.values;

    expect(aria?.['aria-expanded']).toEqual({
      status: 'invalid',
      raw: { value: 'sometimes', truncated: false },
    });
    expect(aria?.['aria-orientation']).toEqual({
      status: 'invalid',
      raw: { value: 'diagonal', truncated: false },
    });
  });

  it.each([
    ['aria-valuenow', '', 'invalid'],
    ['aria-valuenow', ' ', 'invalid'],
    ['aria-valuenow', 'abc', 'invalid'],
    ['aria-valuenow', 'NaN', 'invalid'],
    ['aria-valuenow', '12.5', 'present'],
    ['aria-valuemin', '-2', 'present'],
    ['aria-valuemax', 'Infinity', 'invalid'],
    ['aria-level', '0', 'invalid'],
    ['aria-level', '-1', 'invalid'],
    ['aria-level', '2', 'present'],
    ['aria-level', '2.5', 'invalid'],
  ] as const)(
    'validates %s=%j as %s',
    (attribute, authoredValue, expectedStatus) => {
      const role = attribute === 'aria-level' ? 'heading' : 'slider';
      const snapshot = extractHtmlContextV2(
        `<div role="${role}" ${attribute}="${authoredValue}"></div>`,
      );
      const observation =
        snapshot.targets[0]?.attributes.aria.values[attribute];

      expect(observation?.status).toBe(expectedStatus);
      if (expectedStatus === 'invalid') {
        expect(observation).toEqual({
          status: 'invalid',
          raw: { value: authoredValue, truncated: false },
        });
      } else {
        expect(observation).toMatchObject({
          status: 'present',
          value: Number(authoredValue),
        });
      }
    },
  );

  it('only captures inputType and value on input button targets', () => {
    const snapshot = extractHtmlContextV2(
      '<button>Native</button><input type="submit" value="Send">',
    );
    const nativeButton = snapshot.targets.find(
      (item) => item.tagName === 'button',
    );
    const inputButton = snapshot.targets.find(
      (item) => item.tagName === 'input',
    );

    expect(nativeButton?.kind).toBe('button');
    if (nativeButton?.kind === 'button') {
      expect(nativeButton.attributes).not.toHaveProperty('inputType');
      expect(nativeButton.attributes).not.toHaveProperty('value');
    }
    expect(inputButton?.kind).toBe('button');
    if (!inputButton || inputButton.kind !== 'button') {
      throw new Error('Expected submit input to be a button target');
    }
    expect(inputButton.attributes.inputType).toMatchObject({
      status: 'present',
      value: { value: 'submit', truncated: false },
    });
    expect(inputButton.attributes.value).toMatchObject({
      status: 'present',
      value: { value: 'Send', truncated: false },
    });
  });

  it('records duplicate ID references as ambiguous and retains exact source ranges', () => {
    const html =
      '<button aria-labelledby="label">Go</button>' +
      '<span id="label">One</span><span id="label">Two</span>';
    const snapshot = extractHtmlContextV2(html);
    const relation = snapshot.relationships.find(
      (item) => item.kind === 'aria-labelledby',
    );
    const button = snapshot.targets[0];
    const locator = button?.sourceLocator;

    expect(relation?.destination).toMatchObject({
      status: 'ambiguous',
      totalCandidateCount: 2,
      additionalCandidateCount: 0,
    });
    expect(locator?.kind).toBe('html-source-range');
    if (locator?.kind === 'html-source-range') {
      expect(html.slice(locator.startOffset, locator.endOffset)).toBe(
        '<button aria-labelledby="label">Go</button>',
      );
    }
  });

  it('uses UTF-16 code-unit offsets for source ranges after supplementary characters', () => {
    const html = '<p>😀</p><button>Press</button>';
    const target = extractHtmlContextV2(html).targets[0];
    const locator = target?.sourceLocator;

    expect(locator?.kind).toBe('html-source-range');
    if (locator?.kind !== 'html-source-range') {
      throw new Error('Expected an HTML source range');
    }
    const start = html.indexOf('<button>');
    const end = start + '<button>Press</button>'.length;
    expect(locator).toMatchObject({
      startOffset: start,
      endOffset: end,
      offsetUnit: 'utf16-code-unit',
    });
    expect(html.slice(locator.startOffset, locator.endOffset)).toBe(
      '<button>Press</button>',
    );
  });

  it('distinguishes empty success from unavailable extraction', () => {
    const empty = extractHtmlContextV2('<p>Text only</p>');
    expect(empty.targets).toEqual([]);
    expect(empty.completeness.status).toBe('complete');
    expect(adaptContextSnapshotV2(empty).status).toBe('empty');
    expect(extractHtmlContextResultV2('<p>Text only</p>').status).toBe(
      'available',
    );
    expect(
      adaptContextSnapshotV2({
        status: 'unavailable',
        reason: 'parser-failure',
      }),
    ).toEqual({ status: 'unavailable', reason: 'parser-failure' });
  });

  it('marks bounded document title and language values as extraction truncations', () => {
    const title = 'T'.repeat(501);
    const titleSnapshot = extractHtmlContextV2(`<title>${title}</title>`);
    expect(titleSnapshot.document.title).toEqual({
      status: 'present',
      value: title.slice(0, 500),
      truncated: true,
    });
    expect(titleSnapshot.completeness.status).toBe('partial');
    expect(titleSnapshot.completeness.truncations).toContainEqual(
      expect.objectContaining({ scope: 'snapshot', limit: 'text-length' }),
    );

    const language = 'l'.repeat(251);
    const languageSnapshot = extractHtmlContextV2(
      `<html lang="${language}"></html>`,
    );
    expect(languageSnapshot.document.language).toEqual({
      status: 'present',
      value: language.slice(0, 250),
      truncated: true,
    });
    expect(languageSnapshot.completeness.status).toBe('partial');
    expect(languageSnapshot.completeness.truncations).toContainEqual(
      expect.objectContaining({
        scope: 'snapshot',
        limit: 'attribute-value-length',
      }),
    );
  });

  it('reports duplicate ID candidate limits without duplicate truncation entries', () => {
    const html =
      '<button aria-labelledby="shared">Open</button>' +
      Array.from(
        { length: 22 },
        (_, index) => `<span id="shared">Evidence ${index}</span>`,
      ).join('');
    const snapshot = extractHtmlContextV2(html);
    const relation = snapshot.relationships.find(
      (item) => item.kind === 'aria-labelledby',
    );

    expect(relation?.destination).toMatchObject({
      status: 'ambiguous',
      totalCandidateCount: 22,
      additionalCandidateCount: 2,
    });
    expect(relation?.destination.status === 'ambiguous' &&
      relation.destination.candidates).toHaveLength(20);
    expect(relation?.completeness).toEqual({
      status: 'partial',
      reason: 'candidate-list-limit',
    });
    expect(snapshot.completeness.status).toBe('partial');
    if (snapshot.completeness.status === 'partial') {
      const limits = snapshot.completeness.truncations.filter(
        (item) =>
          item.scope === 'relationship' &&
          item.limit === 'duplicate-id-candidates',
      );
      expect(limits).toHaveLength(1);
      expect(limits[0]?.omittedCount).toBe(2);
    }
  });

  it('counts only labelable extracted targets among duplicate native-label IDs', () => {
    const html =
      '<label for="shared">Shared label</label>' +
      '<input id="shared">'.repeat(21) +
      '<div id="shared">Not a label target</div>'.repeat(5);
    const snapshot = extractHtmlContextV2(html);
    const relationships = snapshot.relationships.filter(
      (item) => item.kind === 'native-label',
    );

    expect(relationships).toHaveLength(21);
    for (const relationship of relationships) {
      if (relationship.kind === 'parent-child') {
        throw new Error('Expected native-label relationship');
      }
      expect(relationship.sourceResolution).toMatchObject({
        status: 'ambiguous',
        totalCandidateCount: 21,
        additionalCandidateCount: 1,
      });
      expect(relationship.sourceResolution?.candidates).toHaveLength(20);
    }
    const truncations = snapshot.completeness.truncations.filter(
      (item) =>
        item.scope === 'relationship' &&
        item.limit === 'duplicate-id-candidates',
    );
    expect(truncations).toHaveLength(21);
    expect(truncations.every((item) => item.omittedCount === 1)).toBe(true);
  });

  it('adapts exactly 20 duplicate native-label candidates without candidate truncation', () => {
    const snapshot = extractHtmlContextV2(
      '<label for="shared">Shared label</label>' +
        '<input id="shared">'.repeat(20),
    );
    const relationships = snapshot.relationships.filter(
      (item) => item.kind === 'native-label',
    );

    expect(relationships).toHaveLength(20);
    expect(snapshot.completeness.status).toBe('complete');
    for (const relationship of relationships) {
      expect(relationship.sourceResolution).toMatchObject({
        status: 'ambiguous',
        totalCandidateCount: 20,
        additionalCandidateCount: 0,
      });
      expect(relationship.sourceResolution?.candidates).toHaveLength(20);
    }

    const result = adaptContextSnapshotV2(snapshot);
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      throw new Error('Expected partial adapter result');
    }
    expect(result.input.units).toHaveLength(20);
    expect(
      result.input.units.every((unit) =>
        unit.relationships.every(
          (relationship) => relationship.kind !== 'native-label',
        ),
      ),
    ).toBe(true);
    expect(result.input.extractionCompleteness.status).toBe('complete');
  });

  it('adapts capped 21-target native-label ambiguity without losing its counts', () => {
    const snapshot = extractHtmlContextV2(
      '<label for="shared">Shared label</label>' +
        '<input id="shared">'.repeat(21),
    );
    const relationships = snapshot.relationships.filter(
      (item) => item.kind === 'native-label',
    );

    expect(relationships).toHaveLength(21);
    expect(snapshot.completeness.status).toBe('partial');
    for (const relationship of relationships) {
      expect(relationship.sourceResolution).toMatchObject({
        status: 'ambiguous',
        totalCandidateCount: 21,
        additionalCandidateCount: 1,
      });
      expect(relationship.sourceResolution?.candidates).toHaveLength(20);
      expect(relationship.completeness).toEqual({
        status: 'partial',
        reason: 'candidate-list-limit',
      });
    }
    if (snapshot.completeness.status !== 'partial') {
      throw new Error('Expected partial extraction completeness');
    }
    const candidateTruncations = snapshot.completeness.truncations.filter(
      (item) =>
        item.scope === 'relationship' &&
        item.limit === 'duplicate-id-candidates',
    );
    expect(candidateTruncations).toHaveLength(21);
    expect(candidateTruncations.every((item) => item.omittedCount === 1)).toBe(
      true,
    );

    const result = adaptContextSnapshotV2(snapshot);
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      throw new Error('Expected partial adapter result');
    }
    expect(result.input.units).toHaveLength(21);
    expect(
      result.input.units.every((unit) =>
        unit.relationships.every(
          (relationship) => relationship.kind !== 'native-label',
        ),
      ),
    ).toBe(true);
    expect(result.input.extractionCompleteness.truncations).toEqual(
      snapshot.completeness.truncations,
    );
  });

  it('rejects malformed capped native-label candidate counts and references', () => {
    const snapshot = extractHtmlContextV2(
      '<label for="shared">Shared label</label>' +
        '<input id="shared">'.repeat(21) +
        '<button id="other">Other target</button>',
    );
    const relationship = snapshot.relationships.find(
      (item) => item.kind === 'native-label',
    );
    expect(relationship?.kind).toBe('native-label');
    if (!relationship || relationship.kind === 'parent-child') {
      throw new Error('Expected a native-label relationship');
    }

    const malformedCount = {
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship.id && item.kind === 'native-label'
          ? {
              ...item,
              sourceResolution: {
                ...item.sourceResolution!,
                additionalCandidateCount: 0,
              },
            }
          : item,
      ),
    };
    const malformedReference = {
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship.id && item.kind === 'native-label'
          ? {
              ...item,
              sourceResolution: {
                ...item.sourceResolution!,
                candidates: item.sourceResolution!.candidates.map(
                  (candidate, index) =>
                    index === 0
                      ? { ...candidate, id: 't-22' }
                      : candidate,
                ),
              },
            }
          : item,
      ),
    };
    const forgedCandidateCount = {
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship.id && item.kind === 'native-label'
          ? {
              ...item,
              sourceResolution: {
                ...item.sourceResolution!,
                totalCandidateCount: 22,
                additionalCandidateCount: 2,
              },
            }
          : item,
      ),
      completeness: {
        ...snapshot.completeness,
        truncations: snapshot.completeness.truncations.map((item) =>
          item.recordId === relationship.id &&
          item.limit === 'duplicate-id-candidates'
            ? { ...item, omittedCount: 2 }
            : item,
        ),
      },
    };

    for (const malformed of [
      malformedCount,
      malformedReference,
      forgedCandidateCount,
    ]) {
      expect(() => adaptContextSnapshotV2(malformed)).not.toThrow();
      expect(adaptContextSnapshotV2(malformed)).toEqual({
        status: 'error',
        errorCode: 'invalid-snapshot',
      });
    }
  });

  it('rejects candidate totals beyond the visible truncated-ID target count', () => {
    const authoredId = 'x'.repeat(251);
    const snapshot = extractHtmlContextV2(
      `<label for="${authoredId}">Shared label</label>` +
        `<input id="${authoredId}">`.repeat(21),
    );
    const relationship = snapshot.relationships.find(
      (item) => item.kind === 'native-label',
    );
    expect(relationship?.kind).toBe('native-label');
    if (!relationship || relationship.kind === 'parent-child') {
      throw new Error('Expected native-label relationship');
    }

    const forgedCandidateCount = {
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship.id && item.kind === 'native-label'
          ? {
              ...item,
              sourceResolution: {
                ...item.sourceResolution!,
                totalCandidateCount: 22,
                additionalCandidateCount: 2,
              },
            }
          : item,
      ),
      completeness: {
        ...snapshot.completeness,
        truncations: snapshot.completeness.truncations.map((item) =>
          item.recordId === relationship.id &&
          item.limit === 'duplicate-id-candidates'
            ? { ...item, omittedCount: 2 }
            : item,
        ),
      },
    };

    expect(relationship.sourceResolution?.authoredId.truncated).toBe(true);
    expect(adaptContextSnapshotV2(forgedCandidateCount)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });
  });

  it('keeps policy omissions complete when no extraction limit is hit', () => {
    const snapshot = extractHtmlContextV2(
      '<p>Supporting text</p><div role="unsupported-role">Ignored</div>',
    );

    expect(snapshot.completeness.status).toBe('complete');
    expect(snapshot.completeness.policyOmissions).not.toHaveLength(0);
    expect(snapshot.completeness.truncations).toEqual([]);
  });

  it('extracts form-control attributes only where the native element and type apply', () => {
    const snapshot = extractHtmlContextV2(
      '<input id="check" type="checkbox" checked>' +
        '<input id="radio" type="radio">' +
        '<input id="text" type="text" checked selected>' +
        '<input id="hidden" type="hidden">' +
        '<input id="hidden-role" type="hidden" role="button">' +
        '<select id="select" name="choice"><option>Default</option>' +
        '<option selected>Chosen</option></select>' +
        '<select id="default-select"><option>First</option></select>' +
        '<textarea id="area" name="notes" placeholder="Notes" checked></textarea>' +
        '<button id="native-button" disabled>Save</button>',
    );
    const targetById = new Map(
      snapshot.targets.map((target) => [
        target.attributes.authoredId.status === 'present'
          ? target.attributes.authoredId.value.value
          : '',
        target,
      ]),
    );
    const checkbox = targetById.get('check');
    const radio = targetById.get('radio');
    const text = targetById.get('text');
    const select = targetById.get('select');
    const defaultSelect = targetById.get('default-select');
    const textarea = targetById.get('area');
    const nativeButton = targetById.get('native-button');

    expect(snapshot.targets).toHaveLength(7);
    expect(targetById.has('hidden')).toBe(false);
    expect(targetById.has('hidden-role')).toBe(false);
    expect(snapshot.completeness.policyOmissions).toContainEqual(
      expect.objectContaining({ category: 'non-target-node' }),
    );
    expect(checkbox?.kind).toBe('form-control');
    if (checkbox?.kind === 'form-control') {
      expect(checkbox.attributes.inputType).toMatchObject({
        status: 'present',
        value: { value: 'checkbox' },
      });
      expect(checkbox.attributes.checked).toBe('present');
      expect(checkbox.attributes).not.toHaveProperty('selected');
      expect(checkbox.attributes).not.toHaveProperty('placeholder');
    }
    expect(radio?.kind).toBe('form-control');
    if (radio?.kind === 'form-control') {
      expect(radio.attributes.checked).toBe('absent');
    }
    expect(text?.kind).toBe('form-control');
    if (text?.kind === 'form-control') {
      expect(text.attributes.inputType).toMatchObject({
        status: 'present',
        value: { value: 'text' },
      });
      expect(text.attributes).not.toHaveProperty('checked');
      expect(text.attributes).not.toHaveProperty('selected');
      expect(text.attributes.placeholder).toMatchObject({ status: 'absent' });
    }
    expect(select?.kind).toBe('form-control');
    if (select?.kind === 'form-control') {
      expect(select.attributes.selected).toBe('present');
      expect(select.attributes).not.toHaveProperty('inputType');
      expect(select.attributes).not.toHaveProperty('checked');
      expect(select.attributes).not.toHaveProperty('placeholder');
    }
    expect(defaultSelect?.kind).toBe('form-control');
    if (defaultSelect?.kind === 'form-control') {
      expect(defaultSelect.attributes.selected).toBe('present');
    }
    expect(textarea?.kind).toBe('form-control');
    if (textarea?.kind === 'form-control') {
      expect(textarea.attributes.placeholder).toMatchObject({
        status: 'present',
        value: { value: 'Notes' },
      });
      expect(textarea.attributes).not.toHaveProperty('inputType');
      expect(textarea.attributes).not.toHaveProperty('checked');
      expect(textarea.attributes).not.toHaveProperty('selected');
    }
    expect(nativeButton?.kind).toBe('button');
    if (nativeButton?.kind === 'button') {
      expect(nativeButton.attributes.disabled).toBe('present');
      expect(nativeButton.attributes).not.toHaveProperty('inputType');
      expect(nativeButton.attributes).not.toHaveProperty('value');
    }
  });

  it('preserves structural relationships in the snapshot for later phases', () => {
    const snapshot = extractHtmlContextV2(
      '<button>Parent<img src="x.png" alt="Child"></button>',
    );

    expect(
      snapshot.relationships.some((item) => item.kind === 'parent-child'),
    ).toBe(true);
    expect(snapshot.completeness.status).toBe('complete');
  });

  it('marks record-cap omissions as partial without exceeding the extraction limit', () => {
    const snapshot = extractHtmlContextV2(
      '<button>Action</button>'.repeat(501),
    );

    expect(snapshot.targets).toHaveLength(500);
    expect(snapshot.completeness.status).toBe('partial');
    expect(snapshot.completeness.truncations).toContainEqual(
      expect.objectContaining({ scope: 'snapshot', limit: 'record-count' }),
    );
    expect(adaptContextSnapshotV2(snapshot).status).toBe('partial');
  });
});

describe('adaptContextSnapshotV2', () => {
  it('projects a real description relationship onto its focal target', () => {
    const snapshot = extractHtmlContextV2(
      '<button aria-describedby="hint">Save</button>' +
        '<p id="hint">Saves your changes.</p>',
    );
    const result = adaptContextSnapshotV2(snapshot);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready adapter result');
    const target = snapshot.targets[0];
    expect(target).toBeDefined();
    const unit = result.input.units.find(
      (item) => item.focal.id === target?.id,
    );
    expect(unit).toBeDefined();
    const projection = unit?.relationships.find(
      (item) => item.kind === 'aria-describedby',
    );
    expect(projection).toBeDefined();
    expect(projection?.focalTargetId).toBe(target?.id);
    expect(projection?.destination.status).toBe('resolved');
    expect(unit?.associatedEvidence[0]?.relationships).toContainEqual(
      expect.objectContaining({ relationshipId: projection?.relationshipId }),
    );
  });

  it('omits ambiguous native-label relationships instead of projecting them as resolved', () => {
    const snapshot = extractHtmlContextV2(
      '<label for="shared">Shared label</label>' +
        '<input id="shared"><input id="shared">' +
        '<div id="shared">Not labelable</div>',
    );
    const nativeLabels = snapshot.relationships.filter(
      (item) => item.kind === 'native-label',
    );
    expect(nativeLabels).toHaveLength(2);
    expect(nativeLabels.every(
      (item) =>
        item.kind !== 'parent-child' &&
        item.sourceResolution?.status === 'ambiguous' &&
        item.sourceResolution.totalCandidateCount === 2 &&
        item.sourceResolution.candidates.length === 2,
    )).toBe(true);

    const result = adaptContextSnapshotV2(snapshot);
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      throw new Error('Expected partial adapter result');
    }
    expect(result.input.units).toHaveLength(2);
    for (const unit of result.input.units) {
      expect(
        unit.relationships.some((relationship) => relationship.kind === 'native-label'),
      ).toBe(false);
      expect(unit.completeness).toMatchObject({
        status: 'partial',
        truncations: expect.arrayContaining(['relationship-omitted']),
      });
    }
  });

  it('drops ambiguous projections when any evidence candidate is omitted by the adapter', () => {
    const snapshot = extractHtmlContextV2(
      '<button aria-labelledby="shared">Open</button>' +
        Array.from(
          { length: 10 },
          (_, index) => `<span id="shared">Candidate ${index}</span>`,
        ).join(''),
    );
    const result = adaptContextSnapshotV2(snapshot);

    expect(snapshot.relationships.some(
      (item) =>
        item.kind === 'aria-labelledby' &&
        item.destination.status === 'ambiguous',
    )).toBe(true);
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected partial adapter result');
    const unit = result.input.units[0];
    expect(unit).toBeDefined();
    expect(unit?.relationships.some(
      (item) =>
        item.kind === 'aria-labelledby' &&
        item.destination.status === 'ambiguous',
    )).toBe(false);
    expect(unit?.associatedEvidence).toEqual([]);
    expect(unit?.completeness).toMatchObject({
      status: 'partial',
      truncations: ['associated-evidence-count'],
      omittedEvidenceCount: 10,
    });
  });

  it('omits projections whose ambiguous target candidates are not retained in the unit', () => {
    const snapshot = extractHtmlContextV2(
      '<button aria-describedby="shared">Open</button>' +
        '<button id="shared">Other target</button>' +
        '<p id="shared">Description candidate</p>',
    );
    const result = adaptContextSnapshotV2(snapshot);

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      throw new Error('Expected partial adapter result');
    }
    for (const unit of result.input.units) {
      const associatedIds = new Set(
        unit.associatedEvidence.map((item) => item.evidence.id),
      );
      for (const relationship of unit.relationships) {
        expect(relationship.focalTargetId).toBe(unit.focal.id);
        const destination = relationship.destination;
        if (destination.status === 'resolved') {
          expect(
            destination.record.recordType === 'target'
              ? destination.record.id === unit.focal.id
              : associatedIds.has(destination.record.id),
          ).toBe(true);
        } else if (destination.status === 'ambiguous') {
          expect(
            destination.candidates.every((candidate) =>
              candidate.recordType === 'target'
                ? candidate.id === unit.focal.id
                : associatedIds.has(candidate.id),
            ),
          ).toBe(true);
        }
      }
    }
    expect(
      result.input.units[0]?.relationships.some(
        (relationship) => relationship.kind === 'aria-describedby',
      ),
    ).toBe(false);
  });

  it('rejects resolved evidence and target references that do not exist', () => {
    const base = extractHtmlContextV2(
      '<button aria-describedby="hint">Save</button><span id="hint">Help</span>',
    );
    const relation = base.relationships.find(
      (item) => item.kind === 'aria-describedby',
    );
    expect(relation?.destination.status).toBe('resolved');
    if (!relation || relation.kind === 'parent-child' ||
        relation.destination.status !== 'resolved') {
      throw new Error('Expected a resolved description relationship');
    }

    const missingEvidence = {
      ...base,
      relationships: base.relationships.map((item) =>
        item.id === relation.id
          ? {
              ...item,
              destination: {
                status: 'resolved' as const,
                record: { recordType: 'evidence' as const, id: 'missing-evidence' },
              },
            }
          : item,
      ),
    };
    expect(adaptContextSnapshotV2(missingEvidence)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });

    const missingTarget = {
      ...base,
      relationships: base.relationships.map((item) =>
        item.id === relation.id
          ? {
              ...item,
              destination: {
                status: 'resolved' as const,
                record: { recordType: 'target' as const, id: 'missing-target' },
              },
            }
          : item,
      ),
    };
    expect(adaptContextSnapshotV2(missingTarget)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });
  });

  it('rejects malformed snapshots without throwing', () => {
    const linkSnapshot = extractHtmlContextV2('<a href="/home">Home</a>');
    const link = linkSnapshot.targets[0];
    expect(link?.kind).toBe('link');
    if (!link || link.kind !== 'link') throw new Error('Expected link target');
    const malformedLink = {
      ...linkSnapshot,
      targets: [{ ...link, attributes: { ...link.attributes, href: undefined } }],
    };

    const controlSnapshot = extractHtmlContextV2('<input id="field">');
    const control = controlSnapshot.targets[0];
    expect(control).toBeDefined();
    const missingAttributes = {
      ...controlSnapshot,
      targets: [{ ...control, attributes: undefined }],
    };

    const wrongBasis = {
      ...linkSnapshot,
      targets: [{
        ...link,
        basis: { type: 'aria-heading' as const },
      }],
    };
    const headingSnapshot = extractHtmlContextV2('<h1>Heading</h1>');
    const heading = headingSnapshot.targets[0];
    expect(heading?.kind).toBe('heading');
    if (!heading || heading.kind !== 'heading') {
      throw new Error('Expected heading target');
    }
    const inapplicableHeadingAttribute = {
      ...headingSnapshot,
      targets: [{
        ...heading,
        attributes: {
          ...heading.attributes,
          href: { status: 'absent' as const },
        },
      }],
    };
    const invalidHeadingLevel = {
      ...headingSnapshot,
      targets: [{ ...heading, headingLevel: 8 }],
    };

    const relationSnapshot = extractHtmlContextV2(
      '<button aria-describedby="hint">Save</button><span id="hint">Help</span>',
    );
    const relation = relationSnapshot.relationships.find(
      (item) => item.kind === 'aria-describedby',
    );
    expect(relation).toBeDefined();
    const missingSource = {
      ...relationSnapshot,
      relationships: relationSnapshot.relationships.map((item) =>
        item.id === relation?.id
          ? { ...item, source: undefined }
          : item,
      ),
    };

    const invalidCompleteness = {
      ...controlSnapshot,
      completeness: {
        ...controlSnapshot.completeness,
        status: 'partial' as const,
        truncations: [],
      },
    };
    const missingEvidence = {
      ...relationSnapshot,
      evidence: [],
    };
    const invalidSchemaVersion = {
      ...controlSnapshot,
      schemaVersion: 1,
    };
    const missingTargets = {
      ...controlSnapshot,
      targets: undefined,
    };
    const malformedEvidence = {
      ...controlSnapshot,
      evidence: null,
    };
    const malformedRelationships = {
      ...controlSnapshot,
      relationships: {},
    };
    const invalidSourceOffsets = {
      ...controlSnapshot,
      targets: [{
        ...control,
        sourceLocator: {
          kind: 'html-source-range' as const,
          startOffset: 10,
          endOffset: 5,
          sourceLanguage: 'html' as const,
          offsetUnit: 'utf16-code-unit' as const,
        },
      }],
    };
    const malformedDomPath = {
      ...controlSnapshot,
      targets: [{
        ...control,
        sourceLocator: {
          kind: 'dom-path' as const,
          format: 'element-index-path-v1' as const,
          path: '/html[1]//input[1]',
        },
      }],
    };

    for (const invalid of [
      malformedLink,
      missingAttributes,
      wrongBasis,
      inapplicableHeadingAttribute,
      invalidHeadingLevel,
      missingSource,
      invalidCompleteness,
      missingEvidence,
      invalidSchemaVersion,
      missingTargets,
      malformedEvidence,
      malformedRelationships,
      invalidSourceOffsets,
      malformedDomPath,
    ]) {
      expect(() => adaptContextSnapshotV2(invalid)).not.toThrow();
      expect(adaptContextSnapshotV2(invalid)).toEqual({
        status: 'error',
        errorCode: 'invalid-snapshot',
      });
    }
  });

  it('validates relationship provenance and its source attribute', () => {
    const snapshot = extractHtmlContextV2(
      '<button aria-describedby="hint">Save</button><span id="hint">Help</span>',
    );
    const relationship = snapshot.relationships.find(
      (item) => item.kind === 'aria-describedby',
    );
    expect(relationship).toBeDefined();
    if (!relationship || relationship.kind === 'parent-child') {
      throw new Error('Expected target relationship');
    }

    const withProvenance = (provenance: unknown) => ({
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship.id ? { ...item, provenance } : item,
      ),
    });
    const invalidProvenance = [
      withProvenance({}),
      withProvenance({ basis: 'unknown', ruleId: 'rule' }),
      withProvenance({
        basis: 'aria-idref',
        attribute: 'aria-labelledby',
        authoredReference: { value: 'hint', truncated: false },
      }),
    ];
    for (const invalid of invalidProvenance) {
      expect(adaptContextSnapshotV2(invalid)).toEqual({
        status: 'error',
        errorCode: 'invalid-snapshot',
      });
    }

    expect(adaptContextSnapshotV2(snapshot).status).toBe('ready');
  });

  it('rejects a relationship source that does not match an existing focal target', () => {
    const snapshot = extractHtmlContextV2(
      '<button aria-describedby="hint">Save</button><span id="hint">Help</span>',
    );
    const relationship = snapshot.relationships.find(
      (item) => item.kind === 'aria-describedby',
    );
    expect(relationship).toBeDefined();
    const invalid = {
      ...snapshot,
      relationships: snapshot.relationships.map((item) =>
        item.id === relationship?.id
          ? {
              ...item,
              source: { recordType: 'target' as const, id: 'missing-target' },
            }
          : item,
      ),
    };
    expect(adaptContextSnapshotV2(invalid)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });
  });

  it('intentionally excludes structural relationships from target evidence units', () => {
    const snapshot = extractHtmlContextV2(
      '<button>Parent<img src="x.png" alt="Child"></button>',
    );
    const result = adaptContextSnapshotV2(snapshot);

    expect(snapshot.relationships.some((item) => item.kind === 'parent-child')).toBe(true);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready adapter result');
    expect(result.input.units).toHaveLength(snapshot.targets.length);
    expect(result.input.units.flatMap((unit) => unit.relationships)).toEqual([]);
    expect(result.input.extractionCompleteness.status).toBe('complete');
    expect(result.input.adapterCompleteness.status).toBe('complete');
  });

  it('reports adapter evidence limits separately from extraction completeness', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `hint-${index}`);
    const references = ids.join(' ');
    const evidence = ids
      .map((id, index) => `<span id="${id}">Description ${index}</span>`)
      .join('');
    const snapshot = extractHtmlContextV2(
      `<button aria-describedby="${references}">Save</button>${evidence}`,
    );
    const compactSnapshot = {
      ...snapshot,
      evidence: snapshot.evidence.map(({ id, kind }) => ({
        id,
        kind,
        completeness: { status: 'complete' as const },
      })),
      relationships: snapshot.relationships.map((relationship) =>
        relationship.kind === 'parent-child'
          ? relationship
          : {
              ...relationship,
              provenance: {
                basis: 'aria-idref' as const,
                attribute: 'aria-describedby' as const,
                authoredReference: {
                  value: relationship.destination.status === 'resolved'
                    ? relationship.destination.record.id
                    : 'hint',
                  truncated: false,
                },
              },
            },
      ),
    };
    const result = adaptContextSnapshotV2(compactSnapshot);

    expect(snapshot.completeness.status).toBe('complete');
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected partial adapter result');
    const unit = result.input.units[0];
    expect(unit).toBeDefined();
    const includedCount = unit?.associatedEvidence.length ?? 0;
    const omittedCount = snapshot.evidence.length - includedCount;
    expect(includedCount).toBe(8);
    expect(omittedCount).toBe(2);
    expect(unit?.completeness).toMatchObject({
      status: 'partial',
      omittedEvidenceCount: omittedCount,
    });
    expect(unit?.completeness.status === 'partial' &&
      unit.completeness.truncations).toContain('associated-evidence-count');
    expect(result.input.extractionCompleteness.status).toBe('complete');
    expect(result.input.adapterCompleteness).toMatchObject({
      status: 'partial',
      omittedUnitEvidenceCount: omittedCount,
    });
  });

  it('accepts consistent partial snapshots and rejects missing record or relationship truncation metadata', () => {
    const text = 'T'.repeat(501);
    const validPartial = extractHtmlContextV2(
      `<title>${text}</title><button>${text}</button>`,
    );
    expect(validPartial.completeness.status).toBe('partial');
    expect(adaptContextSnapshotV2(validPartial).status).toBe('partial');

    const missingTargetMetadata = {
      ...validPartial,
      completeness: {
        ...validPartial.completeness,
        truncations: validPartial.completeness.truncations.filter(
          (item) => item.scope !== 'target',
        ),
      },
    };
    expect(adaptContextSnapshotV2(missingTargetMetadata)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });

    const duplicateIds = Array.from(
      { length: 21 },
      (_, index) => `<span id="duplicate">Evidence ${index}</span>`,
    ).join('');
    const validRelationshipPartial = extractHtmlContextV2(
      `<title>${text}</title><button aria-labelledby="duplicate">Open</button>${duplicateIds}`,
    );
    expect(adaptContextSnapshotV2(validRelationshipPartial).status).toBe(
      'partial',
    );
    const missingRelationshipMetadata = {
      ...validRelationshipPartial,
      completeness: {
        ...validRelationshipPartial.completeness,
        truncations: validRelationshipPartial.completeness.truncations.filter(
          (item) =>
            !(
              item.scope === 'relationship' &&
              item.limit === 'duplicate-id-candidates'
            ),
        ),
      },
    };
    expect(adaptContextSnapshotV2(missingRelationshipMetadata)).toEqual({
      status: 'error',
      errorCode: 'invalid-snapshot',
    });
  });
});
