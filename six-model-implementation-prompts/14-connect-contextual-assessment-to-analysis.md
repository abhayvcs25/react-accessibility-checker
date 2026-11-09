# 14 — Connect Contextual Assessment to Analysis

## Objective

Connect the existing contextual assessment preparation, batch ledger, bounded
scheduler, and validated results to the existing analysis request without
changing IBM Equal Access execution or findings.

## Preconditions

- Prompts 04–13 are complete and reviewed.
- Prompt 12 has defined the separate AI report contract and Prompt 13 has
  passed local verification.
- Re-read the current implementation; do not assume earlier prompt work is
  present or complete.

## Exact implementation tasks

1. Trace the existing submitted-file/HTML path through the analyze route,
   checker, report types, project/snapshot storage, evidence extraction, and
   scheduler. Reuse existing structures; do not invent a second source of
   truth.
2. After the existing IBM analysis runs, prepare bounded contextual jobs from
   the same submitted snapshot and the approved component/evidence data.
   Include exact dispatched evidence-reference IDs in each prepared job.
3. Invoke the scheduler only through an explicit, server-side contextual-AI
   opt-in. Preserve fail-closed eligibility, model/provider limits, usage
   reservations, idempotency, job tracking, and validation.
4. Return every candidate's actual state (for example: blocked, not run,
   succeeded, invalid response, or failed) without treating an absent result
   as a negative finding. Do not claim that all six ran unless all six actually
   returned validated results.
5. Keep AI execution optional and isolated: missing credentials, ineligible
   models, quota exhaustion, or scheduler errors must not suppress, alter, or
   delay the authoritative IBM result beyond the agreed request behavior.
6. Do not store raw source content in logs, job errors, or unbounded report
   fields. Persist only the existing bounded job/result data.

## Constraints

- Do not change IBM checker logic, response values, severity, counts, or its
  execution dependency.
- Do not call providers during implementation or tests.
- Do not enable or mark any model verified to force dispatch.
- Do not add paid fallback, model substitution, automatic source edits, or
  startup recovery.
- Do not expose credentials in frontend code, report data, logs, or errors.

## Tests and verification

- Mock the scheduler and prove IBM output remains value-equivalent when AI is
  disabled, blocked, successful, partially failed, or throws.
- Prove exact snapshot, target, rule, and sent-evidence identity is preserved.
- Prove duplicate submissions use existing idempotency and do not duplicate
  provider work.
- Prove model failures are isolated and reported as failures, not
  `no_issue_detected`.
- Run focused backend tests, backend build, and `git diff --check`.

## Completion gate

The normal server request path can produce a truthful separate AI outcome
alongside the unchanged IBM result, while remaining safe with the current
blocked catalog. No live provider request is made in this prompt.
