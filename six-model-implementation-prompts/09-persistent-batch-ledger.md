# 09 — Persistent Batch Ledger and Idempotency

## Objective

Add durable batch/job/attempt tracking that prevents duplicate execution of
the same model/component/rule/snapshot assessment.

## Existing state and relevant files

Use the persistence findings in 01 and storage choice in 03. The current
`backend/src/ai/usage.ts` ledger is a JSON usage report; do not assume it
provides transactions, atomic uniqueness, cross-process locks, or assessment
result reuse.

## Exact implementation tasks

1. Implement the approved storage schema for project/snapshot, batch, job,
   provider/model, component, included rules, context/evidence hash,
   prompt/schema version, status, attempt, provider request ID, timestamps,
   response/result reference, validation result, token counts, and error class.
2. Derive a deterministic idempotency key from project snapshot, model,
   component, rules, context, and prompt/schema version.
3. Enforce uniqueness atomically using the approved persistence mechanism.
4. Reuse valid completed results; join/reuse in-flight work; retry only
   eligible retryable failures; preserve permanent and uncertain outcomes.
5. Ensure model is part of the idempotency key so different models may
   intentionally assess the same component.
6. Define retention/privacy limits and avoid persisting unnecessary raw HTML,
   credentials, or sensitive provider response content.
7. Migrate or coexist with the usage ledger only as the architecture specifies;
   never erase existing user data or usage history.

## Constraints and things that must not change

- Do not create a second store without evidence and approval from 03.
- Do not make non-atomic in-memory dedupe the only persistent guarantee.
- No live requests, paid usage, automatic retries after uncertain outcomes,
  secrets, or IBM changes.
- Keep schema versioning and error handling explicit; no silent ledger reset.

## Dependencies on previous steps

Requires 03 architecture approval and shared types in 06 plus both provider
clients (07–08) to identify request metadata needs. Must precede scheduler 10.
Human review of schema/idempotency is required before proceeding to 10.

## Expected files and outputs

- Persistent batch/job/attempt implementation using the approved store.
- Migration/versioning logic only if required and safe.
- Unit/integration tests for uniqueness, restart persistence, state transitions,
  model-distinct keys, retries, and uncertain outcomes.

## Verification and testing requirements

- Use temporary isolated storage in tests; do not touch the user's ledger.
- Test repeated identical submissions, changed snapshot/version, and identical
  component under distinct models.
- Test concurrent creation and process-restart recovery where supported.
- Run focused tests, backend build, and `git diff --check`.

## Completion criteria

Repeated identical work is prevented by durable idempotency, independent model
jobs remain possible, every attempt/state is auditable, and no existing user
records are lost.

