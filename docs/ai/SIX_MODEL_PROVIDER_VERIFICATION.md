# Six-Model Provider Verification

**Review date:** 2026-11-10
**Evidence source:** Official Groq and Cloudflare documentation, plus
operator-reported dashboard and documentation findings dated 2026-11-09 and
2026-11-10.
**Scope:** Account evidence below was reported by the operator and was not
independently accessed. Provider documentation was directly checked. No billing
setup was changed. Earlier probes did not complete inference. A later
explicitly approved Cloudflare greeting phase received HTTP 200 from all three
models and returned usage counts, but none produced a usable completed greeting.
Subsequent probes ran against the then-configured OpenAI-compatible route, not
the native AI Run request envelope now adopted below. Those calls are retained
as historical provider observations but do not runtime-verify the corrected
route or schema handling. On 2026-11-10, a new approved run sent the supplied
HTML to all six models using the current Cloudflare AI Run format and Groq's
strict JSON Schema format. Four returned schema-valid HTML extractions; two
Groq GPT-OSS models initially rejected the request with HTTP 400. A subsequent
Groq-only run with a strict-compatible schema and reasoning excluded returned
schema-valid extractions from both. The extraction schema does not request
accessibility findings. After the operator reconfirmed free/no-paid-path
account status on 2026-11-10, all six models were enabled for supervised live
assessment evaluation. Their verification status remains partial; the
extraction probes did not test accessibility assessment accuracy. Website
execution remains disabled until `RAC_CONTEXTUAL_AI_ENABLED=true`.

Before the Cloudflare probes, the operator reported Workers Free, 10,000 of
10,000 daily Neurons remaining, no inference usage in the prior 30 days, and no
paid route. The operator also reconfirmed the Groq Free plan/model access and
no paid route. After the probes, the operator reported 0/10,000 Neurons used
and 0 Text Generation Neurons/cost; the full daily allocation remained.

## Verification dimensions

- **Documentation verification** records what provider docs say for the exact
  model or API schema. A documented request field does not prove that the
  provider accepts or successfully enforces it at runtime for that model.
- **Account verification** records plan, allowed-model, billing, and quota
  evidence observed by the operator. It does not prove runtime connectivity.
- **Runtime verification** requires a permitted live request. All six models
  have passed strict-schema HTML extraction probes, but no accessibility
  assessment verification has been completed. The rejected Qwen request below
  predates its later successful extraction probe.

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

## Approved live attempt

The operator approved one synthetic strict-schema assessment for Groq
`qwen/qwen3.8-27b`, capped at 64 output tokens, with a 15-second timeout and no
retries. The request used the application's assessment schema, but was sent
directly to Groq because the normal application eligibility gate still blocks
all candidates. The strict validator was not run because no response was
returned. No eligibility state or production route was changed.

| Record time | Candidate | Request | Result | Validation / usage | Cost evidence |
|---|---|---|---|---|---|
| 2026-11-09 20:25:39 +05:30 (record updated; exact dispatch time not captured) | Groq `qwen/qwen3.8-27b` | 1 synthetic assessment; 64-token cap; 15-second timeout; 0 retries | HTTP 400; provider request ID `req_01m70cwz8dej5sakfyvd6sbdgj` | Response schema validation not run; provider returned no usage; operator later reported dashboard input/output/total tokens all 0 and API call count 0. Response body was not retained. The rejection does not establish whether strict schema support is the cause. | Operator preflight expected ₹0; dashboard cost was not reported, so cost is unconfirmed. |
| 2026-11-09 21:20:48 +05:30 | Cloudflare `@cf/zai-org/glm-4.7-flash` | 1 synthetic assessment; 64-token cap; 15-second timeout; 0 retries | HTTP 400; code `3030`; request ID `a57df9af6bddd431-MAA` | Completion usage unavailable; response body not retained; strict validation not run | Preflight: operator-reported 10,000/10,000 Neurons. Post-probe dashboard: 0 Neurons used, 0 Text Generation Neurons/cost. |
| 2026-11-09 21:20:49 +05:30 | Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | 1 synthetic assessment; 64-token cap; 15-second timeout; 0 retries | HTTP 400; code `3030`; request ID `a57df9b2b9d5a920-MAA` | Completion usage unavailable; response body not retained; strict validation not run | Preflight: operator-reported 10,000/10,000 Neurons. Post-probe dashboard: 0 Neurons used, 0 Text Generation Neurons/cost. |
| 2026-11-09 21:20:50 +05:30 | Cloudflare `@cf/google/gemma-4-26b-a4b-it` | 1 synthetic assessment; 64-token cap; 15-second timeout; 0 retries | HTTP 400; code `8007`; request ID `a57df9b84835d431-MAA` | Completion usage unavailable; response body not retained; strict validation not run | Preflight: operator-reported 10,000/10,000 Neurons. Post-probe dashboard: 0 Neurons used, 0 Text Generation Neurons/cost. |

After the operator reported 10,000/10,000 daily free Neurons and authorized up
to three attempts for each candidate, retry settings were changed and tested
locally. A second synthetic test run used the actual provider adapters, the
application schema, 200 output tokens, a 60-second timeout, sequential
requests, and no more than three total attempts per model. The prompt requested
a concise explanation of about 100 words. Only explicitly transient failures
were retried. Groq GPT-OSS models each returned HTTP 400 on their first request
and were not retried. Cloudflare models each exhausted three attempts:
GLM/Nemotron returned code 3030; Gemma returned code 8007. The response bodies
were not retained, and no inference completed. The operator's dashboard
subsequently showed 0/10,000 Neurons used and 0 Text Generation Neurons/cost.
Qwen was probed once more with the revised output cap and timeout, but again
returned HTTP 400; no retry followed because this was non-transient. The
production Groq adapter still fail-closes Qwen on provisional strict-schema
support. Provider request IDs from the final attempts are recorded below.

## Six-candidate status

| Candidate | Documentation / schema | Account and free eligibility | Runtime result | Usage / cost evidence | Remaining blocker |
|---|---|---|---|---|---|
| Groq `openai/gpt-oss-120b` | Strict schema documented | Operator-reported Free/no-paid-path confirmation; exposed key rotated before follow-up | Follow-up strict-compatible extraction returned HTTP 200 and passed output-shape validation; earlier schema request returned HTTP 400 | Follow-up: 1,173 input / 365 output tokens; post-run cost not checked | Enabled for supervised assessment evaluation; assessment accuracy unverified |
| Groq `openai/gpt-oss-20b` | Strict schema documented | Operator-reported Free/no-paid-path confirmation; exposed key rotated before follow-up | Follow-up strict-compatible extraction returned HTTP 200 and passed output-shape validation; earlier schema request returned HTTP 400 | Follow-up: 1,173 input / 240 output tokens; post-run cost not checked | Enabled for supervised assessment evaluation; assessment accuracy unverified |
| Groq `qwen/qwen3.8-27b` | Strict-schema documentation remains contradictory | Operator-reported Free/no-paid-path confirmation | Current direct strict-schema extraction returned HTTP 200 and passed the requested output-shape validation | 1,098 input / 169 output tokens; post-run cost not checked | Enabled for supervised evaluation; document conflict and assessment accuracy remain unresolved |
| Cloudflare `@cf/zai-org/glm-4.7-flash` | Exact model documented; not listed on JSON Mode supported-model page | Operator-reported Workers Free, no paid path, 10,000 Neurons before run | Current native AI Run extraction returned HTTP 200 and passed output-shape validation | 969 input / 214 output tokens; post-run balance/cost not checked | Enabled for supervised evaluation; assessment accuracy unverified |
| Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | Exact model documented; planned deprecation 2026-11-20 | Operator-reported Workers Free, no paid path, 10,000 Neurons before run | Current native AI Run extraction returned HTTP 200 and passed output-shape validation | 1,248 input / 248 output tokens; post-run balance/cost not checked | Enabled for supervised evaluation; assessment accuracy unverified; recheck deprecation |
| Cloudflare `@cf/google/gemma-4-26b-a4b-it` | Exact model documented; not listed on JSON Mode supported-model page | Operator-reported Workers Free, no paid path, 10,000 Neurons before run | Current native AI Run extraction returned HTTP 200 and passed output-shape validation | 1,276 input / 244 output tokens; post-run balance/cost not checked | Enabled for supervised evaluation; assessment accuracy unverified |

| Retry-run time (local) | Candidate | Attempts | Result | Final provider request ID | Output / usage |
|---|---|---:|---|---|---|
| 2026-11-09 22:01:30 +05:30 | Groq `openai/gpt-oss-120b` | 1 | HTTP 400, `invalid_request_error` | `req_01m70jd2d2e0zrxc6yp84zjxz9` | No completion usage |
| 2026-11-09 22:01:30 +05:30 | Groq `openai/gpt-oss-20b` | 1 | HTTP 400, `invalid_request_error` | `req_01m70jd2pwet388sry66dgcx46` | No completion usage |
| 2026-11-09 22:01:33 +05:30 | Cloudflare `@cf/zai-org/glm-4.7-flash` | 3 | HTTP 400, code `3030` | `a57e355b28db7f0f-MAA` | No completion usage |
| 2026-11-09 22:01:36 +05:30 | Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | 3 | HTTP 400, code `3030` | `a57e356e3a5e7f0f-MAA` | No completion usage |
| 2026-11-09 22:01:39 +05:30 | Cloudflare `@cf/google/gemma-4-26b-a4b-it` | 3 | HTTP 400, code `8007` | `a57e357f294e7f0f-MAA` | No completion usage |
| 2026-11-09 22:09:30 +05:30 (record time; exact dispatch time not captured) | Groq `qwen/qwen3.8-27b` | 1 | HTTP 400 | `req_01m70jv8gxexesz7kn8d1vj6r1` | 200-token cap; 60-second timeout; no completion usage |

Cloudflare's reviewed published error reference does not list codes 3030 or
8007. The operator reports that 3030 was capacity-related and 8007 an internal
infrastructure error; the exact public meanings remain unconfirmed. These
responses do not establish that the models reject JSON Schema: the error
bodies were not retained, and no inference completed. No output was returned,
so strict schema validation did not run. Any additional live retry requires
fresh model-specific approval.

### Cloudflare greeting connectivity phase

On 2026-11-09 at 22:55 +05:30, after the operator reconfirmed Workers Free, no
paid path, and 10,000 remaining Neurons, the explicit verification CLI sent
one synthetic greeting request to each Cloudflare candidate. Requests were
sequential, with at least five seconds between starts, a 32-token output cap,
a 60-second timeout, and no retries. All three returned HTTP 200 and usage
counts, showing the endpoint returned responses and inference usage was
reported. The completion parser did not accept a completed greeting from any
model; response bodies were not retained. No strict JSON Schema request or
assessment was sent. The operator-provided preflight is not a post-run billing
dashboard check.

| Candidate | Result | Usage | Request ID |
|---|---|---|---|
| Cloudflare `@cf/zai-org/glm-4.7-flash` | HTTP 200; unusable completion | 23 input / 32 output tokens | `id-1794245038645` |
| Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | HTTP 200; incomplete completion | 33 input / 32 output tokens | `id-1794245046462` |
| Cloudflare `@cf/google/gemma-4-26b-a4b-it` | HTTP 200; unusable completion | 34 input / 32 output tokens | `id-1794245047430` |

At 23:24 +05:30, a later command intended for GLM only did not honor its
`--model` argument and sent one greeting request to each of the three models.
This was identified after dispatch. The calls were sequential, used a 64-token
cap, and received no retries. GLM and Nemotron returned HTTP 200 with invalid
completion results; Gemma returned HTTP 200 with an incomplete result. A
subsequent operator-authorized GLM-only request also reached the 64-token cap
and exposed no message content. One further explicitly approved GLM-only
request used a 200-token cap and returned HTTP 200/`stop`, with `Hello` and
model reasoning text; usage was 23 input / 77 output tokens. These greeting
calls do not establish structured-output support.

### Cloudflare strict JSON Schema phase

After the operator reconfirmed Workers Free, no paid path, and 9,977 remaining
Neurons, one strict JSON Schema greeting request was sent sequentially to each
Cloudflare candidate. The request used `strict: true`, a 512-token output cap,
a 60-second timeout, and no retry was needed. GLM returned HTTP 200 but hit the
token limit without a usable completion. Nemotron returned HTTP 200 and a
completed object matching the probe schema. Gemma returned HTTP 200 but hit
the token limit and provided no usable object. Requests were sequential with
at least five seconds between starts. No assessment finding was requested,
and no response other than the bounded schema output was retained.

| Candidate | Result | Usage | Request ID |
|---|---|---|---|
| Cloudflare `@cf/zai-org/glm-4.7-flash` | HTTP 200; incomplete/invalid completion; strict schema not validated | 22 input / 512 output tokens | `id-1794247637427` |
| Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | HTTP 200; schema-shaped completion validated: `{"greeting":"Hello!"}` | 32 input / 160 output tokens | `id-1794247640248` |
| Cloudflare `@cf/google/gemma-4-26b-a4b-it` | HTTP 200; incomplete completion at token limit; strict schema not validated | 32 input / 512 output tokens | `id-1794247669533` |

This single, flat greeting-schema probe verifies only that Nemotron returned
one matching JSON object in this request. It does not certify general
JSON-Schema support, the production assessment schema, assessment accuracy,
or strict-₹0 cost. The operator-provided 9,977-Neuron preflight was
pre-request evidence; no post-request dashboard balance or cost was reported.

Before the 512-token three-model phase, one separately approved GLM strict
schema request used a 200-token cap. It returned HTTP 200 but hit the output
limit without a usable JSON object (29 input / 200 output tokens; request ID
`id-1794247328882`). This is not a successful schema validation.

### Six-model uploaded-HTML extraction run

On 2026-11-10, after the operator authorized transmission of `D:\test-3.html`
to all six provider endpoints and confirmed a current zero-paid-path preflight,
one sequential run used three total attempts maximum per model, retrying only
explicitly transient provider failures. Requests were spaced at least five
seconds apart and capped at 512 output tokens. No retries were triggered.
Cloudflare requests used native `/ai/run`, nested `input`, `enable_thinking:
false`, temperature `0.3`, and inline strict JSON Schema. Groq requests used
its strict Chat Completions schema format. The requested schema extracted page
title, meta description, headings, links, and paragraphs; it deliberately did
not ask models to diagnose accessibility.

| Provider / model | Result | Usage (input / output) | Request ID |
|---|---|---:|---|
| Groq `openai/gpt-oss-120b` | HTTP 400 `json_validate_failed`; no retry (permanent request rejection) | Not returned | `a582c7215cadd089-BOM` |
| Groq `openai/gpt-oss-20b` | HTTP 400 `json_validate_failed`; no retry (permanent request rejection) | Not returned | `a582c73e78d6d089-BOM` |
| Groq `qwen/qwen3.8-27b` | HTTP 200; output passed shape validation | 1,098 / 169 tokens | `chatcmpl-7aedd55a-70c1-4979-805e-634b86b8cbe0` |
| Cloudflare `@cf/zai-org/glm-4.7-flash` | HTTP 200; output passed shape validation | 969 / 214 tokens | `chatcmpl-97aad95c8fcad5e8` |
| Cloudflare `@cf/nvidia/nemotron-3-120b-a12b` | HTTP 200; output passed shape validation | 1,248 / 248 tokens | `chatcmpl-b2f7b9cc35a58822` |
| Cloudflare `@cf/google/gemma-4-26b-a4b-it` | HTTP 200; output passed shape validation | 1,276 / 244 tokens | `ed9fedac4dd9461fa8f8c7690f3e498f` |

The four successful outputs agreed on the title (`Accessible Web Page
Example`), an empty description (no meta description is present), four
headings, and the W3C link. Paragraph serialization differed: Groq Qwen
decoded entities to text, Cloudflare Nemotron retained inline `<abbr>` and
`<a>` markup in paragraph strings, and GLM retained `&copy;` in the footer.
These are extraction outputs, not an accessibility audit or a merged report.
The two GPT-OSS HTTP 400 responses did not include usage. The operator's
10,000-Neuron balance was pre-run evidence; no post-run account usage or cost
was independently checked. At the time of this extraction run, model eligibility
for production contextual assessment remained blocked; the later operator
enablement is for supervised evaluation only and does not mark assessments
verified.

### Groq GPT-OSS strict-schema follow-up

After the operator confirmed the exposed Groq key had been rotated and
replaced, and reconfirmed there was no paid billing path, one request was sent
to each previously rejected model, sequentially, with a five-second pause
between calls. This corrected the strict schema by marking all fields required
and setting `additionalProperties: false` on the root and nested objects.
Requests used `include_reasoning: false`, `reasoning_effort: "low"`,
`max_completion_tokens: 512`, and a 45-second client timeout. The prompt asked
for at most 100 words; the operator explicitly accepted longer answers if
returned. Both outputs were 62 words and passed local output-shape validation.
The response content contained only the JSON answer (the API request excluded
the reasoning field); this does not assert that the models performed no
internal reasoning.

| Model | Result | Usage (input / output) | Request ID | Elapsed |
|---|---|---:|---|---:|
| Groq `openai/gpt-oss-120b` | HTTP 200; `stop`; strict JSON shape valid; 62 words | 1,173 / 365 tokens | `req_01m72155wae69a7p2p46kez957` | 1.596 s |
| Groq `openai/gpt-oss-20b` | HTTP 200; `stop`; strict JSON shape valid; 62 words | 1,173 / 240 tokens | `req_01m7215c4wexesetfv85dedh7a` | 1.440 s |

Both produced the same extraction: title “Accessible Web Page Example,” an
empty meta description, four headings, the W3C link, and three paragraph
strings. These calls verify successful strict-schema extraction for these
requests, not accessibility assessment accuracy or production readiness. No
post-call billing dashboard was checked, and model eligibility remains blocked.

## Groq

### Provider-level findings

- **API and authentication — Verified:** Groq documents an OpenAI-compatible
  Chat Completions API at
  `https://api.groq.com/openai/v1/chat/completions`; requests use the Groq API
  key as a bearer credential. The model pages show the exact IDs in direct
  Chat Completions examples.
- **Structured output — Documented for GPT-OSS 120B/20B; provisional for
  Qwen 3.8 27B:** The Structured Outputs page's supported-model list names all
  three IDs for strict mode, but its later “Choosing Between Strict and
  Best-effort Mode” table says strict mode is limited to GPT-OSS 20B and 120B.
  The current page therefore remains internally contradictory for Qwen.
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
- **Operator-reported account check — Verified as reported:** The Groq Console
  showed the Free ($0) plan, Developer plan inactive, and all three exact model
  IDs in Allowed Models. The operator confirms no payment method, purchased
  credits, or auto-recharge; project limits are disabled, and the organization
  limits for each model are 30 RPM, 1,000 RPD, 8,000 TPM, and 200,000 TPD.
  Developer upgrades were temporarily unavailable. The account is recorded as
  zero-cost eligible based on the operator's dashboard review, not runtime
  verification.

### Candidate evidence

The operator reports all three exact IDs are allowed on the Free organization
and each currently shows the same organization limits. These dashboard values
are recorded separately from the Developer-plan public defaults. The selected
application output cap is 2,048 tokens; it is not the model maximum.

| Candidate | Official API model ID | Context / max input / max output | Published price per 1M tokens | App output cap | Account-reported limits RPM / RPD / TPM / TPD | JSON Schema | Status |
|---|---|---|---|---|---|---|
| GPT-OSS-120B | `openai/gpt-oss-120b` | 131,072 / unconfirmed / 65,536 | $0.15 input; $0.60 output | 2,048 | 30 / 1,000 / 8,000 / 200,000 | Strict and best-effort listed | **Partially verified** — runtime compatibility untested |
| GPT-OSS-20B | `openai/gpt-oss-20b` | 131,072 / unconfirmed / 65,536 | $0.075 input; $0.30 output | 2,048 | 30 / 1,000 / 8,000 / 200,000 | Strict and best-effort listed | **Partially verified** — runtime compatibility untested |
| Qwen 3.8-27B | `qwen/qwen3.8-27b` | 131,072 / unconfirmed / 16,384 | $0.80 input; $4.00 output | 2,048 | 30 / 1,000 / 8,000 / 200,000 | Current page lists strict support but contradicts itself later; strict support remains provisional | **Partially verified** — runtime compatibility untested |

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

- **API and authentication:** The operator supplied the request contract now
  used by this application: `POST /client/v4/accounts/{account_id}/ai/run`,
  top-level `model`, and nested `input` containing `messages`,
  `chat_template_kwargs`, `response_format`, `temperature`, and `max_tokens`.
  The response text is read from `result.choices[0].message.content`.
  Authentication uses an account ID and an API token with Workers AI
  permissions. The adapter and diagnostic probe use this contract. The
  current endpoint/request shape has not yet been live-verified.
- **Response metadata — Verified:** The synchronous model output schemas
  describe an AI Run result envelope with completion data under `result`,
  including `result.choices`, `finish_reason`, and usage fields
  (`prompt_tokens`, `completion_tokens`, `total_tokens`). Documented finish
  reasons include `stop`, `length`, `tool_calls`, `content_filter`, and
  `function_call`. Treat `length` and other non-normal completion reasons as
  incomplete/non-successful assessments.
- **JSON/JSON Schema — Parameter documented; exact-model support provisional:**
  Each exact model's synchronous input schema documents `response_format`
  choices including `json_object` and `json_schema`, and a `strict` boolean
  field under `json_schema`. The AI Run request uses `max_tokens` under `input`.
  The operator proposes provisionally treating
  model JSON/JSON Schema support as available for implementation testing.
  However, the JSON Mode supported-model list omits all three candidates and
  Cloudflare warns it cannot guarantee schema adherence in every case.
  Therefore exact-model JSON/JSON Schema and strict-schema support remain
  provisional and require testing against the application's actual schema.
  The historical Cloudflare runtime probes used the former Chat Completions
  route and envelope. In particular, the prior Nemotron greeting-schema success
  does not validate the current native AI Run endpoint.
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
- **Quota handling:** The provider's Free-plan rejection at the limit is
  distinct from an application-level preflight/ledger guard. A Cloudflare
  adapter with mocked tests now maps error `3036` to terminal quota exhaustion
  and stops on paid-plan-required error `5035`; no live requests were sent.
  Application-level preflight and scheduler integration remain unimplemented.
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

| Model | Exact model ID | Context window | Max input tokens | Max output tokens | Application output cap | Published price per 1M input / output tokens | Neurons per 1M input / output tokens | Account status |
|---|---|---:|---:|---:|---:|---:|---:|---|
| GLM-4.7-Flash | `@cf/zai-org/glm-4.7-flash` | 131,072 | Unconfirmed | 4,096 (operator-reported documentation) | 2,048 | $0.0605 model page; $0.060 pricing table / $0.40 | 5,500 / 36,400 | Account-reported zero-cost eligible within shared Free allocation |
| NVIDIA Nemotron 3 120B | `@cf/nvidia/nemotron-3-120b-a12b` | 256,000 | Unconfirmed | 16,384 (operator-reported documentation) | 2,048 | $0.50 / $1.50 | 45,455 / 136,364 | Account-reported zero-cost eligible within shared Free allocation |
| Gemma 4 26B A4B | `@cf/google/gemma-4-26b-a4b-it` | 256,000 | Unconfirmed | 8,192 (operator-reported documentation) | 2,048 | $0.10 / $0.30 | 9,091 / 27,273 | Account-reported zero-cost eligible within shared Free allocation |

Cloudflare currently lists Nemotron 3 120B for planned deprecation on
2026-11-20. Its candidate ID is preserved, but use after that date requires
renewed provider verification and operator approval; do not silently substitute
another model.

For AI Run, the operator-supplied request uses `input.max_tokens`; the former
OpenAI-compatible route used `max_completion_tokens`. The numeric output
maxima above come from the operator's manual documentation review and have
not been independently verified against a provider source by this review.
Context-window size,
maximum input tokens, and maximum output tokens are tracked separately.
Maximum input remains unconfirmed. The planned 2,048-token application cap is
an application setting, not a provider-imposed model maximum.

The GLM model page lists input pricing as $0.0605 per million tokens, while
the current Workers AI pricing table displays $0.060; both list $0.40 output
and 5,500 input / 36,400 output Neurons per million tokens. The catalog retains
the model-page unit price and records the pricing-table value here rather than
silently treating the rounded values as identical.

The per-model request schemas document `response_format`, including a
`json_schema` object and nullable `strict` field. Separately, the provider JSON
Mode page omits all three exact models from its supported-model list. Catalog
metadata therefore records parameter schemas as `documented`, while
model-level JSON Mode, JSON Schema, and strict behavior remain `provisional`
until tested with the actual assessment schema.

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
- [Reject busy requests](https://developers.cloudflare.com/workers-ai/features/reject-if-busy/)
- [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [GLM synchronous output schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-output.json)
- [Nemotron synchronous output schema](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/sync-output.json)
- [Gemma synchronous output schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-output.json)
- [GLM synchronous input schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-input.json)
- [Nemotron synchronous input schema](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/sync-input.json)
- [Gemma synchronous input schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-input.json)

The Cloudflare JSON Mode page's current supported-model list does not include
GLM-4.7-Flash, Nemotron 3 120B, or Gemma 4 26B A4B IT. Their request schemas
accepting generic `response_format`/`json_schema` parameters do not establish
general support for those exact models. However, the approved native AI Run
HTML-extraction probes for all three returned schema-valid JSON. This confirms
the tested request path and extraction schema only; it does not verify the
production assessment schema, accessibility accuracy, or ongoing provider
availability. All three are operator-enabled for supervised evaluation and
remain partially verified.

## Integration decision

1. **Provider clients and supervised evaluation are enabled.** All six
   candidates are operator-enabled for supervised assessment evaluation,
   based on operator-reported free/no-paid-path account status and successful
   extraction probes. Their verification and runtime statuses intentionally
   remain `partially_verified`; extraction did not establish accessibility
   assessment accuracy. Keep the separate `RAC_CONTEXTUAL_AI_ENABLED` server
   opt-in off until a live assessment run is explicitly authorized.
2. **Groq account status is operator-reported zero-cost eligible.** The
   operator confirmed Free plan and no paid path. Groq strict-schema
   extraction succeeded for all three models, but the public documentation
   remains internally contradictory about Qwen support. Review assessment
   results against known cases before treating any model as accurate.
3. **Cloudflare account status is operator-reported at the account/billing
   level.** Extraction probes succeeded for all three exact model IDs, but
   Cloudflare's JSON Mode supported-model list omits these models and schema
   conformance is not guaranteed. The shared free allowance is limited and
   resets daily; the application quota guard is not integrated. Recheck the
   account balance and availability before each approved live run. Maximum
   input tokens remain unknown; output limits and the 2,048-token application
   cap are recorded in the catalog.
4. **No replacements are recommended.** If strict structured-output
   compatibility cannot be established, stop and request human approval of
   any revised shortlist. Do not silently substitute models, providers,
   routes, or paid options.
5. **No candidate is assessment-verified.** The extraction probes establish
   only bounded request/response compatibility for the tested extraction
   prompts. They do not prove accessibility assessment quality, strict
   compliance with the production assessment schema, or zero cost after each
   run.

## Retrieval and verification notes

- Public documentation and operator-reported account and model-limit facts
  were reviewed and the account preflight was reconfirmed by the operator on
  2026-11-09. The operator-reported Cloudflare balance was 10,000 of 10,000
  Neurons before the initial probes; after those probes the operator reported
  0/10,000 Neurons used and 0 Text Generation Neurons/cost. After the retry
  run, the operator again reported 0/10,000 Neurons used and no cost.
  Recheck first-party sources and dashboards before any future live step.
- The approved live Qwen request, initial Cloudflare probes, and retry run are
  recorded above. No further calls were made. Production retry defaults,
  provider error classification, contextual timeout, and supervised-evaluation
  eligibility were subsequently changed. The assessment opt-in remains off;
  no provider requests were made as part of those code changes.
