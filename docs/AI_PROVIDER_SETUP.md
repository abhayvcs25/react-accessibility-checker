# Free AI provider setup

Research and model catalog checked against official sources on November 3,
2026. Free-tier limits and model availability can change; recheck the linked
pricing and quota pages before use.

## Selected models

Models are selected for reasoning/code comprehension, context length, API
availability, and verifiable free pricing. Each OpenRouter model is pinned to a
specific `:free` catalog ID and OpenRouter routing is configured with upstream
fallbacks disabled. There are no paid models, paid fallbacks, credits, or
top-ups configured by this project.

| Model / provider | API model ID | Confirmed free API limits | Context window | Official pricing / limits and notes |
|---|---|---|---:|---|
| Gemini 3.8 Flash — Google Gemini Developer API | `gemini-3.8-flash` | Gemini Developer API Free tier lists free input/output tokens. The per-project request and token limits are dynamic; Gemini says active project quotas appear in AI Studio. The current public rate-limit page does not commit to fixed RPM/RPD for this model. | 1,048,576 tokens | [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Strongest direct candidate: Google describes it for complex software engineering and autonomous workflows, and supports structured outputs. Gemini Free-tier content may be used to improve Google products; do not send confidential code unless this policy is acceptable. |
| Gemini 3.6 Flash — Google Gemini Developer API | `gemini-3.6-flash` | Same confirmed Gemini Developer API Free tier; per-project rate limits are account-visible and not a fixed public RPM/RPD guarantee. | 1,048,576 tokens | [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). A second Gemini choice for development/testing; do not treat it as a guaranteed quota increase because limits apply per project. Supports structured output. |
| Recursive Flint — OpenRouter | `recursive/flint-v1.0:free` | OpenRouter free variants: 20 RPM and 50 requests/day when lifetime credits purchased are under $10. No minimum purchase is required for this bracket. | 262,144 tokens | [Free model variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [free limits](https://openrouter.ai/docs/api_reference/limits), [model/API details](https://openrouter.ai/recursive/flint-v1.0:free). Open-weight reasoning MoE developed for coding agents; free capacity may be unavailable, and no paid fallback is permitted. |
| Gemma 4 31B IT — OpenRouter | `google/gemma-4-31b-it:free` | OpenRouter free variants: 20 RPM / 50 RPD in the no-purchase bracket. | 262,144 tokens | [Free model variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [free limits](https://openrouter.ai/docs/api_reference/limits), [model catalog](https://openrouter.ai/models?max_price=0). Large instruction-tuned Google model with reasoning support. Exact free endpoint availability is dynamic; pinned free ID prevents paid routing. |
| Nemotron 3.5 Super VL — OpenRouter | `nvidia/nemotron-3.5-super-vl:free` | OpenRouter free variants: 20 RPM / 50 RPD in the no-purchase bracket. | 1,000,000 tokens | [Free model variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [free limits](https://openrouter.ai/docs/api_reference/limits), [model catalog](https://openrouter.ai/models?max_price=0). Large-context reasoning model with structured output support. Free provider capacity can be intermittent. |
| North Mini Code — OpenRouter | `cohere/north-mini-code:free` | OpenRouter free variants: 20 RPM / 50 RPD in the no-purchase bracket. | 256,000 tokens | [Free model variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [free limits](https://openrouter.ai/docs/api_reference/limits), [model catalog](https://openrouter.ai/models?max_price=0). Cohere describes it as a coding/agent model. Its exact current free entry is verified in the OpenRouter catalog; provider capacity is not guaranteed. |

OpenRouter's published daily free-request allowance is **50 RPD** with fewer
than $10 in lifetime purchased credits; the higher allowance is earned by
purchasing credits and is intentionally not used. Its free model daily count is
shared at the account level across free-model requests, not a per-model daily
token allowance. Free-model routes can be temporarily unavailable. This
application stops on errors/rate limits rather than switching to a paid model.
The benchmark visits configured models one by one and can use multiple requests
from that shared allowance.

Gemini's public pricing page confirms free API input/output tokens for eligible
models, but its exact rate limits are surfaced per project in AI Studio and are
not guaranteed. Configure the local request caps conservatively; the defaults
are app-side safeguards, not published Gemini quotas. Do not infer a free-tier
daily quota from the model's context window or from another project.
If the Google free quota is exhausted, requests are not upgraded or routed to a
paid tier by this code.

### Why not Cerebras or Groq?

Cerebras' official rate-limit documentation explicitly says its Shared
Inference “Free Trial” requires adding a verified payment method, includes
expiring credits, and that no permanent no-cost tier is currently offered.
Therefore Cerebras is excluded. Groq publishes model prices and Developer-plan
limits, but the official materials checked do not confirm a persistent free
inference/API quota for the selected models; advertised Developer-plan limits
are not treated as free. OpenRouter free variants are used only with exact
`:free` model IDs and provider fallbacks disabled.

## Create and configure keys

- Google Gemini API key: [Google AI Studio API keys](https://aistudio.google.com/api-keys).
- OpenRouter key: [OpenRouter API keys](https://openrouter.ai/settings/keys).

From the repository root in PowerShell, copy the example and add the key for
the selected provider to `backend/.env`:

```powershell
Copy-Item .env.example backend\.env
```

The example selects the online Gemini 3.8 Flash model by default. Keep
`RAC_AI_ENABLED=1` to send eligible assessments to that model. To disable
remote assessments, set it to `0`; the analyzer will not fall back to Qwen.
The development entry point enables remote assessment by default when this
setting is omitted.

Add only the key for the chosen model provider:

```dotenv
GEMINI_API_KEY=your-key-from-ai-studio
```

or:

```dotenv
OPENROUTER_API_KEY=your-key-from-openrouter
```

The strings above are setup examples, not keys; no key is embedded in code or
committed. The root `.gitignore` ignores `.env` files. Never put keys in the
frontend. OpenRouter may require a non-negative account balance for access even
to free models; this project will not add credits or attempt to resolve such
account restrictions. Do not configure billing, purchase credits, or enable
top-ups for this project. For Gemini, use a Free-tier AI Studio project with no
linked billing account; this code cannot override billing configured on the
Google project itself.

## Change the model

Set one exact model ID in `backend/.env` and restart the backend:

```dotenv
RAC_AI_MODEL=gemini-3.8-flash
```

Supported values:

- `gemini-3.8-flash`
- `gemini-3.6-flash`
- `recursive/flint-v1.0:free`
- `google/gemma-4-31b-it:free`
- `nvidia/nemotron-3.5-super-vl:free`
- `cohere/north-mini-code:free`

Gemini models require `GEMINI_API_KEY`; OpenRouter models require
`OPENROUTER_API_KEY`. Provider selection is derived from the exact selected
model. Paid models, fallback arrays, and
OpenRouter's `openrouter/free` dynamic router are deliberately not configured.
Each request names its fixed free model, and the OpenRouter request explicitly
sets `provider.allow_fallbacks` to false.

After configuring the key, enable the selected remote model:

```dotenv
RAC_AI_ENABLED=1
```

Then start the backend:

```powershell
npm --prefix backend run dev
```

## Free-usage safeguards

| Setting | Default | Behavior |
|---|---:|---|
| `RAC_AI_CONCURRENCY` | `2` | In-flight HTTP request ceiling, configurable up to 10 and enforced process-wide per provider. |
| `RAC_AI_REQUESTS_PER_MINUTE` | `5` | Local request cap. OpenRouter's documented free limit is 20 RPM; Gemini's actual per-project limit is dynamic. Confirm project limits before raising. |
| `RAC_AI_TOKENS_PER_MINUTE` | `20000` | Local cap; actual provider/project limits may be lower. |
| `RAC_AI_MAX_OUTPUT_TOKENS` | `512` | Maximum output allowance sent to the provider (capped at 512). |
| `RAC_AI_MAX_RETRIES` | `2` | Bounded retries for transient errors; same exact model only. |
| `RAC_AI_CACHE_TTL_MS` | `43200000` | In-memory response cache; evidence is not written to disk. |

Every eligible candidate in an analysis is sent to the selected online model,
and the API response waits for those requests to finish. There is no
per-analysis candidate cap or model-request deadline. Provider errors,
local per-minute request/token safeguards, and provider-enforced free-tier
quotas still apply. The application does not impose a separate daily request or
token ceiling; provider quota errors are reported only after the provider
returns them. Legacy `RAC_AI_DAILY_REQUEST_BUDGET`,
`RAC_AI_DAILY_TOKEN_BUDGET`, and `RAC_AI_BUDGET_WARNING_RATIO` settings are
ignored.

Usage includes input/output tokens, estimated cost (always zero for these
verified free routes), requests per model, rate-limit responses, latency and
analysis duration. Each HTTP retry counts as an individual request; provider
token counts are recorded when available, with conservative estimates tracked
separately when a response has no usage metadata. The local ledger is stored
outside the repository by default under
`%LOCALAPPDATA%\ReactAccessibilityChecker\ai-usage.json`.
Its daily window changes at midnight Pacific time, matching Google's published
Gemini requests-per-day reset boundary; the ledger is for reporting and does
not block requests.
Provider-side usage can include other clients sharing a key, so keep external
usage within your zero-cost quota too.

The backend runs a non-blocking startup check against the selected model only
when `RAC_AI_ENABLED=1`. The check is not blocked by locally recorded daily
usage. An unavailable AI provider does not prevent the IBM Equal Access
analysis service from starting. `GET /api/ai/health` reports
`connected`, `checking`, `unavailable`, or `disabled`; its HTTP status is 200
only when the selected model connection has been validated.

## Connection test and benchmark

These are opt-in commands and only make external calls when a key is set:

```powershell
npm --prefix backend run ai:test-connection
npm --prefix backend run benchmark:ai
```

No connection or assessment quality is claimed without running these against a
valid configured key. The benchmark sends identical small evidence cases to
each configured free model and reports latency, token usage, JSON validity and
agreement with hand-written labels. It is a smoke comparison, not a validated
WCAG accuracy study. For OpenRouter it may consume the 50 shared free daily
requests; run only when intended.

## Data and scope notes

Remote assessment sends bounded extracted evidence for an eligible target, not
the entire source project. Google documents that Gemini Free-tier content may
be used to improve its products. Review each provider's current data-retention
and training policies before sending source code, and do not send confidential
or personal content unless permitted.

The active contextual evaluator currently implements three rules;
[`contextual-accessibility-rules.md`](./contextual-accessibility-rules.md)
describes 20 proposed checks but does not approve or implement those rules.
Provider changes do not expand rule coverage or alter IBM Equal Access results.
