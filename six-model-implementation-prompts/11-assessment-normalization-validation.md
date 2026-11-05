# 11 — Assessment Normalization and Strict Validation (Phase G)

## Objective

Normalize provider responses into one compact contract and reject every
malformed, incomplete, ungrounded, oversized, or invalid assessment.

## Existing state and relevant files

Use the provider verification matrix, provider transport adapters, and job/
context schema. Reuse Phase 3 evidence references and target/rule types where
compatible; inspect all exact model response shapes from official docs.

## Exact implementation tasks

1. Define the shared statuses `potential_issue`, `no_issue_detected`, and
   `insufficient_context`, plus rule, target, concise explanation, evidence
   references, and confidence only when meaningful/supported.
2. Validate JSON syntax, required and unknown fields per contract, allowed
   statuses, known rule IDs, target IDs in the dispatched job, evidence refs
   against exactly the sent context, output size, and complete finish status.
3. Keep malformed, schema-invalid, semantic-invalid, incomplete/truncated,
   unsupported, quota, and transport-failure outcomes distinguishable.
4. Implement provider/model-specific response and finish-reason parsing based
   on verified docs.
5. Never convert invalid, empty, unsupported, or failed output into
   `no_issue_detected`.
6. Persist validation state and safe error classification to the job ledger;
   avoid logging keys or sensitive user content.

## Constraints and things that must not change

- Never weaken validation to accommodate model behavior.
- No model response is trusted solely because provider JSON mode/schema was
  requested.
- No live inference or provider API call.
- Preserve the approved common contract and IBM finding separation.

## Dependencies on previous steps

Requires 02, 06–10. This follows transport and scheduler implementation but
precedes report aggregation.

## Expected files and outputs

- Shared runtime validators and provider-specific completion parsers.
- Unit tests covering valid outputs, each failure category, invalid IDs/evidence,
  too-large output, and truncation/finish reasons.

## Verification and testing requirements

- Use fixtures based on documented response shapes, without secrets or real
  user content.
- Fuzz/edge test required fields, enums, IDs, unexpected values, and limits.
- Run focused tests, backend build, and `git diff --check`.

## Completion criteria

Only complete, strictly validated responses enter the success path. Every
invalid or incomplete response remains distinguishable and never becomes a
negative accessibility conclusion.

