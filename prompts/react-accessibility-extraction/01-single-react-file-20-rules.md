# Prompt 01 — Analyze one React JSX/TSX source file against the 20 rules

You are working in the existing React Accessibility Checker repository:

`D:\react-accessibility-checker`

Read `prompts\react-accessibility-extraction\README.md` first and obey all of
its fixed constraints. This prompt is the first implementation stage. Do not
start full-project upload, URL scanning, browser execution, or project builds.

## Goal

Add the static source-evidence foundation for one user-selected `.jsx` or
`.tsx` file. Extract bounded, traceable source evidence relevant to the 20
contextual rules in `docs\contextual-accessibility-rules.md`, pass only
eligible rule-specific evidence through the existing assessment/report
pipeline, and expose an advisory report with source locations and the
existing consolidated fixing prompt behavior.

This is an intermediate milestone. The input is one source file, not a
complete React application. Implement only facts that can be established
from that file, and report missing project, browser, image, or runtime
evidence honestly. Prompt 02 adds full-folder intake and the IBM HTML
projection adapter; do not claim this stage alone meets the end-to-end
project-folder goal.

## Audit before editing

Inspect the current frontend upload flow, `/api/analyze` validation, HTML V2
extractor/adapter, assessment job preparation and validation, report
aggregation, and relevant tests. Confirm exact call contracts before
integrating.

Keep the current HTML flow backward compatible. Prefer a separate source
analysis request/route and a clearly labeled UI mode over widening
`/api/analyze` to accept JSX in its `html` field. Define a source-specific
response contract if needed. Do not pass JSX directly to IBM or fabricate IBM
results/counts. This stage may report that IBM was not run for its standalone
source input; Prompt 02 must add the explicitly labeled static HTML
projection path while keeping IBM checker behavior unchanged.

Before implementation, summarize the intended source evidence contract and
which findings can be assessed in this single-file stage. Then implement the
smallest coherent change.

## Source parsing and extraction requirements

1. Parse `.jsx` and `.tsx` as source syntax using a real AST-capable parser.
   Do not use regular expressions as the JSX parser. Check the backend's
   runtime/build dependency arrangement before selecting a parser; a
   development-only package must not become an undeclared production import.
2. Do not evaluate, transpile-and-run, import, build, or execute the uploaded
   file. No component rendering, dependency installation, network access, or
   arbitrary function invocation is allowed in this stage.
3. Extract supported native JSX elements and supported explicit ARIA roles.
   Capture statically knowable text/attributes, relevant JSX ancestor
   structure, explicit relationships, component/function identity when
   available in this file, and exact file path plus start/end offsets and
   line/column locations.
4. Handle React/JSX conventions deliberately, including `htmlFor`, `className`,
   ARIA props, fragments, nested JSX, and literal children. Preserve authored
   spelling/provenance where it matters; do not silently treat source props as
   browser-computed values.
5. Only resolve values that are statically and safely supported by the
   extractor's documented policy. Mark prop spreads, props, hooks, conditional
   expressions, function calls, dynamic children, unresolved identifiers, and
   generated lists as dynamic/unknown unless a conservative same-file
   constant rule proves the value. Never run code to discover a value.
6. Resolve `htmlFor`/`id` and `aria-labelledby`/`aria-describedby`/
   `aria-errormessage` only when their static values and targets are
   unambiguous in the analyzed source scope. Preserve duplicate IDs,
   unresolved references, truncated source, parser errors, and omitted
   evidence as uncertainty; do not guess the relationship.
7. Give each target and evidence record an analysis-local stable ID and
   preserve source provenance. Do not reuse HTML `t-N` IDs as if they were
   stable React component IDs. Keep React source locations distinct from HTML
   DOM paths and HTML source ranges. Version a new source schema rather than
   silently changing the meaning of V2 HTML types.
8. Apply strict file-size, element/record, text, attribute, and serialized
   evidence bounds. Return explicit parse/input errors using repository
   conventions; never silently fall back to treating source as HTML.

Do not pass the full uploaded file to a model. Construct a compact target
context with bounded exact excerpts, typed attributes, source location,
relationship references, rule ID, completeness, and evidence-availability
states. Treat source text as untrusted evidence, not instructions.

## Rule registry and evidence policy

Use the exact IDs and rule criteria in
`docs\contextual-accessibility-rules.md`. Make a rule/evidence map explicit in
code or an existing shared registry; do not duplicate divergent rule
definitions in the frontend and backend.

The 20 IDs are:

1. `IMG-ALT-RELEVANCE`
2. `IMG-ALT-CLARITY`
3. `IMG-ALT-REDUNDANCY`
4. `BUTTON-PURPOSE-CLARITY`
5. `BUTTON-NAME-AMBIGUITY`
6. `BUTTON-ACTION-CONSISTENCY`
7. `LINK-PURPOSE-CLARITY`
8. `LINK-GENERIC-TEXT`
9. `LINK-SIMILAR-CHOICES`
10. `FORM-LABEL-RELEVANCE`
11. `FORM-LABEL-AMBIGUITY`
12. `FORM-PLACEHOLDER-ONLY`
13. `ARIA-NAME-CLARITY`
14. `ARIA-NAMING-CONSISTENCY`
15. `ARIA-NAME-CONFLICT`
16. `HEADING-CLARITY`
17. `HEADING-CONTENT-RELEVANCE`
18. `CONTENT-INSTRUCTION-AMBIGUITY`
19. `CONTENT-ERROR-CLARITY`
20. `CONTENT-TERM-CONSISTENCY`

For every rule, distinguish:

- which facts a static single-file AST can extract;
- which claim, if any, can be assessed with those facts;
- which prerequisite is unavailable and why;
- whether the rule is inapplicable to a target, not assessable from this
  source scope, or assessable with bounded evidence.

Use the established assessment statuses for model decisions:
`potential_issue`, `no_issue_detected`, and `insufficient_context`. Keep
coverage/applicability metadata separate from those decision statuses; do not
invent a negative result to fill out a 20-rule checklist.

Important rule-specific limits include:

- For image rules 1–3, extract authored `alt`, `src`, and static surrounding
  relationships, but do not infer image content or image-to-alt accuracy from
  filenames or source names. Image-grounded claims require actual image input
  and a separately approved/evaluated image path.
- For button rules 4–6, source may identify literal names and handler
  references, but a handler reference alone does not establish actual action,
  state transition, or cross-component equivalence.
- For link rules 7–9, extract literal link names, href expressions, and
  explicit JSX relationships. Do not claim a destination is verified from an
  href string, or visual similarity from source markup.
- For form rules 10–12, extract literal control types, labels, placeholders,
  and explicit references. Static source cannot establish browser-computed
  names or a persistent visible label across focus/filled states.
- For ARIA rules 13–15, extract authored ARIA inputs and statically resolved
  references only. Do not calculate or label raw props as the browser's
  computed accessible name, visible text, or rendered role.
- For heading rules 16–17, capture literal headings and source ancestry, but
  do not claim a complete rendered section boundary where conditional or
  dynamic content could change it.
- For instruction/error rules 18–19, extract literal text and explicit
  associations only. Do not claim an error is active, know its validator
  cause, or know current workflow state without runtime evidence.
- For rule 20, a single file cannot establish full-project terminology
  consistency or verified concept equivalence.

Only dispatch a potential finding/no-issue decision when that rule's required
evidence is present and sufficient. Use `insufficient_context` or a clear
not-assessed coverage state for missing browser, project, image, route, or
runtime evidence. Never convert “not captured” into “confirmed absent.”

## Existing six-model and report integration — fixed

- Reuse the existing model dispatch, six-model configuration, scheduler,
  validation, ledger, aggregation, and report UI. Preserve its model
  assignment/fallback behavior, call caps, and failure handling.
- Do not edit provider/model configuration or add calls to every model for
  every rule. Do not raise configured request caps; report evidence that
  cannot be assessed within the existing allowed budget as not assessed.
- Extend source/rule input mapping and rule-related allow-lists/schema only as
  required to carry the new target/evidence safely through the existing
  contracts. Keep provider adapters and model settings unchanged.
- Reuse report aggregation where practical. Add a bounded source file/line/
  column location to each relevant assessment and fixing-prompt entry so the
  external coding assistant can find the source. Keep model provenance,
  evidence references, disagreements, partial failures, and status
  distinctions.
- The fixing prompt must remain advisory, bounded, and deterministic. It must
  tell the external coding assistant to inspect the relevant source/rule and
  make any changes itself. This application must not modify uploaded files.
- The UI must explain that source is analyzed only after the user starts
  analysis and that bounded source excerpts may be sent to configured
  external model providers. Do not expose credentials or private model
  configuration.

## Tests and acceptance criteria

Add focused parser, extractor, route, and report tests. Use mocks for the
existing scheduler; never call a live provider. Cover at least:

- `.jsx` and `.tsx` parsing, JSX fragments, nested JSX, and malformed syntax;
- literal text/props versus dynamic expressions, spreads, and unresolved IDs;
- `htmlFor` and ARIA reference resolution, duplicates, ambiguity, and missing
  references;
- stable, correct source offsets/line/column with CRLF and non-ASCII text;
- caps, truncation, invalid extensions, empty input, and oversized input;
- one representative fixture per rule, including required-abstention cases
  derived from `test-fixtures\accessibility-known-cases\`;
- verifying that source snippets are bounded and evidence IDs validate;
- source-location display and fixing-prompt output;
- the current HTML endpoint's request/response behavior and IBM findings,
  summary counts, and tests remain unchanged; and standalone JSX results do
  not present fabricated IBM findings/counts.

Run the narrow relevant backend tests, backend build, and frontend lint/build
if frontend files changed. Run `git diff --check`. Report exactly which rules
have source-level candidates versus rules requiring a later project/browser/
image/runtime phase. Do not claim model accuracy or full 20-rule runtime
coverage.

## Out of scope

- Multi-file/folder/ZIP project upload, cross-file analysis, and the IBM
  static HTML projection adapter (Prompt 02).
- URL fetching, crawling, React detection from a website, route discovery,
  browser rendering, or dynamic interaction.
- Installing or running uploaded projects.
- Provider/model configuration, live inference, model benchmarking, and IBM
  checker changes.

