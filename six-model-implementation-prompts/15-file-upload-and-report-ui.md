# 15 — File Submission and Combined Report UI

## Objective

Let a user submit a supported accessibility-checker input and view one report
with IBM findings and contextual AI assessments in separate, clearly labeled
sections.

## Preconditions

- Prompts 12–14 are complete and reviewed.
- Read the frontend design instructions before editing React or CSS.
- Inspect the current upload/input flow and the exact backend request/response
  contracts before changing UI behavior.

## Exact implementation tasks

1. Preserve the existing supported input types and request validation. Do not
   imply that arbitrary project archives or multi-page React applications are
   supported unless the existing extraction path actually supports them.
2. Display the IBM result in its existing authoritative section without
   changing its labels, counts, severity, or behavior.
3. Add a distinct contextual-assessment section showing all six candidate
   outcomes with provider/model attribution, status, validation state, and
   concise safe error information. Distinguish blocked/not-run/failed/
   insufficient-context/succeeded states.
4. Display grouped AI advisory findings and disagreement while retaining
   per-model provenance. Never merge AI results into IBM findings or use model
   agreement to change IBM severity or WCAG conformance.
5. Present the consolidated fixing prompt as read-only, clearly labeled text
   that the user may copy for an external coding assistant. Do not edit
   submitted files or apply fixes automatically.
6. Provide accessible loading, error, empty, partial-success, and
   cancellation states. Do not claim six-model completion when any model
   lacked a validated result.

## Constraints

- Do not place API keys or provider credentials in the browser or frontend
  build.
- Do not expose raw provider payloads, unbounded source content, or secrets.
- Preserve existing IBM report UX and the project's design tokens and
  responsive/accessibility requirements.
- Do not make provider calls from the frontend.

## Tests and verification

- Test the report UI with IBM-only, all-blocked, all-success, partial-failure,
  disagreement, and invalid-result fixtures.
- Verify IBM fields remain unchanged and separate from AI fields.
- Run relevant frontend tests, lint, and build; run backend contract tests and
  `git diff --check`.

## Completion gate

The UI can submit the currently supported file/input and present a truthful
combined report with separate IBM and AI sections, including partial outcomes
and the read-only fixing prompt. Do not perform live model tests here.
