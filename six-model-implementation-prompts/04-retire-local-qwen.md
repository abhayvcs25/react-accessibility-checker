# 04 — Retire the Obsolete Local Qwen Assessment Path

## Objective

Remove only the existing local Qwen execution path after its usage has been
confirmed and the architecture has been approved.

## Existing state and relevant files

Audit leads include `backend/src/services/qwenModel.ts`,
`qwenModelWorker.ts`, `qwenAssessment.ts`, related Qwen tests, and the
`@huggingface/transformers` dependency. These may have standalone smoke-test
uses; inspect all imports, scripts, docs, and package-lock references before
deciding what is obsolete.

## Exact implementation tasks

1. Reconfirm exact Qwen call sites and whether any Qwen types/helpers are
   shared with context extraction or IBM.
2. Remove the local Qwen assessment/model execution and Qwen-only tests/scripts
   that are not retained for an explicitly approved reason.
3. Remove Transformers/model-specific assets or dependency only if proven
   exclusive to this path and lockfile changes are correct.
4. Update only directly related documentation to describe the actual
   transitional state and future single six-model pipeline.
5. Preserve reusable naming evidence and context helpers by extracting or
   retaining shared code if necessary. Do not duplicate these utilities.

## Constraints and things that must not change

- Do not modify IBM code, extraction, shared types/evidence, or unrelated
  worktree files.
- Do not delete based on filename alone; establish import/reference evidence.
- Do not remove Gemini/OpenRouter or other legacy paths in this step.
- No live inference, API calls, billing, or secrets access.

## Dependencies on previous steps

Requires approved 01–03 and the human cleanup-scope approval. Must precede
retiring the old selected-model implementation in 05.

## Expected files and outputs

- Only confirmed Qwen-only source/tests/docs and, if justified, package
  manifest/lock entries.
- A concise completion summary listing every removed/retained file and its
  reference evidence.

## Verification and testing requirements

- Search all imports/usages before and after each removal.
- Run focused tests for affected shared code and the backend test suite/build.
- Run `git diff --check`; confirm IBM files and tests are unchanged.
- Do not run optional live or local model-generation smoke tests.

## Completion criteria

No active competing local Qwen assessment path remains, shared context/evidence
still builds and tests, and IBM behavior is preserved. If Qwen is used by a
non-AI feature or cannot safely be removed, stop and request a narrower
decision instead of deleting it.

