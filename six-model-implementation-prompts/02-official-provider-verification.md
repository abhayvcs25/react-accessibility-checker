# 02 — Official Provider and Model Verification (Phase B)

## Objective

Verify the six requested candidates and provider capabilities from current
first-party documentation before approving any integration.

## Existing state and relevant files

Depends on `docs/ai/REPOSITORY_AI_AUDIT.md`. The specification names:

- Groq: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
  `qwen/qwen3.8-27b`.
- Cloudflare Workers AI: `@cf/zai-org/glm-4.7-flash`,
  `@cf/nvidia/nemotron-3-120b-a12b`,
  `@cf/google/gemma-4-26b-a4b-it`.

These are candidate IDs only. Verify each against official Groq and Cloudflare
model/API documentation; do not trust repository notes or third-party lists as
proof.

## Exact implementation tasks

For each exact candidate, record:

1. Official catalogue/model-card URL and exact API model identifier.
2. Supported API endpoint and request/response format.
3. Context and maximum input/output limits.
4. JSON mode and JSON Schema support through that endpoint, exact parameter
   names, and any schema restrictions.
5. Finish/stop reasons, truncation indicators, usage/token fields, errors,
   `Retry-After`, and provider request identifiers if documented.
6. Free-tier/no-purchase eligibility and published RPM/TPM/RPD/concurrency
   quotas. Separate general limits from model-specific limits and account
   dashboard values.
7. Data retention, training use, privacy, and relevant terms.
8. What cannot be verified publicly and must be checked in a provider
   dashboard/account.
9. Status per model: `verified`, `partially verified`, or `unavailable`, with
   evidence and review date.

Also verify provider-level auth, timeout, rate-limit, and quota behavior.
Recommend no replacement unless an alternative is independently checked using
the same official-source criteria and is approved by a human.

## Constraints and things that must not change

- Do not implement clients or change source/config.
- Use official provider/model documentation as evidence; cite direct URLs and
  retrieval date. Do not invent missing limits or capability claims.
- No provider API calls, live inference, billing setup, or credit purchase.
- Do not mark a candidate free based on a trial, billing-linked credit, or
  unverified third-party statement.
- Do not silently replace any unavailable candidate.

## Dependencies on previous steps

Requires completion and human approval of 01's repository audit. This prompt
precedes architecture approval and all implementation.

## Expected files and outputs

- Create `docs/ai/SIX_MODEL_PROVIDER_VERIFICATION.md`.
- Include one evidence table per model and provider-level notes, official links,
  unknowns, and a clear integration decision.
- Create no implementation files.

## Verification and testing requirements

- Cross-check every exact model ID and capability at its cited official source.
- Clearly identify published limits versus dashboard-only limits.
- No tests or network inference. Reading public documentation is not calling
  model APIs.
- Confirm the worktree has no source changes from this step.

## Completion criteria

All six candidates have evidence-backed statuses, every unknown is stated, and
the strict ₹0 condition is assessed. Stop for human review/approval of the
verified candidate set. A partially verified or unavailable candidate blocks
its implementation; do not present it as verified.

