# AI provider setup status

The legacy Gemini/OpenRouter selected-model pipeline and local Qwen runtime
have been retired. Shared Groq and Cloudflare Workers AI candidate metadata and
provider-neutral contracts now exist. Isolated adapters are implemented for
Groq GPT-OSS 120B/20B and all three Cloudflare candidates, but neither adapter
is wired into the assessment path. Contextual AI assessment remains disabled,
and the backend makes no provider requests. IBM Equal Access analysis
continues independently.

No model is currently eligible for requests. All six candidates remain
`blocked_unverified` and operator-disabled. The operator reports that Groq's
Free account allows all three candidates and shows 30 RPM, 1,000 RPD, 8,000 TPM,
and 200,000 TPD per model. The operator also confirmed no payment method,
purchased credits, or auto-recharge; Groq account eligibility is recorded as
zero-cost eligible based on that dashboard report. Runtime compatibility is
untested. The operator reports that all three Groq models support strict and
best-effort structured output and provisionally accepts that for implementation
testing. Groq's public documentation still contradicts itself about Qwen strict
support, so the operator finding is not treated as runtime verification and
all candidates remain blocked.

The operator reports a Cloudflare Workers Free account, no paid plan/payment
method/AI Gateway credits, and 0 Neurons used at verification. Based on that
account evidence and Cloudflare's published billing rules, the three
Cloudflare candidates are recorded as account-level `zero_cost_eligible`
within the shared 10,000-Neuron daily allocation. Their overall model status
remains partially verified. The operator's documentation review reports output
maxima of GLM 4,096, Gemma 8,192, and Nemotron 16,384 tokens; the intended
application limit is 2,048 tokens. Maximum input tokens remain unknown. The
model schemas document `max_tokens`, `max_completion_tokens`, and
`response_format`, but exact-model JSON/JSON Schema behavior is provisional
until tested with the accessibility result schema.
The Cloudflare adapter uses the documented JSON Schema request shape and
rejects non-JSON completions, but this does not prove that the models conform
to the requested schema. Exact-model support and schema compatibility remain
unverified; the adapter has only mocked tests. Nemotron 3 120B is listed for
planned deprecation on 2026-11-20, so it must not be used after that date
without renewed model verification and operator approval.

Eligibility still fails closed unless a candidate is fully verified,
explicitly zero-cost eligible, enabled by the operator, and has a positive
output cap and its configured structured-output capability confirmed. No
candidate has been marked fully verified. No assessment-pipeline integration,
usage-ledger preflight, or runtime provider verification exists. The
Cloudflare adapter treats exhausted free allocation and paid-plan-required
errors as terminal; it does not switch to paid usage or another provider.

Retired `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and `RAC_AI_MODEL` settings are
not used. Backend-only credential names are `GROQ_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`; setting them does not
enable any candidate. The Groq adapter reads `GROQ_API_KEY` only when invoked.
No credentials are needed or consumed in this phase.

Exact model evidence and unknowns are listed in
[provider verification](ai/SIX_MODEL_PROVIDER_VERIFICATION.md). The approved
target design and migration gates are in
[the six-model architecture](ai/SIX_MODEL_ARCHITECTURE.md). There is no
provider/model fallback or live connection check during this transition.

The `/api/ai/health` endpoint reports `migration_pending`. The
`/api/ai/usage` endpoint is read-only and exposes historical JSON-ledger data;
it does not indicate current provider eligibility, current usage, or a
zero-cost guarantee.

The durable batch/job ledger uses Node.js built-in `node:sqlite` and requires
Node.js 24.11.0 or later. SQLite is experimental in this Node release.
Terminal jobs, attempts, and normalized results are retained for seven days
from job completion by default (`USAGE_LEDGER_RETENTION_DAYS`). Expired job
cleanup runs when the ledger opens or on an explicit cleanup call; batches,
snapshots, and projects are not automatically removed. The existing JSON usage
ledger and `/api/ai/usage` data remain unchanged and are not imported, migrated,
modified, or deleted. Raw provider response bodies are not stored.

Attempts have per-ledger process ownership and renewable leases. Recovery is an
explicit operation: it only recovers expired work when its recorded owner is
confirmed absent on the same host. Ownerless legacy attempts and unknown-host
owners are left untouched. Recovery is not enabled at startup and is not
integrated with a scheduler.
