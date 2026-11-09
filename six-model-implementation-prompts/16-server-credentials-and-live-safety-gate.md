# 16 — Server Credentials and Live Safety Gate

## Objective

Prepare a secure, explicit server-side configuration path for later live
verification, without reading, requesting, printing, or using real
credentials in this prompt.

## Preconditions

- Prompts 14–15 are complete and reviewed.
- Inspect the existing environment loader, provider credential lookup,
  eligibility configuration, server routes, and ignore rules before editing.
- Existing supported credential names are `GROQ_API_KEY`,
  `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`. Reuse them unless a
  concrete defect requires a change.

## Exact implementation tasks

1. Verify and, only if necessary, document a local backend-only `.env` setup.
   Never read existing `.env` contents. Keep local secrets out of source
   control; provide only an empty-name/template example if needed.
2. Keep credentials server-side. Add a safe readiness check that reports only
   whether required variables are present, never their values, prefixes,
   lengths, or provider responses containing them.
3. Keep credential presence separate from model verification, account
   eligibility, operator enablement, and runtime health. Keys alone must
   never make a model eligible or trigger requests.
4. Add a separate, default-off explicit live-test opt-in. It must not be
   exposed as a frontend-controlled flag or enable the normal analysis path
   implicitly.
5. Ensure live-test code has bounded request counts, exact candidate
   allow-listing, cancellation/timeouts, redacted errors, and a hard stop when
   free-tier or account billing safety cannot be established. Never retry
   into paid usage or substitute another model.
6. Document how the operator can place credentials locally and remove them
   afterward. Do not ask the user to paste keys into chat or commit them.

## Constraints

- No provider/network calls, inference, or credentials in tests.
- Do not enable any model or mark it verified.
- Do not change IBM behavior or add a billing route.
- Do not add dependencies unless a demonstrated need requires them.

## Tests and verification

- Test missing/partial/present credential states using fake in-memory values;
  assert responses and logs never contain those values.
- Test that credentials without explicit opt-in do not invoke an adapter.
- Test that default configuration cannot dispatch live requests.
- Run focused backend tests, backend build, and `git diff --check`.

## Completion gate

The server has a documented, private local credential path and a default-off
live-test gate. No credential value was inspected, emitted, or used.
