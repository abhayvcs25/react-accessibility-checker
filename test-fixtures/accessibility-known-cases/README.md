# Accessibility known-case HTML fixtures

This folder contains 40 paired single-rule HTML cases (one violation candidate
and one no-violation candidate for each proposed rule), plus five pages with
multiple candidate issues.

## Important limits

- The 20 rules and these expected case labels come from
  [the contextual rule specification](../../docs/contextual-accessibility-rules.md).
  They are evaluation stimuli, not proof that an uploaded page violates WCAG.
- The live contextual assessment scheduler currently dispatches button and
  form-control targets for `BUTTON-PURPOSE-CLARITY` and
  `FORM-LABEL-RELEVANCE`. It does not dispatch the other 18 proposed rules.
  Custom ARIA widgets are deliberately not sent for `ARIA-NAME-CLARITY`
  because this static HTML path does not provide a browser-computed accessible
  name.
- The scheduler sends bounded associated text and a structured, capped parent
  subtree (including extracted tags, selected attributes, labels, sibling
  controls, and parent-child links) when available. It does not send arbitrary
  raw HTML; context completeness is explicit. This improves the evidence for
  supported checks, but does not replace required browser or application
  evidence.
- Some rules require evidence static HTML cannot provide, such as computed
  accessible names, rendered visibility across states, verified handlers,
  actual image pixels, complete project coverage, and validated destinations.
  Those cases are labeled candidates; evaluate them with the additional
  evidence described by the rule specification. Static markup alone may
  correctly result in insufficient context.
- The files contain no embedded expected answers, to avoid leaking labels into
  the model prompt. Use the filenames and this manifest to track the intended
  case. Each page is standalone and can be uploaded individually.
- Automated extraction tests cover all 40 paired cases and verify that each
  intended target kind is recognized. They do not invoke AI providers or
  validate model judgments. No live-server opt-in changes were made.

## Paired cases

01. `IMG-ALT-RELEVANCE` — Image alternative-text relevance: `01-img-alt-relevance-violation.html` (violation candidate) and `01-img-alt-relevance-no-violation.html` (no-violation candidate).
02. `IMG-ALT-CLARITY` — Image alternative-text clarity: `02-img-alt-clarity-violation.html` (violation candidate) and `02-img-alt-clarity-no-violation.html` (no-violation candidate).
03. `IMG-ALT-REDUNDANCY` — Unnecessary alternative-text wording: `03-img-alt-redundancy-violation.html` (violation candidate) and `03-img-alt-redundancy-no-violation.html` (no-violation candidate).
04. `BUTTON-PURPOSE-CLARITY` — Button purpose clarity: `04-button-purpose-clarity-violation.html` (violation candidate) and `04-button-purpose-clarity-no-violation.html` (no-violation candidate).
05. `BUTTON-NAME-AMBIGUITY` — Ambiguous button names: `05-button-name-ambiguity-violation.html` (violation candidate) and `05-button-name-ambiguity-no-violation.html` (no-violation candidate).
06. `BUTTON-ACTION-CONSISTENCY` — Button action-name consistency: `06-button-action-consistency-violation.html` (violation candidate) and `06-button-action-consistency-no-violation.html` (no-violation candidate).
07. `LINK-PURPOSE-CLARITY` — Link purpose clarity: `07-link-purpose-clarity-violation.html` (violation candidate) and `07-link-purpose-clarity-no-violation.html` (no-violation candidate).
08. `LINK-GENERIC-TEXT` — Generic link text: `08-link-generic-text-violation.html` (violation candidate) and `08-link-generic-text-no-violation.html` (no-violation candidate).
09. `LINK-SIMILAR-CHOICES` — Similar-looking links with unclear purposes: `09-link-similar-choices-violation.html` (violation candidate) and `09-link-similar-choices-no-violation.html` (no-violation candidate).
10. `FORM-LABEL-RELEVANCE` — Form label relevance: `10-form-label-relevance-violation.html` (violation candidate) and `10-form-label-relevance-no-violation.html` (no-violation candidate).
11. `FORM-LABEL-AMBIGUITY` — Ambiguous form labels: `11-form-label-ambiguity-violation.html` (violation candidate) and `11-form-label-ambiguity-no-violation.html` (no-violation candidate).
12. `FORM-PLACEHOLDER-ONLY` — Placeholder-only guidance: `12-form-placeholder-only-violation.html` (violation candidate) and `12-form-placeholder-only-no-violation.html` (no-violation candidate).
13. `ARIA-NAME-CLARITY` — Accessible-name clarity: `13-aria-name-clarity-violation.html` (violation candidate) and `13-aria-name-clarity-no-violation.html` (no-violation candidate).
14. `ARIA-NAMING-CONSISTENCY` — Naming consistency: `14-aria-naming-consistency-violation.html` (violation candidate) and `14-aria-naming-consistency-no-violation.html` (no-violation candidate).
15. `ARIA-NAME-CONFLICT` — Conflicting naming information: `15-aria-name-conflict-violation.html` (violation candidate) and `15-aria-name-conflict-no-violation.html` (no-violation candidate).
16. `HEADING-CLARITY` — Heading clarity: `16-heading-clarity-violation.html` (violation candidate) and `16-heading-clarity-no-violation.html` (no-violation candidate).
17. `HEADING-CONTENT-RELEVANCE` — Heading relevance to surrounding content: `17-heading-content-relevance-violation.html` (violation candidate) and `17-heading-content-relevance-no-violation.html` (no-violation candidate).
18. `CONTENT-INSTRUCTION-AMBIGUITY` — Ambiguous instructions: `18-content-instruction-ambiguity-violation.html` (violation candidate) and `18-content-instruction-ambiguity-no-violation.html` (no-violation candidate).
19. `CONTENT-ERROR-CLARITY` — Unclear error messages: `19-content-error-clarity-violation.html` (violation candidate) and `19-content-error-clarity-no-violation.html` (no-violation candidate).
20. `CONTENT-TERM-CONSISTENCY` — Inconsistent terminology: `20-content-term-consistency-violation.html` (violation candidate) and `20-content-term-consistency-no-violation.html` (no-violation candidate).

## Multiple-candidate cases

- `multi-01-multiple-candidates.html` — Form labels, buttons, and headings.
- `multi-02-multiple-candidates.html` — Ambiguous links and unclear instructions.
- `multi-03-multiple-candidates.html` — Image descriptions and form guidance.
- `multi-04-multiple-candidates.html` — Conflicting names and error guidance.
- `multi-05-multiple-candidates.html` — Action wording and heading relevance.
