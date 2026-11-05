# 01 — Repository Audit (Phase A)

## Objective

Produce an evidence-based audit of the repository and migration scope before
any cleanup or implementation.

## Existing state and relevant files

Start from the current worktree, not assumptions. Inspect root structure,
package manifests, Git status, existing Markdown, AI source/tests, Phase 3
extraction/adapters, IBM pipeline/tests, persistence, and imports.

Initial leads to verify include `backend/src/services/checker.ts`,
`contextExtractionV2.ts`, `contextAdapterV2.ts`,
`contextExtractionProject.ts`, `contextualAssessment.ts`,
`remoteAssessment.ts`, `backend/src/ai/*`,
`backend/src/services/qwen*.ts`, `backend/src/routes/ai.ts`,
`backend/__tests__/**`, `docs/**`, and `prompt.txt`.

## Exact implementation tasks

1. Map current request flow from frontend/API through IBM and contextual AI.
2. Inventory all AI model/provider clients, local Qwen code, environment
   settings, retry/rate-limit/accounting logic, health/usage routes, tests, and
   documentation.
3. Inspect import/reference graphs and package usage to classify code and
   dependencies as shared, AI-only, IBM-only, or unknown.
4. Describe the Phase 3 extraction capabilities precisely: current HTML and
   supplied multi-document behavior versus absent/partial React source
   extraction. Do not equate HTML project files with a React project parser.
5. Identify actual database/persistence systems. Determine whether the
   existing JSON usage ledger is suitable for job/batch durability and
   cross-process idempotency; do not choose a new store yet.
6. Compare docs and implementation and call out stale/inconsistent claims.
7. Record protected IBM surfaces and tests, worktree modifications, risks,
   unresolved facts, and a proposed cleanup list with evidence for every item.
8. Do not perform destructive changes or provider/API calls.

## Constraints and things that must not change

- Do not edit/delete application source, tests, package manifests, docs, or
  `prompt.txt` during this audit. The only output is the audit report.
- Never read or reveal `.env`, keys, tokens, user data, or other secrets.
- No live model inference, provider API calls, billing changes, or quota use.
- Do not call Qwen, Gemini, Groq, Cloudflare, or OpenRouter for verification.
- Keep IBM logic and all unrelated worktree changes untouched.

## Dependencies on previous steps

None. This is the first implementation prompt and must precede all other work.

## Expected files and outputs

- Create `docs/ai/REPOSITORY_AI_AUDIT.md`.
- Include an architecture/data-flow summary, file inventory, persistence
  findings, dependency/import evidence, IBM protected-surface list, verified
  current-vs-target comparison, cleanup candidates, risks, and open questions.
- Explicitly label each statement as observed, inferred, or not yet verified.

## Verification and testing requirements

- Verify report paths and claims against the current source and manifests.
- Use read-only inspection and import/reference searches.
- Confirm `git status` shows no application modifications from this audit.
- Do not run network or inference tests.

## Completion criteria

The audit report is complete, distinguishes fact from assumption, identifies
all known legacy AI surfaces and shared code, and recommends no deletion without
dependency evidence. Stop and request human approval of the audit/cleanup scope
before prompt 02 or any destructive work.

