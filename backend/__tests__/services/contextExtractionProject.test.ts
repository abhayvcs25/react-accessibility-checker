import { describe, expect, it } from 'vitest';
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
          '<a href="guides/start.html">Read guide</a>' +
          '<a href="https://external.test/page">Read guide</a>',
      },
      {
        documentId: 'guide',
        filePath: 'guides/start.html',
        html: '<a href="../index.html">Read guide</a>',
      },
    ]);
    const indexLinks = project.documents[0]?.links ?? [];

    expect(indexLinks[0]?.destination).toEqual({
      status: 'resolved',
      documentId: 'guide',
    });
    expect(indexLinks[1]?.destination.status).toBe('external');
    expect(project.documents[1]?.links[0]?.destination).toEqual({
      status: 'resolved',
      documentId: 'index',
    });
    expect(
      project.comparisons.some(
        (comparison) =>
          comparison.basis === 'exact-authored-link-text' &&
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
          '<input id="email" aria-invalid="true" aria-errormessage="email-error">' +
          '<p id="email-error" role="alert" aria-live="assertive">Enter a valid email.</p>' +
          '</form>',
      },
    ]);
    const records = project.documents[0]?.contextRecords ?? [];
    const form = records.find((record) => record.tagName === 'form');
    const errorMessage = records.find((record) => record.authoredId.value === 'email-error');

    expect(form?.attributes.action).toMatchObject({
      status: 'present',
      value: '/account',
    });
    expect(form?.attributes.method).toMatchObject({
      status: 'present',
      value: 'post',
    });
    expect(errorMessage?.role).toMatchObject({
      status: 'present',
      value: 'alert',
    });
    expect(errorMessage?.attributes['aria-live']).toMatchObject({
      status: 'present',
      value: 'assertive',
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
        (item) => item.nativeLabels.status === 'unknown',
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
