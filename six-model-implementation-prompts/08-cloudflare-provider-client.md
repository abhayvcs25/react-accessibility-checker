# 08 — Cloudflare Workers AI Provider Client

## Objective

Implement the direct Cloudflare Workers AI transport adapter for only the
verified Cloudflare models.

## Existing state and relevant files

Requires the shared contracts from 06 and official Cloudflare/model findings
from 02. Verify auth, account/worker identifiers, URL form, request fields,
response envelopes, and quotas from Cloudflare's own docs. Never copy secrets
into tests.

## Exact implementation tasks

1. Implement Cloudflare Workers AI request construction, endpoint formation,
   and backend-only credential handling.
2. Apply model-specific output/JSON controls only where official docs confirm
   support for the exact API.
3. Normalize response envelopes, usage/request IDs, finish metadata, and errors
   into shared provider types.
4. Handle timeout, rate limit, quota, retryability, and provider-specific
   response peculiarities distinctly.
5. Add mocked tests for every verified candidate, request shape, redaction,
   success, malformed/empty responses, quota, and transient/permanent errors.

## Constraints and things that must not change

- No live API calls or model inference.
- No paid Workers AI usage, billing changes, paid fallback, or substitutions.
- Do not assume Groq-compatible request semantics.
- Do not modify IBM or extraction.

## Dependencies on previous steps

Requires 02 and approved shared contracts from 06. Must complete before
persistent scheduling integration.

## Expected files and outputs

- A Cloudflare-only provider client and mocked tests.
- Accurate Cloudflare setup documentation for verified models only.

## Verification and testing requirements

- Tests must stub transport and assert correct account/model routing without
  exposing auth values.
- Run focused tests, backend build, and `git diff --check`.

## Completion criteria

Each implemented Cloudflare candidate follows verified documentation and
returns normalized typed outcomes. Any unknown blocks that model; do not
fabricate behavior.

