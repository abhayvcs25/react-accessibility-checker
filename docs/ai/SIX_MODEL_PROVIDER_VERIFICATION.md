# Six-Model Provider Verification

**Review date:** 2026-11-05
**Evidence source:** Official Groq and Cloudflare documentation, plus
operator-reported dashboard findings dated 2026-11-05.
**Scope:** Account evidence below was reported by the operator and was not
independently accessed. No API calls, live inference, billing setup, or
quota-consuming tests were performed.

## Verification dimensions

- **Documentation verification** records what provider docs say for the exact
  model or API schema. A documented request field does not prove that the
  provider accepts or successfully enforces it at runtime for that model.
- **Account verification** records plan, allowed-model, billing, and quota
  evidence observed by the operator. It does not prove runtime connectivity.
- **Runtime verification** requires a permitted live request. No runtime
  verification has been performed; all six candidates remain unverified at
  runtime and blocked in the catalog.

## Status definitions

- **Verified:** All required model, API, output, privacy, and strict-₹0
  requirements are supported by public evidence or confirmed account settings.
- **Partially verified:** The exact model and some technical properties are
  documented, but at least one required capability or strict-₹0 prerequisite
  remains unknown or account-specific.
- **Unavailable:** Official documentation says the exact candidate cannot be
  used through the specified provider/API.

All six candidates are **partially verified**. Their exact IDs are present in
official catalogs/model documentation, but no candidate satisfies every
verification item required for implementation under the strict ₹0 constraint.
No candidate is marked unavailable, and no replacement is proposed.

## Groq

### Provider-level findings

- **API and authentication — Verified:** Groq documents an OpenAI-compatible
  Chat Completions API at
  `https://api.groq.com/openai/v1/chat/completions`; requests use the Groq API
  key as a bearer credential. The model pages show the exact IDs in direct
  Chat Completions examples.
- **Structured output — Verified for GPT-OSS 120B and 20B; unresolved for
  Qwen 3.8 27B:** The Structured Outputs page lists all three IDs under
  `strict: true`, but its later “Choosing Between Strict and Best-effort Mode”
  table says strict mode is limited to GPT-OSS 20B and 120B. The page does not
  reconcile these statements. Keep Qwen strict-schema support unverified until
  Groq clarifies the conflict. All three are listed for best-effort mode.
  Strict mode uses
  `response_format: { type: "json_schema", json_schema: { name, strict: true,
  schema } }`. Strict schemas require every field in `required` and
  `additionalProperties: false`; unsupported schema shapes may be rejected.
  The provider docs still require application-side semantic validation.
- **Rate limits — Published plan values, not a free-tier guarantee:** Groq
  documents 30 RPM, 1,000 RPD, 8,000 TPM, and 200,000 TPD for each of the three
  IDs in the Developer-plan table. Limits apply at organization level; the
  exact organization limits appear in the account Limits page. The documentation
  says the table is a high-level summary and may have exceptions.
- **Rate-limit response — Verified:** HTTP 429 indicates a rate-limit response.
  Groq documents `retry-after` (seconds) and `x-ratelimit-*` headers for request
  and token limits/resets. The API response schema includes a completion ID,
  choices and finish reasons, plus `usage` token counts; the error reference
  describes JSON error objects with `message` and `type`.
- **Timeout and concurrency — Not verified:** No model-specific maximum
  concurrency or provider timeout guarantee was found in the cited public
  documentation. Any client timeout and bounded concurrency must be
  application-level safeguards.
- **Privacy — Verified with qualifications:** Groq states that inference
  customer data is not retained by default. It may temporarily log inputs and
  outputs for reliability or abuse investigations for up to 30 days; usage
  metadata is retained. Zero Data Retention is an account-level setting and
  has feature implications. Review the current data controls and applicable
  service agreement before sending project content.
- **Operator-reported account check — Partially verified:** The Groq Console
  showed the Free ($0) plan, Developer plan inactive, and all three exact model
  IDs in Allowed Models. The organization limits shown for each were 30 RPM,
  1,000 RPD, 8,000 TPM, and 200,000 TPD. The project-limits toggle was
  disabled, so these are the organization limits reported by the operator.
  Developer upgrades were temporarily unavailable.
- **Remaining Groq billing uncertainty — Not verified:** No payment-method,
  purchased-credit, or auto-recharge section was visible in the reviewed
  dashboard. These states must not be inferred from that absence. Therefore
  zero-cost eligibility remains conditional and all three account eligibility
  values remain `unverified`; no candidate is marked eligible.

### Candidate evidence

The operator reports all three exact IDs are allowed on the Free organization
and each currently shows the same organization limits. These dashboard values
are recorded separately from the Developer-plan public defaults.

| Candidate | Official API model ID | Context / max input / max output | Published price per 1M tokens | Account-reported limits RPM / RPD / TPM / TPD | JSON Schema | Status |
|---|---|---|---|---|---|---|
| GPT-OSS-120B | `openai/gpt-oss-120b` | 131,072 / unconfirmed / 65,536 | $0.15 input; $0.60 output | 30 / 1,000 / 8,000 / 200,000 | Strict and best-effort listed | **Partially verified** — billing/credit state remains unverified |
| GPT-OSS-20B | `openai/gpt-oss-20b` | 131,072 / unconfirmed / 65,536 | $0.075 input; $0.30 output | 30 / 1,000 / 8,000 / 200,000 | Strict and best-effort listed | **Partially verified** — billing/credit state remains unverified |
| Qwen 3.8-27B | `qwen/qwen3.8-27b` | 131,072 / unconfirmed / 16,384 | $0.80 input; $4.00 output | 30 / 1,000 / 8,000 / 200,000 | Best-effort listed; strict support contradicted on the same docs page | **Partially verified** — billing/credit state and strict support unresolved |

Qwen's model page lists text and image input, with up to three input images.
Images are not needed for the current text-evidence task.

### Groq official sources

- [Models catalog](https://console.groq.com/docs/models)
- [GPT-OSS-120B model page](https://console.groq.com/docs/model/openai/gpt-oss-120b)
- [GPT-OSS-20B model page](https://console.groq.com/docs/model/openai/gpt-oss-20b)
- [Qwen 3.8-27B model page](https://console.groq.com/docs/model/qwen/qwen3.8-27b)
- [OpenAI compatibility](https://console.groq.com/docs/openai)
- [Chat Completions API reference](https://console.groq.com/docs/api-reference#chat-create)
- [Structured Outputs](https://console.groq.com/docs/structured-outputs)
- [Rate limits](https://console.groq.com/docs/rate-limits)
- [Errors](https://console.groq.com/docs/errors)
- [Your Data](https://console.groq.com/docs/your-data)
- [Terms of Use](https://groq.com/terms-of-use)

## Terms and licensing

The linked Groq terms and Cloudflare model pages should not be treated as a
complete legal review. Cloudflare's Nemotron and Gemma model pages link to
separate NVIDIA and Google model licenses. Review applicable provider and
model terms for all candidates before implementation; this report does not
assess legal compatibility.

## Cloudflare Workers AI

### Provider-level findings

- **API and authentication — Verified:** The native REST endpoint is
  `POST /client/v4/accounts/{account_id}/ai/run/{model_id}`. The model pages
  document chat `messages`; Cloudflare also documents the OpenAI-compatible
  Chat Completions endpoint at
  `/client/v4/accounts/{account_id}/ai/v1/chat/completions`. Requests require
  an account ID and API token with Workers AI permissions.
- **Response metadata — Verified:** The synchronous model output schemas
  describe completion IDs, `choices`, `finish_reason`, and usage fields
  (`prompt_tokens`, `completion_tokens`, `total_tokens`). Documented finish
  reasons include `stop`, `length`, `tool_calls`, `content_filter`, and
  `function_call`. Treat `length` and other non-normal completion reasons as
  incomplete/non-successful assessments.
- **JSON/JSON Schema — Parameter documented; exact-model support unconfirmed:**
  Each exact model's synchronous input schema documents `response_format`
  choices including `json_object` and `json_schema`, and a `strict` boolean
  field under `json_schema`. `max_tokens` and `max_completion_tokens` are also
  documented request parameters. However, the JSON Mode supported-model list
  omits all three candidates and Cloudflare warns it cannot guarantee schema
  adherence in every case. Thus API parameter/schema shape is documented, but
  model-level JSON Mode, JSON Schema and strict-schema support remain
  `unconfirmed`. The parameter schema is not a runtime guarantee.
- **Free allocation — Documentation and account evidence verified:** The
  operator reports a Workers Free ($0) account, Workers Paid inactive, no
  payment method, no custom AI Gateway, no AI Gateway credits, and 0 Neurons
  consumed at the time checked. Official pricing documents a shared
  10,000-Neuron daily allocation, reset at 00:00 UTC. Workers Free cannot use
  more than the allocation without upgrading; the docs state further
  operations fail when limits are exceeded. Workers Paid bills overage at
  $0.011 per 1,000 Neurons. The account has no configured paid route according
  to the operator, and the three selected models are absent from Cloudflare's
  current paid-billing-required model list. Catalog account eligibility is
  recorded as `zero_cost_eligible` for these three models, conditional on the
  reported Free account remaining unchanged and usage staying within the
  shared daily allocation.
- **No runtime quota guard exists:** The provider's Free-plan rejection at the
  limit is distinct from an application-level preflight/stop guard. No client
  exists and no requests were sent. Any future client must treat exhaustion as
  terminal for the remaining work and must not switch to a paid plan or billing
  route.
- **Rate limits — Published task-level limit:** Text generation has a default
  limit of 300 requests per minute, except models requiring Workers Paid.
  Cloudflare identifies those exceptions in its pricing documentation; the
  three candidates below are not listed among them. This is not a token/minute
  or daily request quota. Exact account usage is shown in the dashboard.
- **Provider errors — Verified:** HTTP 429 / code 3036 means the daily free
  allocation is exhausted and must stop remaining jobs. HTTP 429 / code 3040
  means capacity is temporarily unavailable and may be handled as a bounded
  transient failure. Code 5035 / HTTP 403 means the model requires Workers
  Paid and must not be bypassed. No general `Retry-After` header contract was
  found in the reviewed Workers AI sources.
- **Timeout and concurrency — Not verified:** No model-specific concurrency
  or provider timeout guarantee was found in the cited public docs. Use bounded
  application-level concurrency and explicit client timeouts; do not infer
  allowed concurrency from RPM.
- **Privacy — Verified with qualifications:** Cloudflare states that standard,
  non-stateful inference inputs/outputs are not retained after processing and
  are not used to train AI models. Operational metadata (including account and
  model IDs, timestamps, sizes, token/Neuron counts, latency, and status/error
  codes) may be retained. Logging, caching, storage, batch, and other stateful
  features have their own storage lifecycle. Each candidate model page also
  carries a zero-data-retention designation.

### Candidate evidence

| Model | Exact model ID | Context window | Max input tokens | Max output tokens | Published price per 1M input / output tokens | Neurons per 1M input / output tokens | Account status |
|---|---|---:|---:|---:|---:|---:|---|
| GLM-4.7-Flash | `@cf/zai-org/glm-4.7-flash` | 131,072 | Unconfirmed | Unconfirmed | $0.0605 model page; $0.060 pricing table / $0.40 | 5,500 / 36,400 | Account-reported zero-cost eligible within shared Free allocation |
| NVIDIA Nemotron 3 120B | `@cf/nvidia/nemotron-3-120b-a12b` | 256,000 | Unconfirmed | Unconfirmed | $0.50 / $1.50 | 45,455 / 136,364 | Account-reported zero-cost eligible within shared Free allocation |
| Gemma 4 26B A4B | `@cf/google/gemma-4-26b-a4b-it` | 256,000 | Unconfirmed | Unconfirmed | $0.10 / $0.30 | 9,091 / 27,273 | Account-reported zero-cost eligible within shared Free allocation |

For each exact model schema, `max_tokens` and
`max_completion_tokens` exist as nullable integer request parameters. This
documents how to request a limit; it does not publish the model's numeric
maximum. Context-window size, maximum input tokens, and maximum output tokens
are therefore tracked separately. No numeric maximum input or output token
limit is published in the reviewed exact-model documentation.

The GLM model page lists input pricing as $0.0605 per million tokens, while
the current Workers AI pricing table displays $0.060; both list $0.40 output
and 5,500 input / 36,400 output Neurons per million tokens. The catalog retains
the model-page unit price and records the pricing-table value here rather than
silently treating the rounded values as identical.

The per-model request schemas document `response_format`, including a
`json_schema` object and nullable `strict` field. Separately, the provider JSON
Mode page omits all three exact models from its supported-model list. Catalog
metadata therefore records the parameter schemas as `documented`, while JSON
Mode and model-level JSON Schema/strict behavior remain `unconfirmed`.

The exact model pages document these additional capabilities:

| Model | Function calling | Reasoning | Vision | Batch | Zero data retention |
|---|---|---|---|---|---|
| GLM-4.7-Flash | Yes | Yes | Not documented | Not documented | Yes |
| NVIDIA Nemotron 3 120B | Yes | Yes | Not documented | Not documented | Yes |
| Gemma 4 26B A4B | Yes | Yes | Yes | Yes | Yes |

### Cloudflare official sources

- [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/)
- [GLM-4.7-Flash model page](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [NVIDIA Nemotron 3 120B model page](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/)
- [Gemma 4 26B A4B model page](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- [OpenAI-compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)
- [Pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Rate limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- [Errors](https://developers.cloudflare.com/workers-ai/platform/errors/)
- [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [GLM synchronous output schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-output.json)
- [Nemotron synchronous output schema](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/sync-output.json)
- [Gemma synchronous output schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-output.json)
- [GLM synchronous input schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-input.json)
- [Nemotron synchronous input schema](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/sync-input.json)
- [Gemma synchronous input schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-input.json)

The Cloudflare JSON Mode page's current supported-model list does not include
GLM-4.7-Flash, Nemotron 3 120B, or Gemma 4 26B A4B IT. Their request schemas
accepting generic `response_format`/`json_schema` parameters does not establish
support for those exact models. Their structured-output capabilities therefore
remain unverified.

## Integration decision

1. **Do not implement any provider client yet.** No candidate is fully verified
   and no live behavior has been tested.
2. **Groq candidates remain blocked.** The operator confirmed Free plan,
   Allowed Models and organization limits, but could not verify payment method,
   purchased credits, or auto-recharge. Qwen's strict-schema documentation is
   also contradictory.
3. **Cloudflare account eligibility is verified at the account/billing level
   only** based on operator-reported dashboard facts and public pricing/model
   documentation. The catalog records `zero_cost_eligible` for the three exact
   models while retaining overall `partially_verified`, `blocked_unverified`,
   and operator-disabled states. The shared free allowance is limited and
   resets daily; future clients need an explicit fail-closed quota stop.
   Cloudflare candidates remain partially verified because numeric model
   input/output limits and exact-model JSON/JSON Schema support are unresolved.
4. **No replacements are recommended.** If the Groq no-purchase condition or
   strict structured-output requirements cannot be met, stop and request human
   approval of any revised shortlist. Do not silently substitute models,
   providers, routes, or paid options.
5. **No live behavior is verified.** Public documentation review does not
   establish successful authentication, account entitlement, model response
   quality, or runtime compatibility.

## Retrieval and verification notes

- Public documentation and operator-reported account facts were reviewed on
  2026-11-05. Provider catalogues, pricing, limits, account status, and terms
  can change; recheck first-party sources and account dashboards before
  implementation or live testing.
- No live API or inference test was performed, and the assessment pipeline was
  not changed.
