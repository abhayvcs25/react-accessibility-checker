# 07 — Direct Groq Provider Client

## Objective

Implement the direct Groq transport adapter for only the verified Groq models.

## Existing state and relevant files

Requires the shared model catalog/contracts from 06 and official Groq findings
from 02. Use Groq's official documented endpoint/auth/request fields and
per-model capabilities; no endpoint or response shape should be inferred from
OpenAI compatibility alone.

## Exact implementation tasks

1. Implement Groq request construction and secure server-side authentication.
2. Apply only verified per-model structured-output settings; where unsupported,
   use the approved prompt strategy followed by strict server-side validation.
3. Normalize transport envelopes and usage/request identifiers into shared
   provider response types.
4. Parse finish reasons, empty/malformed envelopes, quota/rate-limit errors,
   `Retry-After`, timeouts, and permanent errors distinctly.
5. Add isolated, deterministic mocked tests for request/auth redaction, each
   verified model ID, success, malformed/empty responses, limits, and errors.

## Constraints and things that must not change

- Do not invoke provider APIs or perform live inference.
- Do not permit paid route selection, model substitution, OpenRouter fallback,
  or leaking keys.
- Do not bundle Cloudflare transport or scheduler behavior here.
- Preserve provider-specific differences; do not force a shared payload format
  unsupported by Groq.

## Dependencies on previous steps

Requires 02 verification and approved completion of 06. Runs before Cloudflare
client 08; both clients must satisfy the same shared contract.

## Expected files and outputs

- A Groq-only provider client and its mocked unit tests.
- Provider-level setup docs updated only for the verified API configuration.

## Verification and testing requirements

- Mock `fetch` or the repository's existing transport seam; assert no external
  network call is possible in the test.
- Validate all three candidates individually only if 02 verified them.
- Run focused tests, backend build, and `git diff --check`.

## Completion criteria

Every implemented Groq model matches the verified official API contract;
responses/errors are normalized without treating invalid output as success.
Report blocked candidates and do not substitute.

