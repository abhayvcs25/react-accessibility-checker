# 06 — Shared Model Catalog and Provider Contracts

## Objective

Introduce the verified six-model configuration and provider-neutral contracts
needed by the direct clients.

## Existing state and relevant files

Requires the approved verification matrix and migration plan. Likely surfaces:
backend AI config/types, secure env-loading patterns, backend config tests, and
documentation. The old config must have been retired in 05.

## Exact implementation tasks

1. Define provider IDs for Groq and Cloudflare Workers AI and model IDs only for
   candidates marked verified/free in `SIX_MODEL_PROVIDER_VERIFICATION.md`.
2. Add explicit per-model provider ID, exact verified API model ID, context and
   output bounds, structured-output capability, and relevant model limits.
3. Define typed provider-neutral request/response/error contracts, including
   timeout, rate-limit, quota, `Retry-After`, incomplete completion, provider
   request ID, and usage metadata.
4. Load provider credentials only from backend environment variables; never
   expose them through API payloads or frontend bundles.
5. Represent unavailable/partially verified models explicitly. Do not assign
   fabricated capabilities or silently substitute another model.
6. Set safe local concurrency/rate-limit values based on verified findings and
   document which are provider limits versus application safeguards.

## Constraints and things that must not change

- No implementation based on unverified IDs/capabilities.
- No secrets in code, logs, frontend, fixtures, or docs.
- No billing, paid models, fallback arrays, or OpenRouter dependency.
- Do not revive the legacy single-selected-model architecture.
- Do not change IBM or Phase 3 code.

## Dependencies on previous steps

Requires 02–05. Candidate-level configuration must follow the approved
verification decision.

## Expected files and outputs

- Typed shared AI config/contracts and focused configuration tests.
- Minimal environment/setup documentation describing only verified models.
- No provider transport implementation in this step.

## Verification and testing requirements

- Unit-test exact model IDs, provider mapping, limits, and unavailable-model
  handling without keys/network.
- Confirm secrets are not serialized into client-facing configuration.
- Backend build, focused tests, `git diff --check`.

## Completion criteria

Every configured candidate maps to official verified data, unverified
candidates cannot be invoked accidentally, and types support both provider
clients without using `any` or success-shaped defaults.

