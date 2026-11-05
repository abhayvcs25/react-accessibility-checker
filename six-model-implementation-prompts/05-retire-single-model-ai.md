# 05 — Retire the Legacy Single-Model AI Pipeline

## Objective

Remove the old Gemini/OpenRouter selected-model assessment pipeline after the
approved design and Qwen cleanup, without creating an AI outage in the IBM
checker.

## Existing state and relevant files

Audit leads include `backend/src/ai/config.ts`, `providerClient.ts`,
`rateLimiter.ts`, `usage.ts`, `testConnection.ts`, `benchmark.ts`,
`backend/src/services/remoteAssessment.ts`, `contextualAssessment.ts`,
`backend/src/routes/ai.ts`, startup wiring, tests, env examples, and
`docs/AI_PROVIDER_SETUP.md`. Reconfirm references; some usage, evidence, and
health interfaces may be reusable.

## Exact implementation tasks

1. Build an explicit removal/retention list from the audit and approved
   architecture.
2. Remove old Gemini/OpenRouter clients, selected-model orchestration,
   model-specific configuration/environment handling, and obsolete tests/docs
   only when they are not reused by the new design.
3. Retain or migrate provider-neutral usage telemetry, health API behavior,
   generic timeout/concurrency helpers, and context-related code only where
   appropriate; avoid two active assessment pipelines.
4. Update scripts and manifests/lockfile only for proven obsolete dependencies.
5. Keep the system in a coherent, type-checking transitional state for the next
   shared-config/provider-client step. Do not wire a fake fallback.

## Constraints and things that must not change

- IBM scan flow, rules, findings, counts, initialization and tests are
  protected.
- Preserve V2 extraction, adapters, project HTML context, shared evidence
  structures, and frontend IBM functionality.
- Do not make removal decisions without import/usage evidence.
- No live calls, paid inference, OpenRouter fallback, or secret inspection.

## Dependencies on previous steps

Requires completion of 04 and human approval of the architecture from 03.
Provider verification in 02 determines what may be retained or implemented.

## Expected files and outputs

- Only obsolete single-model AI implementation/test/config/docs and strictly
  exclusive dependencies.
- Update the relevant setup docs to state that provider migration is pending
  until the direct clients exist; do not claim the six-model system works yet.

## Verification and testing requirements

- Search for stale imports, environment variables, scripts, model IDs, and
  package references.
- Run backend tests/build and `git diff --check`.
- Verify IBM tests still pass and inspect IBM source diff to ensure it is
  unchanged.

## Completion criteria

The old selected-model pipeline no longer competes with the target design,
reusable shared infrastructure is intact, and the transitional repository
builds/tests. Stop if deletion would alter IBM or Phase 3 behavior.

