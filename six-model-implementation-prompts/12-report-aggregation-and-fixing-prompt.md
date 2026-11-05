# 12 — Aggregated Report and One Fixing Prompt (Phase H)

## Objective

Integrate IBM's existing report with separate multi-model advisory results,
show disagreements and partial failures accurately, and generate one
consolidated prompt for the user's external coding assistant.

## Existing state and relevant files

Use the approved architecture, persistent job results, and validated
assessments. Inspect `backend/src/services/checker.ts`, shared checker/report
types, analyze route, and frontend report handling before changing contracts.
IBM's response is the protected authoritative result.

## Exact implementation tasks

1. Add aggregation that groups equivalent findings across models without
   deleting provenance; preserve which model/provider assessed which
   component/rule.
2. Define duplicate matching, agreement/disagreement, abstention and
   insufficient-context behavior. Do not turn model vote count into IBM
   severity or WCAG conformance.
3. Represent per-model partial success/failure, provider quota, and validation
   status accurately; one failed model must not hide other outcomes.
4. Keep IBM issues/counts and AI advisory results in separate report fields and
   UI sections.
5. Generate one deterministic consolidated fixing prompt containing actionable
   validated issues, affected component references, evidence, relevant rules,
   model disagreement/uncertainty where relevant, and suggested corrections.
6. Ensure prompt generation is read-only. The user's external coding model,
   not this application, performs edits.

## Constraints and things that must not change

- Do not change IBM checker logic, findings, severity, counts, or execution
  dependency.
- Do not merge advisory AI results into IBM findings.
- Do not implement automatic source modification.
- Respect frontend design/accessibility instructions if editing React/CSS.
- Do not expose secrets or unbounded raw project content in reports/prompts.

## Dependencies on previous steps

Requires approved design (03), ledger/scheduler (09–10), and validated common
assessment outputs (11).

## Expected files and outputs

- Report/API types and aggregation/fixing-prompt generator.
- Frontend display updates only if required by the approved UX.
- Mocked aggregation, disagreement, duplicate, partial-failure, and prompt
  content tests.

## Verification and testing requirements

- Assert IBM output/counts are byte/value-equivalent for unchanged fixtures.
- Test same/different finding grouping and retain per-model provenance.
- Test the prompt excludes failed/unvalidated assessments and asks no model to
  claim unsupported conformance.
- Run backend tests/build, frontend lint/build if changed, and `git diff
  --check`.

## Completion criteria

The report clearly separates IBM from advisory consensus, preserves
disagreement/uncertainty and model attribution, and provides one actionable
fixing prompt without modifying project files.
Stop for human review of report and prompt UX.

