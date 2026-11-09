# 17 — Local End-to-End Mocked Acceptance

## Objective

Prove locally that a supported submitted file can flow through the unchanged
IBM checker and the contextual pipeline to a truthful combined report, using
mocked provider responses only.

## Preconditions

- Prompts 14–16 are complete and reviewed.
- No real API keys are required. Do not read `.env` values or enable live
  provider mode.

## Exact implementation tasks

1. Add or complete integration tests using a small, safe fixture in a
   currently supported input format.
2. Exercise request validation, existing IBM analysis, snapshot/context
   preparation, ledger/idempotency, scheduler orchestration, strict response
   validation, aggregation, fixing-prompt generation, and response rendering.
3. Use deterministic mocks for all six candidates. If production eligibility
   remains blocked, use isolated test fixtures or injected test doubles; do
   not alter production statuses or weaken eligibility.
4. Cover all-success, some-blocked, partial provider failure, malformed
   output, disagreement, duplicate submission, unchanged snapshot, and
   changed snapshot cases.
5. Assert IBM findings/counts/severity are unchanged in every scenario and
   AI failures never become negative findings.
6. Confirm no request can dispatch without explicit live opt-in and actual
   eligible catalog entries.

## Constraints

- No external network calls, real credentials, quota consumption, or paid
  inference.
- Do not modify the IBM checker to satisfy tests.
- Do not bypass production eligibility in a runtime path.
- Do not claim runtime verification based on mock results.

## Verification

- Run all backend tests and build.
- Run all relevant frontend tests, lint, and build.
- Run `git diff --check`.
- Inspect test transport mocks to prove provider endpoints cannot be reached.
- Report each of the six candidates as blocked, mock-tested, or runtime-tested;
  mock-tested is not runtime-tested.

## Completion gate

A fully mocked file-to-report test proves the expected behavior and the
separation of IBM and AI results. The application is still not approved for
live provider requests until the operator explicitly approves Prompt 18.
