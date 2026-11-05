# 13 — Local Verification and Tomorrow's Test Plan

## Objective

Complete local-only verification, prove IBM remains unaffected, and prepare
tomorrow's live test sequence without consuming provider quota today.

## Existing state and relevant files

Requires completion of prompts 04–12. Use backend/frontend scripts and test
commands discovered from current manifests. The original source specification
lists twelve live scenarios; all must be preserved in the future test plan.

## Exact implementation tasks

1. Run existing backend unit tests and build; run frontend lint/build if
   frontend code changed.
2. Run focused mocked tests for all new provider adapters, validation,
   scheduler, ledger/idempotency, aggregation, and prompt generation.
3. Run `git diff --check`; review changed/deleted files against the approved
   audit and architecture.
4. Verify no key, secret, billing route, paid fallback, dynamic router, or
   unverified model substitution was added.
5. Inspect IBM source and tests; run the existing IBM-related tests and verify
   its path remains independent of AI availability.
6. Create `docs/ai/SIX_MODEL_TEST_PLAN.md` containing tomorrow's ordered
   sequence:
   - Individual provider connection tests.
   - One small assessment per model.
   - JSON completion and validation tests.
   - Output token limit tests.
   - Parallel execution test.
   - Batch tracking test.
   - Duplicate request prevention test.
   - Rate-limit and retry test.
   - Partial provider failure test.
   - Repeated analysis with unchanged project snapshot.
   - Changed project snapshot.
   - Full 10–20-page project simulation only when React extraction exists.
7. For every live step, specify explicit opt-in, free-tier/account preflight,
   small bounded request counts, expected cost of ₹0, abort conditions,
   redaction, cleanup, and what evidence constitutes success. No billing or
   fallback is permitted. Make unavailable models block only themselves.

## Constraints and things that must not change

- No live API request, inference, quota consumption, or claim of runtime
  success today.
- Do not alter IBM logic to make tests pass.
- Do not modify or delete `prompt.txt`, secrets, user data, or unrelated files.
- Do not expand scope beyond verification and the future test-plan document.

## Dependencies on previous steps

Requires all implementation prompts 04–12 and their review checkpoints.
Human approval is required before executing any live step in the prepared test
plan.

## Expected files and outputs

- `docs/ai/SIX_MODEL_TEST_PLAN.md`.
- Test/build/lint results and a precise changed-file summary.
- Explicit list of candidates that remain unavailable or only partially
  verified.

## Verification and testing requirements

- Run backend tests/build, frontend lint/build when applicable, and
  `git diff --check`.
- Verify tests use mocks and no provider API call was made.
- Compare IBM report behavior against existing tests; report any untested area.
- Confirm plan contains all twelve required scenarios in the specified order.

## Completion criteria

All local checks pass or have clearly explained failures; IBM behavior is
preserved; the tomorrow plan is bounded, free-only, and complete. State clearly
that live model behavior remains unverified. Obtain separate human approval
before running any live tests.

