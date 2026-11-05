# Six-Model AI Migration — Implementation Roadmap

## Objective

Guide a future, sequential migration from the current single-selected-model AI
assessment to the six-candidate, direct-Groq-and-Cloudflare architecture in
`prompt.txt`. This roadmap is a plan only; it does not assert that any target
provider or model has been verified or implemented.

## Existing state and relevant files

Repository root: `D:\react-accessibility-checker`.

The inspection for this roadmap found:

- The IBM Equal Access checker is called by `backend/src/services/checker.ts`;
  it runs independently of contextual AI. Treat its logic, report findings,
  severity, counts, and tests as protected.
- V2 HTML context extraction and adapters exist in
  `backend/src/services/contextExtractionV2.ts`,
  `backend/src/services/contextAdapterV2.ts`, and
  `backend/src/services/contextExtractionProject.ts`. The latter handles
  supplied HTML documents; this is not evidence of React source-tree parsing.
- Contextual remote assessments currently use one selected model through
  `backend/src/services/contextualAssessment.ts`,
  `backend/src/services/remoteAssessment.ts`, and
  `backend/src/ai/providerClient.ts`.
- `backend/src/ai/config.ts` currently lists two Gemini IDs and four
  OpenRouter IDs. `backend/src/ai/rateLimiter.ts` and `usage.ts` implement
  local pacing and a persisted JSON usage ledger. That usage ledger is not
  automatically a persistent assessment-batch/idempotency ledger.
- Experimental/local Qwen code and tests exist under
  `backend/src/services/qwen*.ts` and `backend/__tests__/services/qwen*.test.ts`.
- The backend uses Express, `accessibility-checker`, `parse5`, TypeScript, and
  Vitest. The frontend is React/TypeScript/Vite. No SQL/database package was
  evident in the backend manifest during inspection; verify actual persistence
  and imports before choosing storage.
- `README.md`, `docs/AI_PROVIDER_SETUP.md`, and
  `docs/phase-4.1-model-selection.md` contain prior AI decisions and may not
  all describe current behavior consistently. Audit before changing them.
- `prompt.txt` is the authoritative specification and must remain unchanged.
  The root `.env` exists: never read, print, copy, or commit its contents.

These are inspection findings, not a substitute for the Phase A audit.
Reconfirm them against the live worktree when each implementation prompt is
started.

## Exact implementation tasks

Run the numbered prompts in order:

| Order | Prompt | Main outcome | Complexity | Dependency / review gate |
|---|---|---|---|---|
| 01 | `01-repository-audit.md` | Evidence-based audit report; no code changes | Medium | First; human approves audit before proceeding |
| 02 | `02-official-provider-verification.md` | Official-source verification matrix for six candidates | High | 01; stop per unverified candidate; human reviews model eligibility |
| 03 | `03-architecture-and-migration-design.md` | Approved architecture and migration document | High | 01–02; human approval required before cleanup |
| 04 | `04-retire-local-qwen.md` | Remove only proven-obsolete local Qwen path | Medium | 03 approval; preserve shared code; verify tests |
| 05 | `05-retire-single-model-ai.md` | Remove obsolete Gemini/OpenRouter single-model path | High | 04; preserve extraction, usage visibility if reused, IBM |
| 06 | `06-shared-model-configuration.md` | Verified six-model catalog and provider contracts | Medium | 02–05; only verified/free candidates |
| 07 | `07-groq-provider-client.md` | Mock-tested direct Groq client for verified candidates | High | 06; no live inference |
| 08 | `08-cloudflare-provider-client.md` | Mock-tested direct Cloudflare client for verified candidates | High | 06; no live inference |
| 09 | `09-persistent-batch-ledger.md` | Persistent batch/job state and deterministic idempotency | High | 03, 06–08; human review of persistence choice |
| 10 | `10-bounded-six-model-scheduler.md` | Bounded multi-model job scheduling and isolation | High | 06–09 |
| 11 | `11-assessment-normalization-validation.md` | Strict common contract and validation | High | 06–10 |
| 12 | `12-report-aggregation-and-fixing-prompt.md` | Separate AI/IBM results, disagreements, one fixing prompt | High | 03, 09–11; human UX review |
| 13 | `13-local-verification-and-tomorrow-test-plan.md` | Local-only verification and tomorrow's gated live-test plan | Medium | 04–12; human approval before any live testing |

Phase mapping follows `prompt.txt`: A = 01, B = 02, C = 03, D = 04–05,
E = 06–08, F = 09–10, G = 11, H = 12, and today's verification/test-plan
work = 13.

## Constraints and things that must not change

- Follow `prompt.txt` and these prompts in order. Do not start implementation
  before human approval of the audit, provider verification, and architecture
  at the stated gates.
- Preserve the IBM checker and its authoritative findings. AI assessments
  remain advisory, separate, and never a dependency of IBM execution.
- Reuse Phase 3 extraction, adapters, and evidence types. Do not claim that
  current extraction analyzes an entire React source project.
- Keep the requested six candidates and two direct providers only when verified
  by official documentation. Do not silently substitute models.
- Strict budget is ₹0. No billing, paid routes, paid fallback, or automatic
  model substitution. Free-tier availability must be established per candidate
  and verified in the appropriate official account dashboard where needed.
- Never send live model prompts during the implementation/local-verification
  work. Mock provider calls. No test may spend quota.
- Preserve useful shared infrastructure and unrelated worktree changes. Never
  read `.env` secrets or alter `prompt.txt`.

## Dependencies on previous steps

Every prompt depends on all earlier prompts unless its file says otherwise.
If a candidate/provider is unavailable or not verifiable as free, stop that
candidate's integration and report it; do not bypass the approval gates or
pretend six-model execution is complete.

## Expected files and outputs

Each numbered prompt is a self-contained implementation instruction. Future
work is expected to produce the deliverables listed in those prompts, including
the audit, official verification, architecture, and live-test-plan documents
under `docs/ai/`. This roadmap folder contains prompts only, not implementation
deliverables.

## Verification and testing requirements

- For future implementation steps, use focused mocked tests, existing backend
  tests, frontend lint/build when frontend code changes, backend TypeScript
  build, and `git diff --check`.
- Verify IBM behavior remains unchanged by inspection and existing tests.
- Keep live inference and provider account/quota consumption out of local
  implementation verification.
- Record exactly what was tested and distinguish mock/local verification from
  live verification.

## Completion criteria

- Every prompt from 01 through 13 is completed in order, with gates approved.
- Each step's deliverables and tests meet its own completion criteria.
- Unverified model properties remain explicitly unknown; unavailable models are
  not substituted.
- No implementation is considered live-verified until the user separately
  approves and executes the tomorrow test plan.

## Checkpoints requiring human approval

1. After 01: approve the audit and the proposed cleanup scope.
2. After 02: approve verified/free model candidates and any unavailable entries.
3. After 03: approve architecture, storage, and migration plan before deletion.
4. After 09: review idempotency and persistence behavior before scheduler work.
5. After 12: review report aggregation and fixing-prompt UX.
6. After 13: separately approve any live provider tests; do not infer consent.

