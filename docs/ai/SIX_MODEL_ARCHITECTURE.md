# Six-Model AI Assessment Architecture

**Design date:** 2026-11-04
**Status:** Architecture and recommended SQLite direction approved by the
human on 2026-11-05; implementation gates remain
**Inputs:** [Repository audit](./REPOSITORY_AI_AUDIT.md), [provider verification](./SIX_MODEL_PROVIDER_VERIFICATION.md), and the unchanged root `prompt.txt`

## Executive decision

Replace the active single-selected-model assessment path with a persistent,
bounded job system behind two direct provider adapters. Keep IBM Equal Access
independent and authoritative; keep model assessments advisory and separate.
Reuse the current V2 HTML extraction and evidence types. The system should be
able to schedule six model assessments concurrently, but model eligibility is
per-model and fail-closed.

**Do not enable any candidate yet.** The operator reports Groq Free account
access to all three listed models without a payment method, purchased credits,
or auto-recharge, and a Workers Free account with a shared 10,000-Neuron daily
allocation. These are account-level findings, not runtime verification.
Groq's public strict-schema documentation is internally inconsistent for
Qwen; the operator's review provisionally accepts its supported-model listing
for implementation testing. Cloudflare's exact-model JSON/JSON Schema
compatibility and the accessibility result schema remain untested. All six
models remain blocked and operator-disabled pending the remaining verification
gates. No live requests are claimed here.

The approved durable batch/job store is a local SQLite database using Node.js
24.11.0+ built-in `node:sqlite` (`DatabaseSync`). It coexists with the existing
JSON usage ledger: Prompt 09 does not import, replace, modify, or delete that
file. The JSON ledger continues to serve the legacy usage endpoint separately.

## Evidence-based current state

| Area | Observed now | Design target |
|---|---|---|
| IBM | `checker.ts` runs IBM Equal Access and returns its findings/counts. Tests protect those results when contextual analysis fails. | Keep the IBM pipeline, output shape, rules, severity, and counts unchanged. |
| Extraction | The production route accepts one HTML file and uses V2 extraction/adaptation. A separate utility accepts caller-supplied HTML documents. | Reuse current extraction. Add a future source adapter for React projects/URLs; do not claim it exists now. |
| AI execution | Production uses one selected Gemini/OpenRouter model. The six-entry benchmark is serial and is not the target scheduler. | Independently configured Groq and Cloudflare model adapters, scheduled as bounded jobs. |
| Rules | Three contextual rules are active. Twenty rule definitions are proposed, not implemented as a complete assessment set. | Keep a versioned rule registry; only schedule rules with reviewed definitions and available evidence. |
| Persistence | `backend/src/ai/usage.ts` stores historical metrics in a JSON file. Prompt 09 adds a separate SQLite batch/job ledger; no usage migration is performed. | Keep job idempotency and attempts in SQLite; preserve the JSON usage endpoint unchanged unless a separately approved migration is undertaken. |
| Verification | Provider documentation and operator-reported account evidence are recorded in the verification report. No candidate has runtime verification. | Require fail-closed eligibility and separate documentation, account, and runtime evidence. Local tests use mocks only. |

## 1. Request flow and protected boundary

1. **Intake and snapshot:** Accept the currently supported HTML input. Produce a
   canonical extraction snapshot with a content hash and extractor/rule
   versions. Future React-project or website intake must use a separate
   source-adapter phase and produce the same snapshot contract.
2. **Independent analysis branches:** Preserve the existing IBM path. Its
   output continues to populate the existing IBM `summary` and `issues`.
   Contextual AI consumes extracted context in a separate branch and writes to
   a distinct AI report. AI setup, queueing, provider failures, and persistence
   failures must not block or alter IBM results.
3. **Preflight:** Resolve eligible models, reviewed rules, component targets,
   expected job count, per-request token bounds, and provider pacing. Record a
   batch even when some candidates are blocked, so the report can distinguish
   skipped work from a successful negative assessment.
4. **Job scheduling:** Create one independently idempotent job for each
   model-target-rule assignment. This keeps validation and retries scoped to a
   single rule. The planned request count is:
   `eligible targets × eligible rules × enabled models`.
5. **Provider call:** A provider-specific adapter builds the exact request,
   records an attempt before network I/O, enforces its own timeout/rate limit,
   and returns normalized transport metadata plus the provider response.
6. **Validation and persistence:** Validate completion, JSON, schema, rule and
   target identity, and evidence references. Persist the provider response,
   normalized result or classified failure, and token accounting before
   considering the job complete.
7. **Aggregation and report:** Aggregate only validated AI assessments while
   preserving each model's provenance and failures. Show IBM and AI results in
   distinct sections and generate one advisory fixing prompt from the stored
   report; never modify project source automatically.

No automatic startup inference or six-model health sweep is part of this flow.
Health status should report configuration/readiness and the last explicitly
performed connection check. A future user-triggered check must name one
provider/model, require an eligible account, be counted as an attempt, and be
clearly distinguished from an assessment.

## 2. Providers, model registry, and eligibility

Use two server-only clients:

- **Groq:** OpenAI-compatible Chat Completions endpoint. Read
  `GROQ_API_KEY` from the backend environment.
- **Cloudflare Workers AI:** account-scoped REST or documented
  OpenAI-compatible endpoint, chosen per exact model and verified capabilities.
  Read `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the backend
  environment.

Never return credentials in API responses, logs, health details, request
records, or fixing prompts. Provider clients must not fall through to another
provider or model. Missing credentials or unknown plan eligibility disables
only the affected provider/model and produces an explicit readiness state.

Keep a catalog entry per exact model ID. Besides provider and model ID, store
the verified context/output limits, request/response adapter version,
structured-output capability, account-confirmed rate limits, free-eligibility
evidence/date, operator enablement, and current pause/block reason. Suggested
states are `eligible`, `disabled_by_operator`, `blocked_unverified`,
`quota_paused`, and `unavailable`. Public documentation and account
verification must be distinguishable in the record.

| Candidate | Current evidence | Initial eligibility |
|---|---|---|
| `openai/gpt-oss-120b` | Operator reports Free-plan access, exact model allowed, no payment method/credits/auto-recharge, and account limits; runtime compatibility remains untested. | `blocked_unverified` until implementation and runtime checks are approved. |
| `openai/gpt-oss-20b` | Same operator-reported Free-plan and organization-limit evidence; runtime compatibility remains untested. | `blocked_unverified` until implementation and runtime checks are approved. |
| `qwen/qwen3.8-27b` | Same account evidence. Operator provisionally accepts strict and best-effort support for implementation testing; Groq's public strict-support documentation remains contradictory. | `blocked_unverified` until the documentation conflict/runtime check and implementation gates are resolved. |
| `@cf/zai-org/glm-4.7-flash` | Operator reports Workers Free, no paid billing route, and the shared 10,000-Neuron daily allocation. Exact-model JSON Schema behavior remains untested; output max is operator-reported as 4,096. | `blocked_unverified` until exact schema compatibility and implementation gates are verified. |
| `@cf/nvidia/nemotron-3-120b-a12b` | Same operator-reported Workers Free evidence; exact-model JSON Schema behavior remains untested; output max is operator-reported as 16,384. | `blocked_unverified` until exact schema compatibility and implementation gates are verified. |
| `@cf/google/gemma-4-26b-a4b-it` | Same operator-reported Workers Free evidence; exact-model JSON Schema behavior remains untested; output max is operator-reported as 8,192. | `blocked_unverified` until exact schema compatibility and implementation gates are verified. |

The Cloudflare free allocation is shared across the account, not six separate
model quotas. The Groq Developer-plan rate table is not evidence of free-tier
entitlement. Do not activate a candidate based only on the presence of a key.
Recheck official documentation and account dashboards before each implementation
gate; changes to eligibility require explicit operator configuration, never
automatic substitution.

**Prompt 06 configuration state:** `backend/src/ai/config.ts` records the six
official candidate IDs as metadata only. Every candidate is
`blocked_unverified`, operator-disabled, and excluded from
`getEligibleModels()` because none has complete documentation, account, and
runtime evidence for the configured strict structured-output requirement.
Groq account eligibility and per-model limits are operator-reported; its Qwen
strict capability remains provisional because of the public documentation
conflict. Cloudflare account eligibility is operator-reported within the
shared daily free allocation. Its reported output maxima are 4,096 (GLM),
16,384 (Nemotron), and 8,192 (Gemma), with a 2,048-token application cap;
maximum input remains unknown. Exact-model Cloudflare JSON/JSON Schema
behavior remains provisional. Per-model Cloudflare request/token limits remain
unset. Published provider limits are scoped separately from account
entitlements. Application concurrency safeguards are 1 per model, 3 per
provider, and 6 total. The provider adapters are implemented but isolated;
there is no live check or assessment-pipeline integration.

## 3. Snapshot, batch, and assessment job contracts

The current HTML route does not provide a stable project identity. Introduce
opaque server-generated project and snapshot IDs in a future API change; do not
persist a complete uploaded source tree merely to establish identity. A
snapshot should include a canonical content hash, source kind, extraction
version, rule-registry version, and creation time. The future React adapter
must supply the same contract and stable target identifiers.

Conceptual batch fields:

```text
batch_id, project_id, snapshot_id, status, created_at, completed_at,
rule_registry_version, prompt_version, schema_version,
planned_job_count, terminal_job_count
```

Conceptual job fields:

```text
job_id, batch_id, idempotency_key, provider_id, model_id,
target_id, rule_id, context_hash, evidence_ref_ids, request_payload_hash,
prompt_version, schema_version, status, created_at, started_at, completed_at
```

Each job evaluates one model, one target, and one rule. Its result has
`rule_id`, `target_id`, one allowed assessment status, a short explanation,
evidence references, optional model-reported confidence, and the producing
provider/model. This intentionally yields more small requests than a multi-rule
bundle; the preflight count and queue limits must make that volume visible
before execution. Rule assignment must not invent checks: initially it is
limited to active, reviewed rules and their available evidence.

## 4. Persistence and schema

### Recommendation

Use local SQLite as the durable source of truth for AI batches, jobs, attempts,
and normalized assessment results. The selected implementation is Node.js
built-in `node:sqlite` (`DatabaseSync`), with Node.js 24.11.0 or later and no
additional SQLite package. SQLite unique constraints and transactions provide
atomic idempotency across connections. The existing JSON usage ledger remains
an independent historical metrics store; it is not migrated or replaced by
Prompt 09.

### Logical tables

| Table | Essential fields and constraints |
|---|---|
| `projects` | Opaque `project_id` primary key, source kind, optional user label, creation/update timestamps. Avoid storing URL query strings or unrelated source data. |
| `snapshots` | `snapshot_id`, `project_id`, canonical content hash, extraction version, rule-registry version, created time; unique project/content/config tuple. |
| `batches` | `batch_id`, project/snapshot foreign keys, prompt/schema versions, state, planned and terminal counts, timestamps. |
| `jobs` | `job_id`, batch foreign key, unique deterministic `idempotency_key`, provider/model, target/rule, context hash, evidence-reference IDs, request-payload hash, state, timestamps, normalized result reference. |
| `attempts` | `attempt_id`, job foreign key, unique `(job_id, attempt_number)`, request/response timestamps, provider request ID, HTTP/finish metadata, retry-after, error class, estimated and provider-reported token counts, response validation state, owner process/host/instance, renewable lease, optional short-lived raw-response reference. |
| `assessment_results` | `result_id`, unique successful `attempt_id`, job foreign key, normalized validated assessment fields or schema-versioned JSON, validation timestamp, creation time. The job's result reference points to this row; invalid or incomplete attempts have no result row. |
| `analysis_durations` | Batch or analysis reference and elapsed duration. Preserve the existing usage API's duration reporting without counting it as a provider request. |

Usage summaries should be derived from attempts, not independently incremented
counters that can drift. Token fields must distinguish estimates from provider
usage and allow `null` when the provider did not report a value; unknown usage
must never be represented as zero. By default, persist hashes of the canonical
request and context plus evidence-reference IDs, not raw request bodies or
duplicated source content. Persist normalized structured assessment responses.
Commit a successful attempt's validated `assessment_results` row and the job's
terminal state/result reference in one transaction. Preserve validation and
error metadata on unsuccessful attempts without converting them into result
rows; raw response bodies remain optional, short-lived, and disabled by default.
Do not store API keys. Raw provider response retention is disabled.

The ledger accepts only its explicitly supported assessment result schema
version. Before success persistence it checks the required result fields,
target/rule/provider/model identity, and that every evidence reference belongs
to the job's permitted evidence set. Unsupported schema versions or invalid
results leave the attempt and job in progress for explicit failure handling;
they are not stored as successful results.

Terminal job, attempt, and normalized-result rows are retained for seven days
from job completion, configurable with `USAGE_LEDGER_RETENTION_DAYS` (default
`7`). Cleanup runs when the ledger opens and when its cleanup method is
explicitly called. It deletes expired terminal jobs and their attempts/results;
queued and in-progress jobs are excluded. Batches, snapshots, and projects are
not removed by automatic retention cleanup and remain until project deletion.
Raw provider response bodies remain disabled. The existing JSON usage ledger
at `RAC_AI_USAGE_FILE`/`ai-usage.json` is preserved without import,
modification, or deletion and continues serving `/api/ai/usage` unchanged.
Any future consolidation requires a separate approved migration.

Attempt ownership is recorded with process ID, host, per-ledger instance ID,
and a renewable lease. Explicit recovery uses an atomic SQLite write
transaction and only classifies an attempt as uncertain when its lease has
expired and its owner process is confirmed absent on the same host. Unknown
host/owner cases are left untouched. Recovery is not invoked at startup and is
not integrated with a scheduler. Legacy in-progress attempts without ownership
metadata are not automatically recovered.
The version-1-to-version-2 migration preserves existing records and leaves
legacy in-progress attempts without ownership metadata for explicit operator
resolution rather than guessing that their processes are dead.

SQLite transactions should reserve a job idempotency key before enqueueing,
append each attempt before network I/O, and commit its terminal state and
validated result atomically. Use foreign keys and indexes for project/snapshot,
batch status, job idempotency, provider/model, and attempt time. A process-local
queue is not a substitute for the database uniqueness constraint.

### Privacy, retention, and deletion

Exact evidence and responses may contain user source content. Store context
hashes and evidence-reference IDs rather than duplicating full source content
wherever possible; do not retain raw assessment requests by default. Keep
normalized structured assessment responses and necessary terminal job/attempt
metadata for seven days from job completion, configurable with
`USAGE_LEDGER_RETENTION_DAYS` (default `7`); then automatically delete expired
terminal job records and their attempts/results. Active jobs are not removed
by retention cleanup. Batches, snapshots, and projects remain until explicit
project deletion. Cleanup runs on ledger open or an explicit cleanup call.
Project-level deletion must also cascade immediately.
Raw provider response retention is disabled. Do not log raw context or
responses. Restrict the database to the local application user and verify
Windows file permissions in implementation rather than assuming Unix file-mode
behavior.

## 5. Deterministic idempotency and job state

Compute a versioned SHA-256 key from canonical serialization of:

```text
project_id
snapshot_content_hash + extraction_version
provider_id + exact_model_id
target_id + sorted rule_id set (one rule in the initial job contract)
context_hash + canonical evidence-reference IDs
request_payload_hash
prompt_version + schema_version
model request configuration that changes assessment semantics
```

Including the provider/model ensures that two different models assessing the
same target and rule remain independent jobs. A context, snapshot, prompt,
schema, rule-set, or material model-configuration change creates a new key.
Do not include API keys, timestamps, attempt numbers, or mutable display text.

Job states and deduplication behavior:

| State | Behavior for a repeat request |
|---|---|
| `queued` / `in_progress` | Reuse the existing job and report its current state; do not enqueue a duplicate. |
| `succeeded` with valid result | Return the stored result for the exact key. |
| `invalid_response` | Preserve the failure; do not reinterpret as no issue. A deliberate retry creates a recorded attempt under the same job. |
| `retryable_failed` | Retry only under the provider-specific policy and bounded attempt limit. |
| `permanent_failed` / `blocked` | Preserve the reason; no automatic retry or model substitution. |
| `unknown_outcome` | Do not automatically resend. Require provider reconciliation if available or an explicit operator retry acknowledging possible duplicate provider processing. |

Persist `in_progress` before sending. Recovery is an explicit operation, not a
startup action. It may mark a job `unknown_outcome` only after its lease has
expired and the recorded owner process is confirmed absent on the same host;
recovery claims are serialized in a SQLite write transaction. Live, unknown-
host, or ownerless legacy work is left untouched. A stale attempt cannot
complete after recovery or after a replacement attempt starts. Neither
provider is assumed to support an idempotency token until its official API
documents one.

## 6. Bounded scheduler, rate control, and retry policy

Use a persistent queue with a fixed number of async workers, not an unbounded
`Promise.all`. Proposed initial application limits are **one active request
per model**, **three active requests per provider**, and **six total**. This
allows one request to each candidate at once while bounding resources. These
are conservative application settings, not claims about provider concurrency
allowances; lower them to match account-visible limits or observed capacity.
Raise them only after approved testing. Schedule fairly across batches so one
large project cannot monopolize all workers. Cancellation stops new dispatches
and marks unfinished work accurately; it does not erase attempts.

Rate-limit settings come from the provider account dashboard where available,
then are enforced separately per provider/model using a rolling window and
provider response headers. Public Groq Developer-plan limits are not copied as
free-tier defaults. Cloudflare's documented 300 RPM text-generation limit is
not a per-model concurrency guarantee and does not supersede the shared daily
free allocation.

Strict ₹0 policy:

- Enable Groq only after the account confirms exact-model no-purchase access
  and actual limits. If that cannot be confirmed, keep all Groq candidates
  blocked.
- Enable Cloudflare only after confirming the account is Workers Free and is
  not configured to continue through billable Workers Paid usage. The public
  free allocation is 10,000 Neurons/day across the account. Estimate and report
  Neuron use from per-model token rates where possible, but distinguish this
  local estimate from provider-reported quota exhaustion; do not invent a
  local “provider budget exhausted” error.
- On Cloudflare HTTP 429/code 3036, pause all Cloudflare jobs until the provider
  allocation resets. On HTTP 403/code 5035, block the model because Workers
  Paid is required. Never upgrade, switch to paid credits, or route around the
  response. Capacity code 3040 is a transient failure, not a free-quota
  exhaustion signal.
- For Groq, parse 429 headers/body and `Retry-After` to distinguish a temporary
  rate limit from a daily/account quota. Stop or pause only the affected scope
  indicated by the provider. A missing or ambiguous quota reason is surfaced
  as provider-limited/unknown, not as a fabricated local daily exhaustion.
- Keep preflight token estimation for context/output bounds and work-volume
  visibility. It is not a substitute for provider accounting or an arbitrary
  daily request gate. Record actual provider usage when supplied; otherwise
  record estimates and unknowns distinctly.

Record one attempt for every HTTP request, including retries, with estimated
input/output tokens, reported input/output tokens when present, response ID,
latency, HTTP status, finish reason, retry delay, validation result, and error
classification. An error before network dispatch is a job error, not an HTTP
attempt. Never silently assign zero tokens to a failed response with missing
usage.

Retry only known transient conditions. Respect `Retry-After` when supplied;
otherwise use bounded exponential backoff with jitter and a configurable
maximum attempt count. Do not retry authentication/permission errors, unknown
models, unsupported output parameters, daily free-quota exhaustion, schema or
semantic validation failures, or other permanent errors automatically. A
timeout/disconnect after dispatch with no definitive provider response is
`unknown_outcome`, not an automatic retry. Persist every attempt before
deciding whether to schedule another.

## 7. Provider adapters and common assessment validation

Adapters must own endpoint/request details, authentication, timeout/abort,
response extraction, usage-field parsing, finish-reason interpretation,
provider request ID, error classification, rate-limit headers, and
`Retry-After`. No provider response shape leaks into the common report.

Require model-specific configuration for JSON/JSON Schema output. Groq's
documented strict schema support may be used for the listed models after the
exact request shape is tested with mocks. Cloudflare candidates stay blocked
until their exact model/endpoint output behavior is verified; do not infer
support from provider-wide JSON Mode documentation. Regardless of provider
constraints, server-side validation is mandatory.

Common validated assessment:

```json
{
  "targetId": "target-id",
  "ruleId": "RULE-ID",
  "status": "potential_issue",
  "explanation": "Short, evidence-grounded explanation.",
  "evidenceRefs": ["evidence-id"],
  "confidence": null,
  "providerId": "provider-id",
  "modelId": "exact-model-id"
}
```

`status` is exactly one of `potential_issue`, `no_issue_detected`, or
`insufficient_context`. Confidence is optional and must be shown as
model-reported, not a calibrated probability. Persist `failed`,
`invalid_response`, `incomplete`, `unsupported`, and `unknown_outcome` as job
states rather than converting any of them to `no_issue_detected`.

Validate JSON syntax, required fields and types, allowed status, target/rule
identity, evidence references against the exact context sent, response-size
limits, and finish reason. Treat truncation/length finish reasons and empty
candidate lists as incomplete. Do not accept extra or fabricated evidence.
Keep raw parser diagnostics redacted and bounded; do not log source content,
credentials, or full provider payloads.

## 8. Aggregation, disagreements, and fixing prompt

Group assessments by `(snapshot_id, target_id, rule_id)`. Preserve each
validated model result and its provider/model/attempt provenance. Report
agreement as a transparent count (for example, `3 of 5 eligible assessments
flagged an issue`), not as a statistically calibrated confidence score.

- `no_issue_detected` is not a finding and never cancels an IBM issue.
- Preserve disagreements explicitly: an issue/no-issue split is not silently
  resolved by majority vote. Show each model's status, evidence, and
  explanation.
- Keep `insufficient_context`, failed, blocked, and not-run states distinct.
  A model that did not return a valid result is not a negative assessment.
- Deduplicate AI findings only when snapshot, target, rule, and normalized
  issue/evidence identity match. Preserve the individual model assessments
  behind the grouped display. Do not fuzzy-merge distinct evidence or issues
  automatically.
- Keep IBM findings in the existing IBM section. If a contextual assessment
  appears related to an IBM finding, cross-reference it without merging,
  removing, or changing either result.

The single fixing prompt should include actionable validated AI findings,
affected targets, exact evidence references/snippets, rule IDs, model
agreement/disagreement, and any relevant IBM issue references in a separate
section. It must state unresolved/partial assessments and must not imply that
all six models ran when any were blocked or failed. The prompt is advisory;
the user's external coding model performs any edits. This application does not
modify source code.

## 9. Report/API and operational observability

Preserve the current `summary` and `issues` fields and the IBM report contract.
Add AI batch/report fields or a separate batch-status endpoint rather than
mixing model output into IBM issue counts. The report should expose project,
snapshot and batch IDs; per-model eligibility and execution state; per-job
rule/target; attempts and errors; validation state; provider request IDs when
available; and token usage with its source. Do not expose prompt secrets or
credentials.

Health should distinguish configuration validity, account-eligibility
verification state, provider reachability from an explicitly run check, and
the last known provider/quota state. Startup must not perform model inference.
Usage summaries should be derived per provider/model and identify reported
versus estimated input/output tokens, retry attempts, and unknown usage. Do not
report estimated cost as zero when the provider charge is unknown; disclose
that the account's plan and billing settings determine actual cost.

## 10. Migration, rollback, and verification sequence

1. **Approval gate:** Approve this architecture, storage choice, retention
   policy, and model eligibility policy before cleanup.
2. **Preserve contracts:** Add contract tests and isolate shared context/
   evidence utilities. The Phase 04 local-Qwen retirement moved
   `getNamingEvidence` into `backend/src/services/assessmentEvidence.ts`;
   keep this shared helper independent of provider-specific assessment code.
3. **Storage:** Prompt 09 implemented the SQLite batch/job ledger alongside the
   existing JSON metrics file. No JSON import, migration, modification, or
   deletion is part of the approved scope; the legacy usage API remains
   unchanged.
4. **Provider adapters:** Add mocked Groq and Cloudflare adapter tests for
   request shape, schema support gating, usage, finish reasons, errors,
   `Retry-After`, and secret-safe diagnostics. No live inference.
5. **Scheduler and validation:** A future scheduler phase may add bounded
   concurrency, partial failures, and provider integration. Prompt 09.1 adds
   ownership-safe explicit recovery and trusted result validation, but neither
   startup recovery nor scheduler integration is enabled.
6. **Report integration:** Add AI aggregation and the fixing-prompt output
   separately from IBM. Run existing IBM tests unchanged.
7. **Retire legacy AI:** Prompts 04–05 retired the local Qwen and selected
   Gemini/OpenRouter execution paths before replacement clients were ready.
   Contextual assessments are explicitly disabled during this transition;
   IBM remains active. The JSON usage ledger and read-only usage endpoint are
   retained separately from the SQLite batch/job ledger. Preserve shared
   extraction/types and IBM code.
8. **Rollback:** Keep each phase in a reversible change set and preserve the
   existing usage JSON. A runtime rollback may disable AI
   while IBM continues; it must not silently fall back to a paid, unverified,
   or retired model.
9. **Local verification:** Use mocked provider tests, persistence/restart/
   duplicate/concurrency/failure tests, backend tests/build, IBM regression
   tests, frontend checks only if frontend code changes, and `git diff --check`.
   Prohibit provider HTTP traffic in local test runs.
10. **Future live-test gate:** Create a separate test plan and obtain explicit
    approval before any account connection test or inference. No live check
    was run for this design.

The originally recommended migration sequence delayed final removal of active
remote AI until replacement callers were ready. The human-approved prompt
sequence instead retired legacy providers in prompts 04–05; contextual AI is
explicitly disabled until replacement clients are implemented. IBM remains
available and unchanged.

## 11. Unresolved decisions requiring approval

1. **Provider eligibility:** Account evidence is operator-reported; runtime
   compatibility and exact schema behavior remain unverified. Keep all models
   blocked until the remaining evidence and implementation gates are satisfied.
2. **Recovery operations:** Recovery remains an explicit operation and is not
   called at startup. A future scheduler must coordinate lease renewal and
   ensure it only requests recovery when appropriate.
3. **Retention:** Terminal jobs, attempts, and results use seven-day retention.
   Batches, snapshots, and projects are intentionally excluded from automatic
   cleanup and are removed by explicit project deletion.
4. **Rule scope:** Review the three active rules against the 20 proposed rules
   before expanding the registry. The 20-rule set is not complete active
   functionality today.
5. **Migration order — resolved:** The human approved the prompt 04–05
   sequence. Legacy AI is retired and contextual assessments remain disabled
   until direct provider clients are implemented; IBM remains active.
6. **Confidence and UI:** Approve presenting model-reported confidence as
   uncalibrated metadata and showing disagreements as model-by-model evidence,
   not a majority-vote verdict.

## Completion status

This document records the design-only state as of 2026-11-04; no application
source, tests, manifests, provider settings, or `prompt.txt` were changed during
that design pass. The human subsequently approved the architecture and
approved prompts 04–05 retired the local Qwen and legacy selected-model
execution paths while preserving shared evidence extraction, IBM, and
historical usage reporting. Prompt 09 uses built-in SQLite and retains the
separate JSON usage ledger. Provider eligibility and runtime verification
remain incomplete. No provider API call, live connection check, or inference
was performed.
