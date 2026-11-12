# Prompt 02 — Extract full React project context

You are working in the existing React Accessibility Checker repository:

`D:\react-accessibility-checker`

Read `prompts\react-accessibility-extraction\README.md` and complete
`01-single-react-file-20-rules.md` first. Verify its tests and source evidence
contract before beginning this stage. Follow the fixed model-configuration
and IBM boundaries in the README.

## Goal

Complete the end-to-end React project-folder workflow. Accept a user-supplied
React project tree, preserve its relative file structure, build bounded
cross-file context for the 20 rules in
`docs\contextual-accessibility-rules.md`, run eligible native HTML and
React-derived static HTML through the existing IBM checker, then run eligible
source evidence through the existing six-model assessment/report pipeline.
Return one report that clearly separates IBM findings, model advice, source
locations, and incomplete coverage.

This stage is **static project-source analysis**. It is not URL scanning,
website crawling, dependency installation, project execution, browser
rendering, or proof that every runtime route/state was inspected. IBM accepts
HTML, not JSX: the only React-derived input permitted for IBM is a clearly
labeled, deterministic HTML projection built from statically supported JSX.
Never pass raw JSX/TSX to IBM or claim a projection is the browser-rendered
application. The 20 contextual rules are assessed through the existing
six-model pipeline; IBM runs its own unchanged rule set against the HTML
input, not the 20-rule catalog.

## Intake and safe project boundaries

1. Provide a project-upload experience that preserves each relative path.
   Inspect the existing frontend/API constraints and choose one minimal
   transport (directory selection or a validated archive); do not silently
   flatten filenames or implement multiple upload transports without need.
2. Validate every path as a non-empty relative path contained within the
   supplied project root. Reject traversal, absolute paths, duplicate paths,
   malformed archives, unsupported encodings, and invalid project input with
   explicit errors.
3. Apply configurable-but-bounded file count, total bytes, per-file bytes,
   AST-node count, text/attribute size, project-index size, and model-evidence
   size limits. Report omissions and project completeness; never call an
   incomplete scan a complete project analysis.
4. Never read or transmit `.env`, `.env.*`, credentials, private keys,
   certificates, `.git`, `node_modules`, build output, `dist`, coverage,
   caches, or binary files as source. Apply an explicit allow/deny policy and
   test it. Permit bounded `.html`/`.htm` project documents as possible
   templates or standalone pages; do not execute scripts in them. Do not log
   uploaded source contents.
5. If archives are accepted, defend against path traversal, symlink entries,
   duplicate names, excessive entry counts, and decompression/resource bombs.
   Never extract outside a controlled temporary root. Clean up only the
   request's own temporary files.
6. Do not install dependencies or run package scripts, Vite, tests, builds, or
   any code from the uploaded project. This does not prohibit running this
   repository's own tests/builds for validation. Do not follow symlinks or
   fetch remote imports/assets. Source manifests may be inspected as bounded
   untrusted metadata only.
7. Explain to the user that selected source evidence may be sent to the
   configured IBM checker and external model providers. Ask for explicit
   analysis action/consent consistent with the existing UI pattern. Send only
   bounded HTML projections to IBM and minimum rule-relevant evidence to the
   models; never send the full project or secret-bearing files.

## Project index and source evidence

- Reuse and extend the source evidence contract from Prompt 01. Do not create
  a second incompatible JSX parser or alter HTML V2's schema/semantics.
- Parse supported `.jsx`, `.tsx`, `.js`, and `.ts` source files as syntax only.
  Also index eligible `.html`/`.htm` documents as source templates/pages.
  Explicitly record ignored/unsupported files. Use the existing TypeScript
  project configuration for path-alias interpretation only where it can be
  resolved statically; do not execute configuration files.
- Build a bounded import/export and component-reference index. Handle
  unresolved imports, cycles, aliases, re-exports, dynamic imports, and
  ambiguous symbols explicitly. Do not assume a custom component renders
  native HTML merely because its name resembles a tag or accessibility role.
- Extract stable project-scoped target/evidence IDs using the project
  snapshot identity, normalized relative source path, and source locator.
  Include component/function identity only when established by static source
  evidence. Preserve line/column and exact bounded source excerpts.
- Resolve only supported static relationships across supplied files. A
  missing file, dynamic import, runtime prop, environment-dependent route, or
  omitted source file is unknown/incomplete—not confirmed absent.
- Create a coverage record that identifies supplied, parsed, ignored,
  unsupported, malformed, and omitted files; discovered component/route
  candidates; unresolved imports; and extraction truncations. State clearly
  that coverage is limited to the user-supplied files and supported static
  patterns.
- Do not infer the rendered route set from a filename scan. If static route
  configuration is recognizable, record the evidence and its limits; do not
  claim dynamic or authenticated route coverage.

## Static HTML projection and unchanged IBM checker

The current IBM boundary is `aChecker.getCompliance(html, label)` in
`backend\src\services\checker.ts`, after the existing checker configuration
is validated. Keep the IBM package, policy/rules, configuration, call
semantics, issue normalization, summary-count meanings, and error behavior
unchanged. Do not change the existing HTML endpoint's results.

Add a React-project adapter/coordinator; do not make IBM parse JSX:

- Build a deterministic, bounded HTML projection only from native JSX
  elements, literal text, and literal attributes supported by the static
  extractor. Correctly escape text/attributes and serialize valid HTML.
  Record a sidecar mapping from generated element paths to JSX file/line/
  column when that mapping is unambiguous. Never add scan-only attributes or
  guessed labels, values, names, document metadata, or runtime states.
- Identify page/root candidates from explicit, statically supported entry or
  route references. Generate no more than one projection per discovered page
  root within documented limits; do not treat every component as a page.
  Record unresolved roots and routes as incomplete coverage.
- Reuse a supplied HTML entry document as the shell only when its mount point
  and statically supported React root can be paired unambiguously. Do not
  execute entry scripts or pretend an empty mount point is rendered content.
  Otherwise use a minimal synthetic HTML wrapper only if required by the
  existing checker's input contract, and mark the wrapper as generated.
  Never invent document metadata or app content. Verify the projection format
  against the installed checker; if a valid static root cannot be produced,
  record IBM as not run for that artifact and explain why rather than
  manufacturing a success report.
- Do not execute components, evaluate expressions, run SSR, transpile-and-run,
  install dependencies, or guess route/component output. A dynamic branch,
  unresolved custom component, prop-dependent markup, or unknown runtime
  state must be omitted with an explicit coverage reason. Only expand a
  custom component when its static markup and all relevant inputs are
  unambiguous under a documented conservative policy.
- Scan standalone supplied HTML pages as their actual HTML input. If an HTML
  document is used as a projection shell, do not also report the same shell
  as a separate duplicate page scan unless the report clearly distinguishes
  those scopes.
- Run IBM checks before model scheduling, matching the existing analysis
  order. Reuse shared checker configuration, invocation, normalization, and
  count helpers where possible. If a small extraction/refactor is needed,
  prove parity with existing HTML endpoint tests; do not change its behavior.
  Do not call the combined HTML analyzer once per projection if that repeats
  model scheduling; run the unchanged IBM operation for the bounded scan
  artifacts, then schedule project evidence through the model pipeline once
  for the project request.
- Keep each IBM result tied to its exact input artifact (native HTML or
  generated projection). Map it back to source only through the sidecar when
  exact and unambiguous; otherwise show the projection's DOM path and say
  source mapping is unavailable. Label all projection results as static and
  partial, not as findings from a rendered browser DOM.
- Preserve per-artifact IBM counts/findings and provide project totals with
  the number and scope of scans explicit. Do not silently deduplicate,
  inflate, or recategorize IBM results.
- If an input cannot yield a valid projection, do not call IBM with raw
  source and do not synthesize empty IBM success counts. Return an explicit
  per-artifact not-scanned status and coverage reason.

## Rule application across the project

Use the exact rule definitions and evidence requirements in
`docs\contextual-accessibility-rules.md`. For every assessment retain the
source/project evidence references, per-rule evidence availability, and
project coverage relevant to that decision.

Cross-file comparison can generate candidates for rules such as button
action-name consistency (6), ARIA naming consistency (14), and terminology
consistency (20), but literal string matches or differences do not establish
equivalent actions, concepts, or user confusion. Require explicit evidence
for equivalence and scope coverage; otherwise abstain.

The source project alone still cannot establish all browser/runtime/image
facts. In particular:

- Rules 1–3 cannot claim visual image/alt correspondence without image
  evidence; never infer pixels from a path or filename.
- Rules 7–9 need reliable destination/context/group evidence; static hrefs
  do not prove destination semantics or visual similarity.
- Rules 12–15 may need persistent rendered labels, computed accessible names,
  visible text, or precedence results.
- Rules 16–19 may need reliable rendered section boundaries, active workflow
  state, current validation result, or the actual error cause.
- Rule 20 requires declared project coverage and supported concept/action
  equivalence, not merely a terminology corpus.

Represent each required evidence item's state explicitly. Schedule only
rule-specific assessments that the evidence supports; for unsupported
subchecks show a clear coverage/not-assessed explanation or
`insufficient_context`, according to the existing response contract. Never
send all 20 rules to every target merely to produce a full-looking report,
and never label absent evidence as `no_issue_detected`.

## Reuse the existing AI/report boundary without changing model configuration

- Route eligible, bounded evidence through the existing six-model
  configuration, scheduler, provider adapters, validation, persistent
  ledger, and report aggregation. Preserve the current model assignment,
  fallback behavior, request caps, provider pacing, token budgets, and
  failure semantics.
- Do not edit provider/model configuration, model IDs, endpoints, credentials,
  opt-in, provider clients, quotas, output limits, retry policy, concurrency,
  or ledger budgets. Do not run live inference or change settings to make
  tests pass.
- Extend only the extraction/rule-input and result-location contracts needed
  to carry the new project context. If the current scheduler boundary cannot
  accept source evidence without a provider/configuration change, stop and
  report the interface mismatch instead of changing model configuration.
- Maintain IBM independence. Do not feed raw JSX/TSX or model conclusions to
  IBM, and do not recast source-model findings as IBM issues. The IBM adapter
  above is a separate, unchanged HTML-checker invocation over eligible
  native-HTML/static-projection inputs. Keep its issues distinguishable from
  model advice and preserve links to shared evidence only as references.
- After IBM scans complete, pass the bounded React project evidence through
  the existing six-model scheduler and report path using its current model
  assignment/fallback and request limits. Do not force all six models to run
  on every file or rule, bypass eligibility, or raise configured request
  caps. Eligible project targets may consume the existing allowed budget;
  show remaining targets as not assessed if that budget is exhausted. Use
  the six-model integration exactly as currently configured.
- Carry project-relative path, line/column, target/component ID, rule ID,
  supporting evidence, model outcomes, disagreements, and coverage into the
  report and consolidated fixing prompt. Keep the prompt bounded and instruct
  the external coding assistant to inspect before editing; this app must not
  modify the project.

## Tests and acceptance criteria

Add focused tests for:

- directory/archive path preservation and traversal/duplicate/symlink
  rejection;
- `.env` and secret-file exclusion without reading or logging their contents;
- file/total/record limits and accurate incomplete-coverage reporting;
- multi-file imports, re-exports, aliases, cycles, unresolved imports, and
  dynamic imports;
- project-stable target identity and exact file/line/column locations;
- cross-file label/ARIA relationships where statically explicit;
- correct no-claim/abstention behavior for runtime, image, route, and
  equivalence-dependent rules;
- rule 6/14/20 candidate grouping that does not treat string similarity as
  proof of equivalence;
- bounded evidence, evidence-reference validation, model provenance, partial
  provider outcomes, and source-specific fixing-prompt locations;
- deterministic JSX-to-HTML projections, escaped literals, omitted dynamic
  branches, and exact/ambiguous source-map behavior;
- IBM receives only native HTML or a validated projection, runs before model
  scheduling, and produces clearly projection-scoped findings/counts;
- the projection format is exercised against the installed IBM checker with a
  local fixture, and project orchestration is tested with a controlled IBM
  boundary; neither requires live model calls or changes to IBM configuration;
- unchanged HTML analysis, IBM results/counts, six-model configuration and
  dispatch behavior, and existing report behavior.

Use mocked scheduling/provider boundaries only. Run relevant backend tests,
backend build, frontend lint/build when changed, and `git diff --check`.
Document the exact supported file patterns, IBM projection semantics,
project coverage, limits, and rules requiring a future browser/image/runtime
phase. The final acceptance test must upload a representative multi-file
React project, verify the safe extraction and report end to end using mocked
model providers and a controlled IBM checker boundary, and confirm the normal
HTML endpoint remains behaviorally unchanged.

## Explicitly out of scope

- URL input, web crawling, React detection from a remote page, and external
  network fetching.
- Installing/building/running submitted projects or opening them in a browser.
- Automatically discovering all routes or dynamic/authenticated states.
- Changing any model/provider configuration or running live inference.
- Modifying IBM's checker package, policy/rules, configuration, or analyzer
  behavior; only the static HTML adapter and project orchestration may be
  added.
- Automatic code fixes or writing changes into the uploaded project.

