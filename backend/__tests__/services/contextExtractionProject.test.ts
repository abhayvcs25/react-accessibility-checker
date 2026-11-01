import { describe, expect, it } from 'vitest';
import { adaptContextSnapshotV2 } from '../../src/services/contextAdapterV2.js';
import { extractHtmlContextV2 } from '../../src/services/contextExtractionV2.js';
import { extractHtmlProjectContext } from '../../src/services/contextExtractionProject.js';
import { ProjectExtractionError } from '../../src/types/contextProject.js';

describe('extractHtmlProjectContext', () => {
  it('preserves document identity, source locations, prose, labels, and relationships', () => {
    const firstHtml =
      '<main><h1>Account</h1><p>Update your details.</p>' +
      '<form id="profile"><label for="email">Work email</label>' +
      '<input id="email" aria-describedby="hint">' +
      '<p id="hint">Used for account notices.</p><button>Save</button></form></main>';
    const project = extractHtmlProjectContext([
      {
        documentId: 'account-page',
        filePath: 'pages/account.html',
        html: firstHtml,
      },
      {
        documentId: 'help-page',
        filePath: 'pages/help.html',
        html: '<main><h1>Help</h1><p>Contact support.</p></main>',
      },
    ]);
    const account = project.documents[0];
    const input = account?.snapshot.targets.find(
      (target) => target.tagName === 'input',
    );
    const button = account?.snapshot.targets.find(
      (target) => target.tagName === 'button',
    );
    const emailLabel = account?.snapshot.evidence.find(
      (record) =>
        record.kind === 'native-label' &&
        record.text?.value === 'Work email',
    );

    expect(project.scope).toBe('provided-html-files-only');
    expect(project.documents.map((document) => document.documentId)).toEqual([
      'account-page',
      'help-page',
    ]);
    expect(account?.snapshot.targets[0]?.sourceLocator).toBeDefined();
    expect(
      account?.snapshot.targets.some(
        (target) => target.kind === 'heading' && target.text?.value === 'Account',
      ),
    ).toBe(true);
    expect(
      account?.targetEvidence.find((item) => item.target.id === button?.id)
        ?.targetDomText,
    ).toMatchObject({
      status: 'present',
      value: { value: 'Save' },
    });
    expect(
      account?.contextRecords.some(
        (record) =>
          record.category === 'text' &&
          record.text.status === 'present' &&
          record.text.value.value === 'Update your details.',
      ),
    ).toBe(true);
    expect(
      account?.relationships.some(
        (relationship) =>
          relationship.kind === 'native-label' &&
          relationship.source.documentId === 'account-page' &&
          relationship.destination.status === 'resolved' &&
          relationship.destination.record.id === emailLabel?.id,
      ),
    ).toBe(true);
    expect(
      account?.relationships.some(
        (relationship) =>
          relationship.kind === 'form-owner' &&
          relationship.source.id === input?.id &&
          relationship.destination.status === 'resolved',
      ),
    ).toBe(true);
    expect(
      account?.targetEvidence.find(
        (item) => item.target.id === input?.id,
      )?.nativeLabels.status,
    ).toBe('present');
    expect(
      account?.targetEvidence.find(
        (item) => item.target.id === input?.id,
      )?.computedAccessibleName.status,
    ).toBe('not-captured');
    expect(account?.contextCompleteness.status).toBe('complete');
    expect(account?.evidenceAvailability.computedAccessibleName).toBe(
      'not-captured',
    );
  });

  it('resolves only destinations among supplied files and groups cross-page facts', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'index',
        filePath: 'index.html',
        html:
          '<p>Shared instruction.</p>' +
          '<a href="guides/start.html">Read guide</a>' +
          '<a href="https://external.test/page">Read guide</a>',
      },
      {
        documentId: 'guide',
        filePath: 'guides/start.html',
        html:
          '<p>Shared instruction.</p>' +
          '<a href="../index.html">Read guide</a>',
      },
    ]);
    const indexLinks = project.documents[0]?.links ?? [];

    expect(indexLinks[0]?.destination).toEqual({
      status: 'resolved',
      documentId: 'guide',
      filePath: 'guides/start.html',
    });
    expect(indexLinks[1]?.destination.status).toBe('external');
    expect(project.documents[1]?.links[0]?.destination).toEqual({
      status: 'resolved',
      documentId: 'index',
      filePath: 'index.html',
    });
    expect(
      project.comparisons.some(
        (comparison) =>
          comparison.basis === 'exact-authored-link-text' &&
          new Set(comparison.records.map((record) => record.documentId)).size ===
            2,
      ),
    ).toBe(true);
    expect(
      project.comparisons.some(
        (comparison) =>
          comparison.basis === 'exact-context-text' &&
          new Set(comparison.records.map((record) => record.documentId)).size ===
            2,
      ),
    ).toBe(true);
    expect(project.completeness.projectCoverage).toBe('provided-files-only');
  });

  it('exposes descendant image alternatives as name inputs without computing a name', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'image-link',
        filePath: 'image-link.html',
        html: '<a href="report.html"><img alt="Annual report"></a>',
      },
    ]);
    const document = project.documents[0];
    const link = document?.snapshot.targets.find(
      (target) => target.kind === 'link',
    );
    const evidence = document?.targetEvidence.find(
      (item) => item.target.id === link?.id,
    );

    expect(evidence?.targetDomText.status).toBe('confirmed-absent');
    expect(evidence?.authoredNameInputs).toMatchObject({
      status: 'present',
      value: [
        {
          source: 'descendant-content',
          referencedRecords: [
            { documentId: 'image-link', recordType: 'target' },
          ],
        },
      ],
    });
    expect(evidence?.computedAccessibleName.status).toBe('not-captured');
  });

  it('distinguishes confirmed absence from evidence not captured by static HTML extraction', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'plain',
        filePath: 'plain.html',
        html: '<img alt="Map"><p>Text only</p><a>Not a link target</a>',
      },
    ]);
    const paragraph = project.documents[0]?.contextRecords.find(
      (record) => record.tagName === 'p',
    );

    expect(paragraph?.attributes.href.status).toBe('confirmed-absent');
    expect(project.documents[0]?.links).toEqual([]);
    expect(project.documents[0]?.evidenceAvailability).toMatchObject({
      computedAccessibleName: 'not-captured',
      renderedVisibility: 'not-captured',
      actionBehavior: 'not-captured',
      imagePixels: 'not-captured',
    });
  });

  it('does not expose editable values as surrounding content and records absent label evidence', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'form-page',
        filePath: 'form.html',
        html:
          '<form><p>Public instructions</p><textarea>private default</textarea>' +
          '<input name="email"></form>',
      },
    ]);
    const document = project.documents[0];
    const input = document?.snapshot.targets.find(
      (target) => target.tagName === 'input',
    );
    const inputEvidence = document?.targetEvidence.find(
      (item) => item.target.id === input?.id,
    );

    expect(
      document?.contextRecords.some(
        (record) =>
          record.text.status === 'present' &&
          record.text.value.value.includes('private default'),
      ),
    ).toBe(false);
    expect(inputEvidence?.nativeLabels.status).toBe('confirmed-absent');
    expect(inputEvidence?.computedAccessibleName.status).toBe('not-captured');
  });

  it('captures authored form destinations and static validation-message attributes', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'validation',
        filePath: 'validation.html',
        html:
          '<form action="/account" method="post">' +
          '<label for="email">Email</label>' +
          '<input id="email" autocomplete="email" aria-invalid="true" aria-errormessage="email-error">' +
          '<p id="email-error" role="alert" aria-live="assertive">Enter a valid email.</p>' +
          '</form>',
      },
    ]);
    const document = project.documents[0];
    const records = project.documents[0]?.contextRecords ?? [];
    const form = records.find((record) => record.tagName === 'form');
    const errorMessage = document?.snapshot.evidence.find(
      (record) => record.tagName === 'p' && record.text?.value === 'Enter a valid email.',
    );

    expect(form?.attributes.action).toMatchObject({
      status: 'present',
      value: '/account',
    });
    expect(form?.attributes.method).toMatchObject({
      status: 'present',
      value: 'post',
    });
    expect(
      project.documents[0]?.snapshot.targets.find(
        (target) => target.tagName === 'input',
      )?.attributes,
    ).toMatchObject({
      autoComplete: { status: 'present', value: { value: 'email' } },
    });
    expect(errorMessage?.attributes?.role).toMatchObject({
      status: 'present',
      value: { value: 'alert' },
    });
    expect(errorMessage?.attributes?.aria?.values['aria-live']).toMatchObject({
      status: 'present',
      value: { value: 'assertive' },
    });
  });

  it('preserves ambiguous native-label and form-owner relationships', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'ambiguous',
        filePath: 'ambiguous.html',
        html:
          '<form id="duplicate"></form><form id="duplicate"></form>' +
          '<label for="field">Value</label><input id="field" form="duplicate">' +
          '<input id="field">',
      },
    ]);
    const document = project.documents[0];
    const nativeLabel = document?.relationships.find(
      (relationship) => relationship.kind === 'native-label',
    );
    const formOwner = document?.relationships.find(
      (relationship) => relationship.kind === 'form-owner',
    );

    expect(nativeLabel?.destination.status).toBe('ambiguous');
    expect(formOwner?.destination.status).toBe('ambiguous');
    expect(
      document?.targetEvidence.some(
        (item) => item.nativeLabels.status === 'ambiguous',
      ),
    ).toBe(true);
  });

  it('marks project context record limits as incomplete instead of confirming absence', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'large-page',
        filePath: 'large.html',
        html: '<p>Context</p>'.repeat(501) + '<button>Run</button>',
      },
    ]);
    const document = project.documents[0];
    const button = document?.snapshot.targets[0];

    expect(document?.contextRecords).toHaveLength(500);
    expect(document?.contextCompleteness).toMatchObject({
      status: 'partial',
      omittedRecordCount: 1,
    });
    expect(project.completeness.status).toBe('partial');
    expect(
      document?.targetEvidence.find((item) => item.target.id === button?.id)
        ?.nativeLabels.status,
    ).toBe('omitted-incomplete');
  });

  it('keeps the existing single-document V2 snapshot shape and values', () => {
    const html = '<h1>Home</h1><button aria-label="Open menu">Menu</button>';
    const project = extractHtmlProjectContext([
      { documentId: 'home', filePath: 'home.html', html },
    ]);

    expect(project.documents[0]?.snapshot).toEqual(extractHtmlContextV2(html));
  });

  it('resolves aria-errormessage references and preserves unresolved or ambiguous states', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'messages',
        filePath: 'messages.html',
        html:
          '<input aria-errormessage="error">' +
          '<p id="error" role="alert" aria-live="assertive">Invalid value.</p>' +
          '<input aria-errormessage="missing">' +
          '<input aria-errormessage="duplicate">' +
          '<p id="duplicate">First.</p><p id="duplicate">Second.</p>',
      },
    ]);
    const document = project.documents[0];
    const errorRelationships =
      document?.relationships.filter(
        (relationship) => relationship.kind === 'aria-errormessage',
      ) ?? [];

    expect(errorRelationships.map((relationship) => relationship.destination.status)).toEqual([
      'resolved',
      'unresolved',
      'ambiguous',
    ]);
    expect(
      document?.snapshot.evidence.find(
        (record) => record.tagName === 'p' && record.text?.value === 'Invalid value.',
      )?.attributes?.aria?.values['aria-live'],
    ).toMatchObject({
      status: 'present',
      value: { value: 'assertive' },
    });
    expect(adaptContextSnapshotV2(document!.snapshot).status).toBe('ready');
  });

  it('preserves base-URL query and fragment identity without merging distinct destinations', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'source-a',
        filePath: 'pages/a.html',
        html:
          '<base href="/docs/">' +
          '<a href="target.html?view=full#details">Open</a>' +
          '<a href="target.html?view=full#summary">Open</a>',
      },
      {
        documentId: 'source-b',
        filePath: 'pages/b.html',
        html:
          '<base href="/docs/">' +
          '<a href="target.html?view=full#details">Open</a>',
      },
      {
        documentId: 'target',
        filePath: 'docs/target.html',
        html: '<h1 id="details">Details</h1>',
      },
    ]);
    const links = project.documents
      .filter((document) => document.documentId.startsWith('source-'))
      .flatMap((document) => document.links);
    const sameDestination = project.comparisons.filter(
      (comparison) => comparison.basis === 'same-supplied-destination',
    );

    expect(links.map((link) => link.destination)).toEqual([
      {
        status: 'resolved',
        documentId: 'target',
        filePath: 'docs/target.html',
        query: 'view=full',
        fragment: 'details',
      },
      {
        status: 'resolved',
        documentId: 'target',
        filePath: 'docs/target.html',
        query: 'view=full',
        fragment: 'summary',
      },
      {
        status: 'resolved',
        documentId: 'target',
        filePath: 'docs/target.html',
        query: 'view=full',
        fragment: 'details',
      },
    ]);
    expect(sameDestination).toHaveLength(1);
    expect(sameDestination[0]?.destination?.fragment).toBe('details');
    expect(sameDestination[0]?.records).toHaveLength(2);
  });

  it('does not resolve malformed bases or encoded path separators as supplied files', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'malformed-base',
        filePath: 'index.html',
        html: '<base href="http://[invalid"><a href="next.html">Next</a>',
      },
      {
        documentId: 'encoded',
        filePath: 'a/b.html',
        html: '<a href="a%2Fb.html">Encoded separator</a>',
      },
      { documentId: 'next', filePath: 'next.html', html: '<p>Next</p>' },
    ]);

    expect(project.documents[0]?.links[0]?.destination.status).toBe('unknown');
    expect(project.documents[1]?.links[0]?.destination.status).toBe('unknown');
  });

  it('records static image, caption, heading, form-group, and adjacent-text evidence', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'structure',
        filePath: 'structure.html',
        html:
          '<main><h1>Profile</h1>' +
          '<p aria-invalid="grammar" aria-live="assertive">Choose your avatar.</p>' +
          '<figure><img src="avatar.png" alt="Profile portrait">' +
          '<figcaption>Shown to other members.</figcaption></figure>' +
          '<table><caption>Account status</caption><tr><th>Status</th>' +
          '<td>Active</td></tr></table>' +
          '<fieldset><legend>Contact</legend><label>Email ' +
          '<input placeholder="name@example.test"></label></fieldset></main>',
      },
    ]);
    const document = project.documents[0];
    const image = document?.snapshot.targets.find(
      (target) => target.kind === 'image',
    );
    const input = document?.snapshot.targets.find(
      (target) => target.kind === 'form-control',
    );
    const instructions = document?.contextRecords.find(
      (record) => record.tagName === 'p',
    );

    expect(image?.attributes).toMatchObject({
      src: { status: 'present', value: { value: 'avatar.png' } },
      alt: { status: 'present', value: { value: 'Profile portrait' } },
    });
    expect(
      document?.relationships.some(
        (relationship) => relationship.kind === 'figure-caption',
      ),
    ).toBe(true);
    expect(
      document?.relationships.some(
        (relationship) => relationship.kind === 'table-caption',
      ),
    ).toBe(true);
    expect(
      document?.relationships.some(
        (relationship) => relationship.kind === 'heading-section-content',
      ),
    ).toBe(true);
    expect(
      document?.relationships.some(
        (relationship) => relationship.kind === 'field-group',
      ),
    ).toBe(true);
    expect(instructions?.attributes['aria-invalid']).toMatchObject({
      status: 'present',
      value: 'grammar',
    });
    expect(instructions?.attributes['aria-live']).toMatchObject({
      status: 'present',
      value: 'assertive',
    });
    expect(
      document?.targetEvidence.find((item) => item.target.id === input?.id)
        ?.surroundingDomText.status,
    ).toBe('present');
  });

  it('associates heading content until the next same-or-higher heading level', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'sections',
        filePath: 'sections.html',
        html:
          '<h1>Account</h1><p>Profile details.</p>' +
          '<h2>Privacy</h2><p>Privacy details.</p>' +
          '<h2>Security</h2><p>Security details.</p>',
      },
    ]);
    const document = project.documents[0];
    const privacyHeading = document?.snapshot.targets.find(
      (target) => target.text?.value === 'Privacy',
    );
    const privacyText = document?.contextRecords.find(
      (record) => record.text.status === 'present' &&
        record.text.value.value === 'Privacy details.',
    );
    const securityText = document?.contextRecords.find(
      (record) => record.text.status === 'present' &&
        record.text.value.value === 'Security details.',
    );
    const destinations = document?.relationships
      .filter(
        (relationship) =>
          relationship.kind === 'heading-section-content' &&
          relationship.source.id === privacyHeading?.id &&
          relationship.destination.status === 'resolved',
      )
      .flatMap((relationship) =>
        relationship.destination.status === 'resolved'
          ? [relationship.destination.record.id]
          : [],
      );

    expect(destinations).toContain(privacyText?.id);
    expect(destinations).not.toContain(securityText?.id);
  });

  it('reports duplicate-attribute diagnostics and does not infer a missing authored name', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'duplicate-attributes',
        filePath: 'duplicate.html',
        html:
          '<form><input id="field" aria-label="First" ' +
          'aria-label="Second"></form>',
      },
    ]);
    const document = project.documents[0];
    const input = document?.snapshot.targets.find(
      (target) => target.tagName === 'input',
    );
    const inputEvidence = document?.targetEvidence.find(
      (item) => item.target.id === input?.id,
    );

    expect(
      document?.parserDiagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'duplicate-attribute' &&
          diagnostic.affectedRecords.some((record) => record.id === input?.id),
      ),
    ).toBe(true);
    expect(
      document?.parserDiagnostics
        .filter((diagnostic) => diagnostic.code === 'duplicate-attribute')
        .every(
          (diagnostic) =>
            !diagnostic.affectedRecords.some(
              (record) => record.recordType === 'context',
            ),
        ),
    ).toBe(true);
    expect(input?.attributes.aria.values['aria-label']?.status).toBe('unavailable');
    expect(inputEvidence?.authoredNameInputs.status).toBe('unknown');
    expect(inputEvidence?.nativeLabels.status).toBe('unknown');
    expect(document?.snapshot.completeness.status).toBe('partial');
    expect(adaptContextSnapshotV2(document!.snapshot).status).toBe('partial');
  });

  it('retains ambiguous native-label evidence instead of confirming name absence', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'duplicate-ids',
        filePath: 'duplicates.html',
        html:
          '<label for="field">Account name</label>' +
          '<input id="field"><input id="field">',
      },
    ]);
    const evidence = project.documents[0]?.targetEvidence.filter(
      (item) => item.target.recordType === 'target',
    );

    expect(evidence).toHaveLength(2);
    expect(
      evidence?.every(
        (item) =>
          item.nativeLabels.status === 'ambiguous' &&
          item.authoredNameInputs.status === 'present' &&
          item.authoredNameInputs.value.some(
            (input) =>
              input.source === 'native-label' &&
              input.certainty === 'ambiguous',
          ),
      ),
    ).toBe(true);
  });

  it('does not resolve ID references through duplicate-attribute uncertainty', () => {
    const snapshot = extractHtmlContextV2(
      '<div id="label" id="other">First label</div>' +
        '<button aria-labelledby="label">Open</button>' +
        '<span id="label">Second match</span>',
    );
    const relationship = snapshot.relationships.find(
      (item) => item.kind === 'aria-labelledby',
    );

    expect(relationship?.destination.status).toBe('unknown');
    expect(snapshot.completeness.relationshipResolution.unknownCount).toBe(1);
  });

  it('keeps cross-document comparisons within their document and destination identities', () => {
    const project = extractHtmlProjectContext([
      {
        documentId: 'one',
        filePath: 'one.html',
        html: '<a href="/target.html#one">Continue</a>',
      },
      {
        documentId: 'two',
        filePath: 'two.html',
        html: '<a href="/target.html#two">Continue</a>',
      },
      {
        documentId: 'target',
        filePath: 'target.html',
        html: '<h1>Target</h1>',
      },
    ]);

    expect(
      project.comparisons.filter(
        (comparison) => comparison.basis === 'same-supplied-destination',
      ),
    ).toHaveLength(0);
    expect(
      project.comparisons.some(
        (comparison) =>
          comparison.basis === 'exact-authored-link-text' &&
          new Set(comparison.records.map((record) => record.documentId)).size ===
            2,
      ),
    ).toBe(true);
  });

  it('rejects duplicate document identities and file paths explicitly', () => {
    const document = {
      documentId: 'page',
      filePath: 'page.html',
      html: '<p>Page</p>',
    };
    expect(() =>
      extractHtmlProjectContext([document, { ...document, filePath: 'other.html' }]),
    ).toThrowError(ProjectExtractionError);
    expect(() =>
      extractHtmlProjectContext([
        document,
        { ...document, documentId: 'other' },
      ]),
    ).toThrowError(ProjectExtractionError);
  });
});
