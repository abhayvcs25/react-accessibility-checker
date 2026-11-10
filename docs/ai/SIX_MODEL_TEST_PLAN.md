# Six-Model Local Verification and Gated Test Plan

**Prepared:** 2026-11-10
**Live execution status:** Earlier Groq and Cloudflare probes were rejected
with HTTP 400. A later approved greeting phase returned HTTP 200 from all
three Cloudflare models and reported usage, but no usable completed greeting
was accepted. A subsequent strict-schema probe returned a matching greeting
object from Nemotron; GLM and Gemma did not complete valid output. This
was followed by a six-model uploaded-HTML extraction run on the corrected
Cloudflare AI Run format. Four models returned schema-valid extraction JSON;
both Groq GPT-OSS models initially returned HTTP 400 `json_validate_failed`.
A subsequent Groq-only run with a strict-compatible schema returned valid
extractions from both models. No accessibility findings were requested, and
all six candidates are now operator-enabled for supervised live evaluation,
but remain only partially verified for accessibility assessment.
**Current readiness:** The scheduler is connected to `POST /api/analyze`
behind the explicit server-side `RAC_CONTEXTUAL_AI_ENABLED` opt-in, which
remains `false` in the local backend environment. No provider requests will
run from the website until this separate opt-in is changed.

## Local verification performed

The following checks use existing tests, mocked provider transports, and local
build tools only:

| Check | Command | Result |
|---|---|---|
| Backend unit tests | `cd backend; npm test` | Pass |
| Backend TypeScript build | `cd backend; npm run build` | Pass |
| Frontend lint | `cd frontend; npm run lint` | Pass |
| Frontend production build | `cd frontend; npm run build` | Pass |
| Patch whitespace check | `git diff --check` | Pass |

Focused mocked coverage exists for the Groq and Cloudflare adapters,
normalization/validation, bounded scheduling and failure isolation, SQLite
batch/job idempotency and recovery, advisory aggregation, and fixing-prompt
generation. The test suite injects provider transports; adapter tests verify
they do not fall through to external network access. The analyze-route tests
use a loopback HTTP server, not a provider.

IBM code and regression tests were inspected. `checker.ts` still sends the
original HTML to IBM Equal Access, maps IBM report results to `issues`, and
derives summary counts solely from IBM's summary. Advisory aggregation runs
after the IBM response and receives a separate value; existing IBM tests and
the context-failure regression pass. No IBM execution, rule, severity, issue,
or count logic was changed for the advisory report.

The current change set includes report/API/UI and aggregation updates. All six
models are now operator-enabled for supervised evaluation, with verification
still partial; credentials and billing configuration were not changed. A
separate opt-in Cloudflare probe CLI now supports one greeting
phase and a separately confirmed strict-JSON phase. The approved greeting
phase sent three requests sequentially, at least five seconds apart, with a
32-token output cap, 60-second timeout, and no retries. All returned HTTP 200
with usage counts (90 input and 96 output tokens total), but no usable completed
greeting was accepted. A subsequent command intended for GLM only mistakenly
sent one request to each model at a 64-token cap; this was disclosed. One
approved GLM-only greeting with a 200-token cap returned `Hello` and model
reasoning text. No secret values were retained, and no post-run billing
dashboard check was reported.

The separately authorized strict-JSON phase then sent one `strict: true`
request to each Cloudflare model sequentially, with a 512-token cap, 60-second
timeout, and up to three total attempts only for transient failures. All three
responded on the first attempt, so no retries occurred; incomplete or invalid
completion output is not treated as a transient provider error. Nemotron returned a
schema-shaped `{"greeting":"Hello!"}` result (32 input / 160 output tokens);
GLM used 22 / 512 tokens and Gemma used 32 / 512 tokens, both ending at the
token limit without a usable completion. Operator-provided preflight was
9,977 Neurons; no post-run dashboard balance/cost check was reported. Details
and request IDs are in the provider verification report.

**Endpoint correction:** Earlier live probes used the former
OpenAI-compatible Chat Completions route. The Cloudflare adapter and probe
script now use the operator-provided native AI Run endpoint and nested `input`
request shape. The current six-model run verified successful extraction
responses from that route, but does not establish production accessibility
assessment behavior or accuracy.

**Current six-model run:** With fresh operator confirmation of Workers Free,
no paid path, and 10,000 Neurons, `D:\test-3.html` was sent sequentially to
all six models using the supplied extraction schema, 512 output-token cap,
60-second timeout, at least five seconds between request starts, and no more
than three attempts per model for explicitly transient failures. No retry was
triggered. Qwen and all three Cloudflare models returned HTTP 200 and passed
basic shape validation; Groq GPT-OSS 120B/20B returned HTTP 400
`json_validate_failed` and were not retried. The four outputs extracted the
same title/headings/link but differed in paragraph serialization. This run
confirmed response handling for the new Cloudflare AI Run route, but did not
produce WCAG/accessibility findings because the schema requested HTML content
extraction only. No post-run balance/cost check was reported. Details and
request IDs are in the provider verification report.

**Groq GPT-OSS follow-up:** After the operator confirmed key rotation and no
paid billing path, one sequential request was sent to each GPT-OSS model using
a strict-compatible schema (all fields required; `additionalProperties:
false` at every object), `include_reasoning: false`, low reasoning effort, a
512-token completion cap, and a 45-second client timeout. The prompt requested
no more than 100 words; the operator accepted longer output if returned. Both
models returned HTTP 200, finished normally, passed local shape validation,
and produced 62-word extractions. Responses contained only the JSON answer,
with no reasoning field. These extraction probes do not establish accessibility
assessment accuracy or production readiness; model verification remains
partial. Post-call billing status was not checked. Request IDs and usage are
recorded in the provider verification report.

**Strict-schema result:** All six exact model IDs have now returned a
schema-valid answer for at least one bounded HTML extraction request. This
confirms those request paths can produce a matching JSON shape on those
probes; it does not confirm the stricter production assessment schema,
evidence-grounded violation classification, or assessment accuracy.

## Candidates and current blockers

All candidates below are **partially verified and operator-enabled for
supervised live evaluation**. Each has returned a schema-valid HTML extraction,
but production assessment behavior, exact assessment-schema validation, and
violation classification have not been established. Review every live result
against the operator's known-case files before making any claim of assessment
accuracy or broader production readiness.

| Provider | Exact candidate ID | Current status |
|---|---|---|
| Groq | `openai/gpt-oss-120b` | Evaluation-enabled; verification partial; assessment unverified |
| Groq | `openai/gpt-oss-20b` | Evaluation-enabled; verification partial; assessment unverified |
| Groq | `qwen/qwen3.8-27b` | Evaluation-enabled; verification partial; strict-schema documentation conflict |
| Cloudflare Workers AI | `@cf/zai-org/glm-4.7-flash` | Evaluation-enabled; verification partial; assessment unverified |
| Cloudflare Workers AI | `@cf/nvidia/nemotron-3-120b-a12b` | Evaluation-enabled; verification partial; assessment unverified |
| Cloudflare Workers AI | `@cf/google/gemma-4-26b-a4b-it` | Evaluation-enabled; verification partial; assessment unverified |

No candidate is marked unavailable in the current provider-verification
record, and no replacement model is authorized.

## Mandatory gate before any live step

**Every live step below requires separate, explicit human approval immediately
before execution.** Approval for one step does not authorize later steps.
Provider execution is not enabled by this document.

Before each live step:

1. Recheck first-party model/API documentation and the provider account
   dashboard for the exact provider, model, route, limits, and current terms.
   The account owner must confirm the applicable free plan, the exact model's
   access, and that no paid billing route, payment method, purchased credit,
   auto-recharge, upgrade, gateway credit, or overage can be used. For
   Cloudflare, confirm Workers Free and review the shared daily Neuron balance
   and reset time.
2. Set the approved test budget to **₹0 maximum expected charge**. If an
   account setting, response, route, quota state, price, or possible overage
   makes zero charge uncertain, stop before dispatch. Free-tier eligibility
   is not a guarantee of zero cost. Never add billing, upgrade, switch
   providers, substitute models, or use a paid fallback.
3. Keep execution separately gated from catalog eligibility. All six models
   are enabled for supervised evaluation, but each live run still requires
   explicit approval, current account preflight, and the server-side opt-in.
   Do not expand the enabled candidate set without operator approval.
4. Use only a synthetic, non-sensitive one-component fixture. Never send
   source files, a real project, secrets, credentials, personal data, or
   unrestricted HTML. Set a short timeout and abort signal; do not allow
   unbounded retries or parallel work.
5. Abort immediately on a billing/paid-route indication, unexpected model ID,
   unclear quota or charge, authentication/entitlement mismatch, unsafe
   response, credential exposure, malformed/unbounded response, daily quota
   exhaustion, or unexpected request count. Do not retry quota exhaustion or
   an uncertain post-dispatch outcome.
6. Redact prompts, source/evidence text, authorization headers, tokens, and
   account identifiers from logs and evidence. Record only the test ID,
   provider/model, timestamp, bounded status/error class, safe request ID if
   available, validation result, and token counts/source. Provider-side
   retention cannot be undone by local cleanup; verify and accept applicable
   retention terms before sending anything.
7. After each step, disable the test path, remove only its named temporary
   fixtures and temporary ledger/database, and verify no test request remains
   queued. Never delete the normal SQLite ledger or usage history as cleanup.
   Retain the redacted test record and evidence of the account preflight.

If any prerequisite is unavailable, skip that step and keep the affected
model/provider blocked. No step should be run merely because it appears in the
sequence.

## Ordered test sequence

The request counts below are hard per-step maxima, not targets. “₹0” is the
required expected charge under the preflight above, not a provider guarantee.
Any uncertainty means no request.

| # | Scenario and execution | Explicit opt-in and free/account preflight | Maximum requests and expected charge | Abort conditions | Redaction, cleanup, and success evidence |
|---|---|---|---|---|---|
| 1 | **Individual provider connection tests.** After a provider/model-specific integration and eligibility gate exists, make one minimal, bounded completion using one approved model per provider. This is a real inference request, not a no-cost health ping. | Obtain separate approval for each provider and named model. Confirm the exact model is allowed, billing is disabled/non-billable, account limits and remaining quota are visible, and the request path cannot select another route. | At most 1 completion for Groq and 1 for Cloudflare (2 total); a small synthetic input and output cap no greater than 32 tokens per request. Expected charge ₹0; stop if not assured. | Any paid-route possibility, missing entitlement/limits, credentials issue, non-success response, or quota exhaustion. Do not try another model automatically. | Redact credentials and body. Delete the synthetic fixture and temporary logs. Success is a bounded response from the exact requested model, with safe request metadata and no charge/quota ambiguity; this verifies only that individual request, not assessment quality. |
| 2 | **One small assessment per model.** Send one synthetic one-component assessment to each exact candidate, only after the individual candidate passes its own gate. | Separate approval naming each of the six IDs. Recheck zero-cost account state and available quota before every model; never dispatch blocked candidates. | At most 1 small request per model (6 total); output cap no greater than 64 tokens per request. Expected charge ₹0; stop rather than continue if any model's free eligibility is unclear. | Stop only the failing model on its model-specific error; stop the whole provider if billing, shared quota, or route safety is uncertain. No substitution or retries after uncertain outcomes. | Redact synthetic prompt/response from logs and remove local raw captures after validation. Success requires exact provider/model attribution, a complete response, and an explicitly recorded validation outcome for each attempted model. |
| 3 | **JSON completion and validation.** First replay Step 2's redacted/canonical fixtures through local parsers and validators. If an exact-model schema behavior still needs live confirmation, run a separate minimal structured-output completion for that model. | Local replay needs no provider approval. Any supplemental live check needs new approval for each named model and the complete free/account preflight. | Local: 0 requests. Optional live confirmation: at most 1 per model (6 total), synthetic payload, output cap no greater than 64 tokens. Expected charge ₹0. | Reject invalid JSON, wrong schema/identity/evidence, incomplete finish reason, unsupported schema, or excessive output; do not retry an invalid or incomplete response automatically. | Redact payloads and delete raw fixture copies after retaining a redacted validation summary. Success is strict parser/semantic validation with the exact request identity; JSON mode alone is not success. |
| 4 | **Output-token limit tests.** Verify locally that configured limits reject values above the application cap. If a provider's acceptance of a low cap needs runtime proof, test a small cap, not the model maximum. | Local check needs no provider approval. Supplemental live check requires separate named-model approval and free/account preflight. | Local: 0 requests. Optional live check: at most 1 per model (6 total), request cap no greater than 64 generated tokens and never above the configured 2,048-token application cap. Expected charge ₹0. | Stop if the provider ignores/rejects the cap, reports unexpected output usage, or suggests a paid tier. Do not probe a model maximum by requesting long output. | Retain only reported token count/source and finish status; delete raw output. Success is a response within the requested low bound plus a passing local over-cap rejection test. |
| 5 | **Sequential execution test.** With explicitly approved models, submit a small bounded batch and verify requests never overlap across providers or models. | Separate explicit approval naming every candidate; recheck both provider accounts and quota. All six are catalog-enabled for supervised evaluation, but only run the specifically approved set. | At most 1 request per eligible model, 6 total; maximum global concurrency is 1. Cloudflare requests must also be spaced by at least five seconds. Expected charge ₹0. | Abort on any provider/account stop condition, overlap, cancellation failure, or unexpected request. No unbounded `Promise.all` or automatic fill-in model. | Redact request/response data and remove the temporary batch. Success is measured global concurrency of 1, truthful per-model results, and no effect on IBM output. |
| 6 | **Batch tracking.** Exercise batch/job/attempt/result state transitions and report rendering locally with fixtures. This is not a provider health check. | No live provider opt-in; use isolated temporary SQLite storage and mocked results only. | 0 provider requests; ₹0. | Stop on writes outside the temporary ledger, unsafe result identity, lost state, or any unexpected network access. | Remove only the test database and fixtures. Success is durable local state for batch, model/job, attempts, validation, token provenance, and partial outcomes, with no raw credential/source persistence. |
| 7 | **Duplicate request prevention.** Submit identical test jobs concurrently and after ledger restart against isolated storage; test that valid completion is reused and in-flight work is joined. | Mock-only; no provider credentials required. Never run a live duplicate to prove idempotency. | 0 provider requests; ₹0. | Stop if duplicate keys create duplicate jobs/attempts, if changed snapshot data is incorrectly reused, or if an uncertain result is automatically resent. | Remove only the isolated test database. Success is one durable job/dispatch for identical inputs, reuse of its validated result, and distinct keys for changed snapshot/model/context. |
| 8 | **Rate-limit and retry.** Inject deterministic 429/`Retry-After`, transient capacity errors, quota exhaustion, and unknown outcomes into mock transports. Observe the bounded retry policy. | Mock-only; do not intentionally trigger a live limit. A naturally occurring provider rate-limit response during an already approved test is recorded and handled within the approved cap. | 0 additional requests for this test; ₹0. For a natural temporary 429 only, at most the single retry already authorized for that request and within documented limits; never retry quota exhaustion or uncertain outcomes. | Abort on daily/shared quota, missing/ambiguous retry scope, excessive `Retry-After`, or attempt-cap breach. Never create load to force a 429. | Redact headers and retain only safe retry delay/classification. Success is mock evidence that retry timing is bounded and correct, with no automatic resend for terminal/unknown outcomes. |
| 9 | **Partial provider failure.** Use mock transports to fail one provider/model while another succeeds; verify scheduler and report preserve both states. | Mock-only for the failure simulation. A naturally failing model in a separately approved live run may be observed, but do not use bad credentials or harmful prompts to induce it. | 0 additional requests for this test; ₹0. If observed during an approved run, do not exceed that step's request cap. | Stop only the failed model when failure is model-scoped; stop the provider for account/billing/quota safety issues. No fallback or fake negative result. | Redact error bodies and credentials. Success is a report showing the real success and failure independently, with failed work excluded from findings and fixing prompts. |
| 10 | **Repeated analysis with unchanged project snapshot.** Test idempotency locally first. The analysis route prepares stable content/snapshot identities; live execution still requires the server opt-in, exact-model approval, and account preflight. | Local/mock check needs no live approval. For a future live check, separately approve the named eligible models and exact snapshot; confirm no prior provider work will be unintentionally repeated. | Local: 0 requests. Future live: at most 1 request per approved model for the first run; the identical second run must dispatch 0. Expected charge ₹0. | Abort if the repeated run dispatches again, the snapshot identity is unstable, or an uncertain result is resent. Catalog eligibility alone does not dispatch provider jobs. | Use synthetic fixture; redact and remove it and the temporary ledger after recording redacted IDs/status. Success is first-run bounded work followed by exact reuse and zero second-run provider attempts. |
| 11 | **Changed project snapshot.** Verify local idempotency creates new snapshot/job identity when content changes. Future live check only after snapshot integration and separate approval. | Local/mock check needs no live approval. Future live approval must name both synthetic snapshots and eligible models; repeat the full zero-cost account preflight. | Local: 0 requests. Future live: at most 1 per eligible model for the changed snapshot; expected charge ₹0. | Abort if unchanged content is treated as changed, changed content reuses stale results, or the new run exceeds the bound. Current route is single-HTML and does not provide React project identity. | Use two synthetic fixtures only; remove both and the temporary ledger. Success is distinct content hashes/idempotency keys and no stale finding reuse. |
| 12 | **Full 10–20-page project simulation.** Defer until React source extraction, component/rule job preparation, bounded project context, and project snapshot identity exist and are reviewed. It is not supported by the present single-HTML `/api/analyze` request path. | Requires a new explicit approval after React extraction and the complete account/free-tier preflight for each eligible model. Review the intended project corpus and privacy/retention terms before any send. | No request until prerequisites pass. Then use only a synthetic or explicitly authorized low-sensitivity project, preflight the job count, and require a separate cap approved for the exact batch; stop before dispatch if expected charge cannot be kept at ₹0. No automatic 10–20 page fan-out. | Abort before dispatch on unbounded job expansion, missing extraction/completeness limits, unclear free quota, unsafe data, or any paid route. Cancel remaining work on any hard stop. | Do not upload a real project by default. Redact per-job evidence and remove the named temporary project/batch after preserving aggregate test evidence. Success requires reviewed extraction completeness, bounded fair scheduling, durable per-job results, truthful partial states, and no IBM changes. |

## Current execution blockers and approval checkpoint

- All six candidates are operator-enabled for supervised evaluation and
  remain partially verified. HTML-extraction probes returned schema-valid
  output, but accessibility assessment accuracy is untested. The provider
  verification record reports operator-confirmed Groq Free-plan and
  Cloudflare Workers Free access; the exact current Cloudflare balance was
  not provided. Groq's structured-output page remains internally
  contradictory about strict Qwen support. Cloudflare's JSON Mode supported
  list omits these exact models despite successful extraction probes. NVIDIA
  Nemotron 3 120B was listed for planned deprecation on 2026-11-20; recheck
  availability before a live run.
- One approved synthetic assessment request was sent directly to Groq for
  `qwen/qwen3.8-27b` with a 64-token output cap, a 15-second timeout, and no
  retry. Groq returned HTTP 400. The provider response body was not retained,
  so the cause is unknown and no schema validation ran. The operator later
  reported dashboard API-call count 0 and input/output/total tokens 0; cost
  was not reported. This failed request does not verify the model or
  strict-schema support.
- After the operator reported 10,000/10,000 daily free Neurons available and
  approved up to three total attempts for each model, the retry default was
  changed to 3 total attempts, Cloudflare codes 3030/8007 were classified as
  retryable unavailable based on operator-reported dashboard diagnostics, and
  the contextual request timeout was increased to 60 seconds. Local tests and
  backend build pass. Five candidates were probed with synthetic context, the
  application schema, a 200-token cap, 60-second timeout, and no more than 3
  total attempts. Groq GPT-OSS models each returned HTTP 400 and were not
  retried. The three Cloudflare models exhausted 3 attempts each: GLM and
  Nemotron returned code 3030; Gemma returned code 8007. Qwen received one
  additional probe using the updated 200-token cap and 60-second timeout, but
  again returned HTTP 400 and was not retried. Response bodies and completion
  usage were not retained or returned. The operator reports the dashboard
  showed 0/10,000 Neurons used and no cost after the Cloudflare retry run;
  the operator also reports Groq showed 0 API calls, 0 input/output/total
  tokens, and no cost after the latest Qwen call.
  These results do not establish JSON Schema incompatibility or runtime
  verification. No further retry is authorized.
- The Groq and Cloudflare adapters are mock-tested and connected to the
  optional assessment pipeline. With the current blocked model catalog, the
  normal analysis route cannot dispatch a provider job. The route still accepts
  a single HTML document rather than a React project.
- Therefore, live steps 1–5 and 10–12 cannot be considered complete from this
  plan. Steps 6–9 are local/mock tests. Any further live step requires
  separate human approval and eligibility/preflight checks; this document
  itself is not authorization. Do not retry the failed calls without fresh,
  model-specific approval.
- No model behavior, provider connectivity, live JSON conformance, or
  end-to-end six-model execution has been runtime verified.
