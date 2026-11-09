# 18 — Explicitly Approved Live Model Verification

## Objective

After local acceptance, perform a small, operator-approved live verification
of each eligible candidate against the actual assessment schema and record
which models truly work under the operator's current free-tier account.

## Preconditions and explicit approval

- Prompts 14–17 are complete; their tests/builds pass.
- The operator has reviewed the exact test plan, candidate list, request
  counts, expected free-tier impact, and abort conditions and explicitly
  approved this live run.
- The operator has configured credentials locally in the backend environment.
  Never request, read, copy, or print credential values in chat or tool output.
- Re-check account dashboards immediately before testing. If cost-free access
  or free allocation cannot be established for a candidate, do not call it.

## Candidates

- Groq: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
  `qwen/qwen3.8-27b`
- Cloudflare Workers AI: `@cf/zai-org/glm-4.7-flash`,
  `@cf/nvidia/nemotron-3-120b-a12b`,
  `@cf/google/gemma-4-26b-a4b-it`

Preserve all six. A candidate may be skipped or blocked independently; never
substitute another model.

## Exact implementation and execution tasks

1. Review exact-model official documentation and current account evidence.
   Resolve only claims supported by evidence; keep unknown fields unknown.
2. Before each call, show the model, planned request count, token/output cap,
   account/free-tier preflight, and operator-visible stop condition. Require
   confirmation before proceeding if the approved plan does not already
   authorize each specific call.
3. Use at most one minimal connection/schema probe and one small
   accessibility assessment per candidate. Use the actual project response
   schema and a harmless bounded fixture. Do not submit a real user's source.
4. Enforce the configured output cap, request timeout, cancellation, provider
   concurrency limits, and free-allocation reservation. Stop immediately on
   any paid-plan/payment-required response, uncertain cost, unexpected quota
   consumption, repeated failure, or credential-redaction issue.
5. Do not automatically retry uncertain outcomes. Do not use paid fallback,
   auto-recharge, another provider, or a different model.
6. Record redacted evidence: timestamp, exact model ID, request/response
   classification, schema validation result, token/Neuron usage if returned,
   and dashboard cost/free-allocation observation. Never record keys, raw
   source, or full provider payloads.
7. Mark a candidate runtime-verified only after a complete response passes the
   application's strict validator and the evidence is reviewed. Keep
   account eligibility, documentation verification, and runtime verification
   as separate facts. Do not mark the other candidates verified by inference.

## Constraints

- No live call without explicit operator approval.
- Strict inference budget: ₹0. If that cannot be confidently guaranteed,
  stop and report what evidence is missing.
- No automatic model enabling based solely on a successful probe.
- Never weaken schema validation or fail-closed eligibility to get a pass.
- IBM remains unchanged and is not part of this provider probe.

## Verification and report

Report a six-row matrix of documented support, account/free eligibility,
runtime result, usage/cost evidence, and remaining blockers. Include skipped
models and why. Run local tests/build and `git diff --check` after any code or
catalog change. Do not make additional live calls to debug without new
approval.

## Completion gate

The operator has evidence-based runtime results for whichever candidates were
approved and successfully tested; every other candidate remains explicitly
blocked or unverified. Live verification is not a guarantee of future access,
availability, or zero cost beyond the checked account state.
