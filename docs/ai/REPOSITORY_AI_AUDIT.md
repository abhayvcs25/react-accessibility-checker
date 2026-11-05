# Repository AI Migration Audit

**Audit scope:** Phase A / prompt 01, read-only repository inspection | **Repository:** `D:\react-accessibility-checker` | **Audit date:** 2026-11-04
**Status:** Complete; no application code was changed and no provider was contacted.

## Evidence labels

- **Observed** means directly present in the inspected worktree.
- **Inferred** means a conclusion from the observed code/imports and is identified
  as such.
- **Not verified** means this audit did not establish the fact, often because
  doing so would require official-provider research, account access, or a live
  request.

## Executive summary

- **Observed:** The production API accepts one HTML document and filename,
  computes IBM Equal Access results, then optionally adds a separate contextual
  assessment report. The IBM result is not combined with AI assessments.
- **Observed:** Production contextual assessment selects one model from a
  Gemini/OpenRouter catalog. The catalog contains six entries, but the
  assessment path does not fan each job out to all six.
- **Observed:** A separate benchmark iterates the six currently configured
  Gemini/OpenRouter entries serially. It is not a six-model production scheduler
  and does not implement the Groq/Cloudflare target architecture.
- **Observed:** The current AI path assesses three rule IDs. The rules
  specification describes 20 proposed checks; it does not mean all 20 are
  implemented.
- **Observed:** V2 HTML extraction and a supplied-multiple-HTML-files project
  extractor exist. The `/api/analyze` route does not call the project extractor,
  and no React source-tree parser or website crawler was found in the active
  route.
- **Observed:** AI usage is persisted to a local JSON file for reporting. It
  stores per-model request attempts and token/latency metrics, not assessment
  batches, inputs, responses, durable idempotency keys, or job states.
- **Inferred:** The usage ledger is not sufficient as the target persistent
  request/batch ledger without a separately approved extension or replacement.
- **Not verified:** The six target model IDs, provider availability, free-tier
  quotas, structured-output capabilities, privacy terms, or provider limits
  were not independently checked during this repository audit. No live provider
  or inference request was made.

## Request flow and call map

1. **Observed — frontend input:** [frontend/src/App.tsx](../../frontend/src/App.tsx)
   accepts a single `.html` or `.htm` file, reads it in the browser, and posts
   `{ html, filename }` to `http://localhost:3001/api/analyze`.
2. **Observed — API validation:** [backend/src/routes/analyze.ts](../../backend/src/routes/analyze.ts)
   validates JSON content type, nonempty HTML, and the HTML filename suffix,
   then calls `analyzeHtml(html, filename)`.
3. **Observed — orchestration:** [backend/src/services/checker.ts](../../backend/src/services/checker.ts)
   serializes analyses through a process-local queue, validates the configured
   IBM checker policy, runs V2 context extraction and adaptation once, and
   continues if extraction/adaptation fails.
4. **Observed — IBM pass:** The same `html` is passed to IBM
   `accessibility-checker` via `getCompliance`. The service normalizes IBM
   results and counts; it calls contextual assessment after this IBM pass.
5. **Observed — optional AI pass:** `getContextualAssessments` calls
   `assessAdaptedContext` and catches failures so the API can still return the
   IBM results. [backend/src/services/contextualAssessment.ts](../../backend/src/services/contextualAssessment.ts)
   applies evidence gates and the selected-model configuration. For eligible
   work it calls
   [backend/src/services/remoteAssessment.ts](../../backend/src/services/remoteAssessment.ts),
   which calls
   [backend/src/ai/providerClient.ts](../../backend/src/ai/providerClient.ts).
6. **Observed — response:** The API returns IBM `summary` and `issues` plus a
   separate `contextualAssessments` report. The report identifies one model at
   report level; each assessment contains a `ruleId` and `targetId`.
7. **Observed — startup and diagnostics:** [backend/src/index.ts](../../backend/src/index.ts)
   starts an asynchronous connection check for the selected model only when
   remote AI is enabled. [backend/src/routes/ai.ts](../../backend/src/routes/ai.ts)
   exposes `/api/ai/health` and `/api/ai/usage`. The frontend has no references
   to these routes in its source.
8. **Observed — optional scripts:** `backend/src/ai/testConnection.ts` probes
   the selected model; `backend/src/ai/benchmark.ts` sequentially iterates the
   configured catalog when keys are available. These scripts can make real
   provider requests if run with credentials; neither was run in this audit.

## Current architecture and implementation inventory

| Area | Observed implementation | Migration relevance |
|---|---|---|
| API and UI | Single HTML upload and `POST /api/analyze`; no URL, multi-page project, or React source upload in the UI/API request contract. | The target project/website submission flow is future work. |
| IBM | `accessibility-checker` integration in `checker.ts`, `.achecker.yml` policy, normalization in the same service, and IBM-focused tests. | Protected. Keep execution and IBM counts/findings independent of AI. |
| V2 extraction | `contextExtractionV2.ts` parses static HTML with `parse5`; `contextAdapterV2.ts` validates/adapts snapshots into bounded target units. Includes completeness and relationship states. | Shared foundation; production path already uses it. Reuse rather than duplicate parsing. |
| Project HTML extraction | `contextExtractionProject.ts` accepts an array of supplied HTML documents, compares captured context, and resolves destinations only among supplied files. It is imported by tests, not by the active API route. | Useful partial foundation, but not a crawler or React source parser. |
| Older extraction | `contextExtraction.ts` is a V1 compatibility layer over the V2 document extractor and is used by its own tests. The production checker calls the V2 result API. | Do not remove until references/tests and consumers are checked at cleanup time. |
| Contextual rules | `contextualAssessment.ts` currently selects `BUTTON-PURPOSE-CLARITY`, `FORM-LABEL-RELEVANCE`, and `ARIA-NAME-CLARITY`, subject to evidence gates. | Only three of the 20 proposed rules are in the active assessment path. |
| Remote assessment | `remoteAssessment.ts` builds one target/rule prompt, validates a constrained assessment object, maintains process-local cache and in-flight deduplication, and calls the selected model. | Single-model orchestration, not multi-model aggregation or persistent job management. |
| Providers/models | `ai/config.ts` defines Gemini and OpenRouter providers and six configured entries (two Gemini, four OpenRouter). `providerClient.ts` contains Gemini and OpenAI-compatible request handling. | These are legacy/current models, not the six Groq/Cloudflare candidates in `prompt.txt`. |
| Rate control | `rateLimiter.ts` has per-provider serialized capacity accounting and a provider concurrency gate. | Existing controls are provider-specific but keyed to the old provider catalog; future model/provider limits require official verification. |
| Usage accounting | `usage.ts` records per-model request attempts, token totals/estimates, rate-limit responses, latency, analysis duration, and zero estimated cost. | Usage reporting is distinct from a durable assessment ledger. |
| Health and usage | `index.ts` checks the selected model at startup when enabled; `routes/ai.ts` reports health and model usage. | Not a six-model health matrix or per-job status API. |
| Local Qwen | `qwenModel.ts` and `qwenModelWorker.ts` implement a local Transformers.js/ONNX worker; `qwenAssessment.ts` contains a local assessment routine. Production `contextualAssessment.ts` does not import or call it. | Legacy experimental path; inspect transitive shared helpers before deletion. |
| Tests | Vitest tests cover the IBM integration boundary, extraction/adaptation, remote assessments, provider behavior, rate limiting, usage, and Qwen. Qwen smoke tests are environment-gated. | Existing tests should be preserved or replaced only with evidence and approval. |

## Phase 3 extraction: verified scope

- **Observed:** The active V2 extractor parses one static HTML string. The
  schema supports typed targets (including images, links, buttons, form
  controls, headings, and selected custom widgets), bounded authored text and
  attributes, associated label/ARIA-reference evidence, source locators, and
  explicit completeness/truncation states.
- **Observed:** The active analyzer passes the V2 result through the adapter
  once. It does not expose the full snapshot as the API response.
- **Observed:** `extractHtmlProjectContext` accepts explicitly supplied HTML
  files and marks its scope `provided-html-files-only`. It resolves links only
  to supplied files and does not crawl external URLs.
- **Observed:** Project extraction is exercised by
  `backend/__tests__/services/contextExtractionProject.test.ts`, but no
  production route imports it.
- **Observed:** The frontend accepts only one `.html`/`.htm` file. No
  React/JSX/TSX source-tree parser, rendered browser capture, route/state
  discovery, or website crawler was found in the inspected active flow.
- **Conclusion:** The current implementation supports static HTML and a
  separate supplied-multiple-HTML-files extraction utility. It must not be
  described as complete React project or website analysis.

## Provider, model, environment, and request controls

### Current catalog versus target shortlist

| Target in `prompt.txt` | Target ID in specification | Current repository status |
|---|---|---|
| Groq GPT-OSS-120B | `openai/gpt-oss-120b` | **Observed:** not in `ai/config.ts`; no Groq client found. **Not verified:** official availability, limits, free access, or API capabilities. |
| Groq GPT-OSS-20B | `openai/gpt-oss-20b` | **Observed:** not in `ai/config.ts`; no Groq client found. **Not verified:** official availability, limits, free access, or API capabilities. |
| Groq Qwen 3.8-27B | `qwen/qwen3.8-27b` | **Observed:** not in `ai/config.ts`; no Groq client found. **Not verified:** exact ID and all provider properties. |
| Cloudflare GLM-4.7-Flash | `@cf/zai-org/glm-4.7-flash` | **Observed:** not in `ai/config.ts`; no Cloudflare client found. **Not verified:** exact ID and all provider properties. |
| Cloudflare NVIDIA Nemotron 3 120B | `@cf/nvidia/nemotron-3-120b-a12b` | **Observed:** not in `ai/config.ts`; no Cloudflare client found. **Not verified:** exact ID and all provider properties. |
| Cloudflare Gemma 4 26B A4B | `@cf/google/gemma-4-26b-a4b-it` | **Observed:** not in `ai/config.ts`; no Cloudflare client found. **Not verified:** exact ID and all provider properties. |

The current six configured entries, observed in `backend/src/ai/config.ts`,
are `gemini-3.8-flash`, `gemini-3.6-flash`,
`recursive/flint-v1.0:free`, `google/gemma-4-31b-it:free`,
`nvidia/nemotron-3.5-super-vl:free`, and `cohere/north-mini-code:free`.
The presence of an ID in configuration or documentation is not proof of
current provider availability, free-tier access, or quota.

### Environment and control inventory

- **Observed:** `RAC_AI_ENABLED` enables/disables contextual remote assessment;
  `RAC_AI_MODEL` selects one catalog ID. Provider keys are
  `GEMINI_API_KEY` and `OPENROUTER_API_KEY`. `backend/src/env.ts` loads
  backend/root `.env` files but their contents were not read.
- **Observed:** The development entry point defaults remote AI on when
  `RAC_AI_ENABLED` is unset; the backend index uses the selected model.
- **Observed:** `backend/src/dev.ts` statically imports `ai/config.ts` before
  its module body sets that default. `ai/config.ts` captures
  `remoteAiEnabled` as a module-level constant during its import.
- **Inferred:** When `RAC_AI_ENABLED` is initially unset, the development
  entry point's later assignment cannot update the already-captured constant.
  The process can log that online assessment is enabled while the imported
  configuration still reports remote AI disabled, skipping startup health
  checks and contextual inference. This behavior was established by source
  order, not a live-provider test.
- **Observed:** Runtime defaults are concurrency 2 (maximum 10), 5 requests per
  minute, 20,000 tokens per minute, 512 output tokens (capped), 2 retries
  (capped at 4), and a 12-hour in-memory response-cache TTL. `ai/config.ts`
  contains additional local provider RPM/TPM caps. These are application
  settings, not proof of upstream quotas.
- **Observed:** Provider retries use `Retry-After` when supplied and usage
  records each HTTP attempt. OpenRouter requests pin the model and set
  `provider.allow_fallbacks` to false. Gemini requests request JSON MIME type
  and the current assessment JSON schema.
- **Observed:** Usage calls report estimated cost as zero; the accounting
  implementation does not calculate an externally billed amount.
- **Not verified:** Whether every current or target model still exists, supports
  the configured output controls, has a persistent free tier, or has particular
  quotas, concurrency, privacy, or retention terms. Those belong in Phase B
  using official provider sources and account-visible limits where applicable.

## Persistence, deduplication, and usage

- **Observed:** The backend package manifest has no declared database client
  (for example SQLite, PostgreSQL, MySQL, MongoDB, Prisma, Drizzle, or Knex).
  No database-backed persistence path was found in backend source.
- **Observed:** `backend/src/ai/usage.ts` reads/writes a versioned JSON ledger.
  Its default location is `%LOCALAPPDATA%\ReactAccessibilityChecker\
  ai-usage.json` on Windows or `~/.react-accessibility-checker/ai-usage.json`
  otherwise; `RAC_AI_USAGE_FILE` can override it. The file is written through a
  temporary file and rename.
- **Observed:** The ledger records model ID, attempt ID/time, estimated request
  tokens, latency, rate-limit flag, reported and estimated input/output tokens,
  request totals, and analysis duration. It retains up to 2,000 attempts per
  model/day, prunes daily summaries older than approximately 90 days, and the
  usage endpoint exposes up to 30 days of summary history.
- **Observed:** The usage ledger does not store project/snapshot IDs, batch/job
  IDs, component/rule scope, context hashes, prompts/schema versions, provider
  request IDs, response references, validation state, or durable job status.
- **Observed:** Remote-assessment caching and in-flight joining are held in
  process memory. The cache key includes selected provider/model, rule ID, and
  evidence; cached responses expire based on the configured TTL and are bounded
  to 500 entries.
- **Inferred:** These mechanisms reduce some duplicate requests within one
  process, but do not establish restart-safe idempotency, multi-process
  coordination, batch tracking, or result reuse across restarts.
- **Not verified:** Whether users have additional external persistence or
  deployment infrastructure not represented in this repository. No store should
  be selected or added before the architecture phase.

## Import/reference evidence and cleanup candidates

The following are candidates for the later approved cleanup phase, not deletion
instructions. No file is deleted by this audit.

| Candidate | Observed dependency/reference evidence | Audit disposition |
|---|---|---|
| Local Qwen inference: `backend/src/services/qwenModel.ts`, `qwenModelWorker.ts` | The worker loads `@huggingface/transformers`; the model wrapper starts the worker. `qwenAssessment.ts` calls the wrapper. Production `contextualAssessment.ts` does not call this pipeline. Qwen unit/smoke tests and docs reference it. | **Inferred:** Qwen execution can be considered obsolete under the target architecture, subject to approval and full reference review. |
| `@huggingface/transformers` dependency | Backend package and lockfile contain the dependency. Source references are in the Qwen worker; no other backend runtime usage was found. | **Inferred:** Likely exclusive to legacy Qwen. Remove the dependency only after a repository-wide lockfile/import check in the cleanup step. |
| `backend/src/services/qwenAssessment.ts` | Production `remoteAssessment.ts` imports `getNamingEvidence` from this file, in addition to the Qwen-specific assessment function. | **Observed:** This module is not wholly Qwen-only. Extract/move or otherwise preserve the shared evidence helper before removing Qwen assessment code. |
| Gemini/OpenRouter provider stack: `backend/src/ai/config.ts`, `providerClient.ts`, `rateLimiter.ts`, `testConnection.ts`, `benchmark.ts` | `index.ts`, routes, contextual orchestration, remote assessments, and tests import these modules. | **Observed:** Active current functionality, not safe to delete until the replacement implementation and callers are migrated and tested. |
| `backend/src/ai/usage.ts` and `/api/ai/usage` | Used by provider rate accounting, checker analysis-duration tracking, and the health/usage route. It also exposes useful per-model usage. | **Observed:** Shared with current routes/accounting. Preserve required reporting or migrate it intentionally; do not delete as an incidental AI cleanup. |
| `backend/src/services/remoteAssessment.ts` and `contextualAssessment.ts` | Active production path; these own prompt construction, evidence gating, caching, response validation, selected-model orchestration, and abstention statuses. | **Observed:** Must be replaced/migrated as part of the new architecture, not removed before call sites and API contract are ready. |
| `backend/src/services/contextExtractionV2.ts`, `contextAdapterV2.ts`, `backend/src/types/contextV2.ts`, `contextProject.ts`, `contextExtractionProject.ts` | Called by the active checker or used by project extraction/tests; contain shared HTML/evidence infrastructure. | **Observed:** Preserve and reuse unless a later, evidence-based architecture explicitly changes a surface. |
| `backend/src/services/checker.ts`, `backend/src/routes/analyze.ts`, `backend/.achecker.yml`, IBM tests and `accessibility-checker` | Active request and IBM execution surfaces; checker tests assert IBM findings and counts remain when contextual analysis fails. | **Observed:** Protected IBM functionality. Do not alter IBM logic to implement the migration. |
| Existing AI docs | `README.md`, `docs/AI_PROVIDER_SETUP.md`, `docs/phase-4.1-model-selection.md`, and `docs/contextual-accessibility-rules.md` contain current, historical, or proposed AI material. | **Observed:** Reconcile claims in a later documentation phase after implementation; do not erase historical evidence without review. |

## IBM protected surfaces and evidence

- **Observed:** IBM policy/configuration is validated before scans in
  `checker.ts`; `accessibility-checker` performs the scan; the service maps
  IBM levels, results, and counts into the existing API contract.
- **Observed:** `backend/__tests__/services/checker.test.ts` asserts the IBM
  input, returned issue, summary counts, and response contract are preserved
  while extraction runs.
- **Observed:** `backend/__tests__/services/checkerContextFailure.test.ts`
  asserts IBM findings remain available when contextual assessment throws.
- **Observed:** Additional IBM-facing route tests exist in
  `backend/__tests__/routes/analyze.test.ts`.
- **Migration constraint:** Keep the IBM output in `issues`/`summary`, keep AI
  advisory results separate, and ensure provider or scheduler failures cannot
  prevent the IBM result from being returned.

## Current implementation versus target specification

| Requirement | Current observed state | Gap / qualification |
|---|---|---|
| Six candidates, two direct providers | Gemini/OpenRouter single-model catalog; no Groq or Cloudflare clients. | All six target IDs and provider claims require Phase B official verification. |
| All models assess in parallel | Production uses one configured model; eligible jobs are handled one at a time by the contextual orchestration loop. | The serial benchmark is not production scheduling. No six-model job scheduler exists. |
| 20 contextual rules | Three rules are active in the contextual assessor. | Twenty checks are proposed in `docs/contextual-accessibility-rules.md`; their definitions, evidence needs, and review status must be reconciled before implementation. |
| Multiple React pages/project submission | API/UI accept one HTML file. Separate helper accepts caller-supplied HTML files only. | React source parsing, rendered route/state extraction, URL crawling, and 10–20-page end-to-end intake are absent from this path. |
| Durable batch and per-request ledger | JSON usage ledger and in-memory model/rule/evidence response cache. | No durable batch/job idempotency, request context, model-by-component status, response record, or cross-process dedupe. |
| Token tracking and model/rule attribution | Usage tracks token metrics by configured model and attempt; report identifies one model and assessments identify rule/target. | No per-assessment token/job link, multi-model producer attribution, batch ledger, or conflict/consensus record. |
| Aggregate disagreements and remove duplicates | No cross-model result aggregation is present in the active path. | Needs explicit policy, model provenance, duplicate identity, disagreement handling, and partial-failure semantics. |
| One consolidated fixing prompt | No fixing-prompt generator/API/UI integration was found in source. | Future report integration only; no automatic code modification should be introduced. |
| Strict ₹0, no paid fallback | Current config pins free-route identifiers for OpenRouter and disables its provider fallback; Gemini is configured as a selected model. | Source configuration alone does not establish account-level free eligibility or prevent billing configured outside the application. No target-provider pricing/quota was verified in this audit. |

## Documentation consistency findings

- **Observed:** The opening of `README.md` still says no checker interface or
  backend exists, while later sections and the actual source describe the
  implemented application. The opening is stale.
- **Observed:** README and setup documentation refer to a root `.env.example`,
  but no `.env.example` file was present in the inspected worktree.
- **Observed:** The README and AI setup guide describe a current single-selected
  Gemini/OpenRouter implementation and experimental Qwen. The target spec asks
  for direct Groq/Cloudflare clients and a different six-model set. These are
  different states, not interchangeable catalogs.
- **Observed:** `docs/phase-4.1-model-selection.md` contains historical sections
  and a dated implementation-update claim that the API path preloads/uses Qwen.
  The current production `contextualAssessment.ts` calls remote assessment and
  does not invoke Qwen. Treat that Qwen API-path passage as inconsistent with
  current source unless subsequent history proves it was true at an earlier
  revision.
- **Observed:** `docs/contextual-accessibility-rules.md` explicitly labels the
  20 rules as proposed and describes extraction gaps. This is consistent with
  the current assessor implementing only three narrow rule IDs, though it
  should not be read as proof all proposed requirements are available.
- **Not verified:** Provider research assertions and external links in the
  setup/model-selection docs were not independently checked during this audit.
  Phase B must use first-party provider sources and clearly separate public
  limits from account-visible quotas.

## Worktree and sensitive files

- **Observed:** At audit start, `git status --short` showed the pre-existing
  untracked root `prompt.txt` and `six-model-implementation-prompts/` directory.
  Neither was modified by this audit.
- **Observed:** Root and backend `.env` files exist in the directory listing.
  Their contents were deliberately not read, printed, or copied.
- **Observed:** `docs/ai/` did not exist before this audit; the only audit output
  is this report.
- **Verification:** No application source, tests, package manifest, existing
  documentation, environment file, or `prompt.txt` was edited by this audit.

## Risks and open questions for later phases

1. **Not verified:** Are the six exact target model IDs currently exposed by
   each named provider's API, and can each be used without purchase/credits?
2. **Not verified:** What context/output caps, structured-output behavior,
   finish reasons, token accounting, quotas, concurrency, `Retry-After`
   semantics, retention, and training/privacy terms apply per target model?
3. **Open:** What persistence mechanism, if any, is already available in the
   intended deployment environment beyond this repository? The codebase itself
   contains no database client or database persistence layer.
4. **Open:** Which project/snapshot identity and content-hash policy can be
   computed from the actual future intake without retaining unnecessary source
   content?
5. **Open:** How should the three currently assessed rules map to the 20
   proposed rule set, and which of the proposed rules have adequate evidence
   and human-reviewed criteria for model assessment?
6. **Open:** Is React source extraction part of the requested migration or a
   separately approved future phase? The specification says it is not
   implemented today.
7. **Open:** What user-facing report shape and disagreement policy should be
   approved before model aggregation and a consolidated fixing prompt are
   implemented?
8. **Risk:** A provider's availability/free tier can change and a zero cost
   field in local usage reporting is not a provider bill or account guarantee.
   The implementation must fail closed rather than switch models or routes.
9. **Risk:** Process-local caches and JSON metrics are insufficient to prevent
   repeated work after restart or across concurrent backend processes.
10. **Risk:** AI modules are interwoven with current API routes and usage
    reporting; broad deletion could break startup checks, health/usage
    responses, or IBM response composition.

## Proposed cleanup sequence (no deletion authorized by this report)

1. **First:** Complete official provider/model/free-tier verification and get
   user approval on which candidates are actually eligible.
2. **Then:** Approve architecture and storage/idempotency decisions before
   deleting active remote assessment code or changing API/report contracts.
3. **Qwen:** If retiring Qwen, remove its worker/model runtime and tests only
   after confirming all callers; first extract the `getNamingEvidence` helper
   currently imported by remote assessment. Recheck the Transformers.js
   dependency's exclusivity before removing it.
4. **Gemini/OpenRouter:** Replace callers and migrate health, usage, retry,
   rate-limit, and tests before removing current provider clients/configuration.
   Preserve useful usage metrics and diagnostics unless the approved design
   explicitly replaces them.
5. **Shared extraction and IBM:** Do not list the V2 extractor, adapter,
   context types, project HTML utility, IBM checker, `.achecker.yml`, IBM
   dependency, or IBM tests as obsolete AI code.
6. **Documentation:** Reconcile README and AI setup/Phase 4.1 historical
   claims after the new behavior is implemented; preserve `prompt.txt` as the
   authoritative migration specification.

## Audit completion and gate

**Observed completion:** The current request flow, AI/provider/Qwen inventory,
extraction scope, persistence, import evidence, IBM protected surfaces, docs
inconsistencies, and cleanup candidates have been recorded. No deletion,
implementation, package change, live test, or provider call was made.

**Next step:** Stop here for human review of this audit and the proposed cleanup
scope. Do not start provider verification (prompt 02) or destructive cleanup
until approved.
