# 03 — Architecture and Migration Design (Phase C)

## Objective

Design the migration from current single-selected-model assessments to the
verified six-model, two-provider target before removing or implementing code.

## Existing state and relevant files

Requires the approved audit and provider verification:
`docs/ai/REPOSITORY_AI_AUDIT.md` and
`docs/ai/SIX_MODEL_PROVIDER_VERIFICATION.md`.
Relevant existing surfaces include Phase 3 V2 extraction/adapters, the IBM
pipeline, current selected-model orchestration, AI configuration, and the
usage JSON ledger.

## Exact implementation tasks

Document:

1. Provider and model abstractions, model eligibility/status handling, secure
   env configuration, and direct APIs.
2. Assessment job/batch data shapes, snapshot/project identity, context/rule
   assignment, bounded input/output, and future React extraction integration.
3. Persistence choice grounded in audit findings; schema and lifecycle for
   batches, jobs, attempts, provider responses, validation, and token usage.
4. Deterministic idempotency composition and behavior for completed, in-flight,
   retryable, permanent, and uncertain outcomes. Different models must remain
   independent assessments.
5. Bounded scheduler, provider/model concurrency, rate limits, token-budget
   enforcement, backoff, `Retry-After`, fairness, cancellation, and partial
   failure handling.
6. Provider adapters and common validated assessment contract.
7. Report aggregation, disagreements, duplicate findings, confidence/
   insufficient-context behavior, and single consolidated fixing prompt.
8. IBM boundary and migration/rollback sequence. IBM remains authoritative and
   its behavior is not changed.
9. Operational privacy, retention, zero-cost enforcement, and observability.

Resolve tradeoffs using evidence; list unresolved questions instead of
inventing functionality. Use mockable interfaces and small independently
verifiable milestones.

## Constraints and things that must not change

- Design only; do not implement, delete, or change manifests/source.
- Keep IBM execution and findings isolated and unchanged.
- Reuse Phase 3 extraction; do not claim React project extraction exists.
- No OpenRouter fallback, paid route, billing, model substitution, live API
  call, or inference.
- Do not introduce a database unless the audit demonstrates the existing
  persistence cannot meet durable atomic idempotency requirements.

## Dependencies on previous steps

Requires human-approved 01 audit and 02 provider verification. Human approval
of this design is mandatory before 04 cleanup.

## Expected files and outputs

- Create `docs/ai/SIX_MODEL_ARCHITECTURE.md`.
- Include the architecture, data flow, contracts, persistence schema,
  idempotency, scheduler, failure policy, migration sequence, and explicit
  assumptions/decisions.

## Verification and testing requirements

- Cross-check provider capabilities against 02 and current constraints against
  01.
- Review every schema field against the required tracking in `prompt.txt`.
- Verify the design keeps IBM unchanged and makes no live calls.

## Completion criteria

The design covers all listed responsibilities and has a testable migration
sequence. Stop for explicit human approval of architecture and storage choice
before removing legacy code.

