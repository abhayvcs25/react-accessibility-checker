# 10 — Bounded Six-Model Assessment Scheduler

## Objective

Schedule verified model/component/rule jobs across both providers in parallel
with bounded, provider-aware execution and isolated failures.

## Existing state and relevant files

Use the approved job contract/architecture from 03, clients from 07–08, and
ledger from 09. Reuse Phase 3 context snapshots and adapters; current
single-model orchestration is not the target scheduler.

## Exact implementation tasks

1. Build bounded worker/batch scheduling for multiple projects, documents,
   components, rules, and all verified models.
2. Create only context-bounded jobs; do not broadcast whole websites to every
   model.
3. Enforce global, provider-specific, and model-specific concurrency and RPM/
   TPM constraints from verified config. Avoid unbounded `Promise.all()`.
4. Reserve and account for provider token budgets safely under concurrency.
5. Use ledger idempotency before dispatch; persist queued/running/complete/
   failed/uncertain transitions and every retry attempt.
6. Retry only transient failures, respect `Retry-After`, stop on permanent
   failures, and avoid blind resend after uncertain provider outcomes.
7. Isolate one model/provider failure so other eligible models continue.
8. Return partial outcomes with exact model/provider/job status and preserve
   available IBM results.

## Constraints and things that must not change

- Strict ₹0 and provider-verified free route only. Stop on quota; never route to
  paid service, substitute models, or evade provider limits.
- No unrestricted request fan-out or arbitrary queue growth.
- No live inference in local tests.
- IBM remains independent, authoritative, and unchanged.
- No React source extraction is implied by scheduling HTML context; keep a
  future extractor interface instead.

## Dependencies on previous steps

Requires 03, 06–09. The ledger contract and human review from 09 must be done
before dispatch implementation.

## Expected files and outputs

- Bounded scheduler/queue and provider/model limit configuration.
- Mocked scheduler, concurrency, retry, idempotency, and partial-failure tests.

## Verification and testing requirements

- Assert maximum active work never exceeds each configured bound.
- Test multi-batch fairness, rate-limit pacing, dedupe, model isolation,
  partial results, and ambiguous requests.
- Run backend tests/build and `git diff --check`; no provider calls.

## Completion criteria

All verified models can receive independent jobs in parallel within limits;
no duplicate job is dispatched, and a provider/model failure cannot erase other
results or IBM findings.

