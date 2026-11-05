# AI provider setup status

The legacy Gemini/OpenRouter selected-model pipeline and local Qwen runtime
have been retired. Shared Groq and Cloudflare Workers AI candidate metadata and
provider-neutral contracts now exist, but no direct provider clients have been
implemented. Contextual AI assessment remains disabled, and the backend makes
no provider requests. IBM Equal Access analysis continues independently.

No model is currently eligible for requests. All six candidates remain
`blocked_unverified` and operator-disabled. The operator reports that Groq's
Free account allows all three candidates and shows 30 RPM, 1,000 RPD, 8,000 TPM,
and 200,000 TPD per model, but payment method, purchased credits, and
auto-recharge remain unverified. Qwen's strict JSON Schema documentation is
contradictory.

The operator reports a Cloudflare Workers Free account, no paid plan/payment
method/AI Gateway credits, and 0 Neurons used at verification. Based on that
account evidence and Cloudflare's published billing rules, the three
Cloudflare candidates are recorded as account-level `zero_cost_eligible`
within the shared 10,000-Neuron daily allocation. Their overall model status
remains partially verified: numeric input/output limits and exact-model JSON
Mode/JSON Schema support remain unconfirmed. The model pages document
`max_tokens`, `max_completion_tokens`, and `response_format` request fields;
documenting these fields does not prove runtime support or a numeric maximum.

Eligibility still fails closed unless a candidate is fully verified,
explicitly zero-cost eligible, enabled by the operator, and has a positive
output cap and its configured structured-output capability confirmed. No
candidate has been marked fully verified, and no provider clients or runtime
quota guards exist. The Cloudflare Free-plan limit rejects usage beyond the
daily allocation, but any future client must stop on quota exhaustion and
never switch to billable usage.

Retired `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and `RAC_AI_MODEL` settings are
not used. Future backend-only credential names are `GROQ_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`; setting them does not
enable any candidate. No credentials are needed or consumed in this phase.

Exact model evidence and unknowns are listed in
[provider verification](ai/SIX_MODEL_PROVIDER_VERIFICATION.md). The approved
target design and migration gates are in
[the six-model architecture](ai/SIX_MODEL_ARCHITECTURE.md). There is no
provider/model fallback or live connection check during this transition.

The `/api/ai/health` endpoint reports `migration_pending`. The
`/api/ai/usage` endpoint is read-only and exposes historical JSON-ledger data;
it does not indicate current provider eligibility, current usage, or a
zero-cost guarantee.
