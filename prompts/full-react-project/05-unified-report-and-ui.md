# Prompt 05 — Unified report and project UI

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md) and [.github/instructions/frontend-design.instructions.md](../../.github/instructions/frontend-design.instructions.md). Prompts 00 through 04 are complete. The API already returns a project index, IBM artifacts, rule coverage, and an advisory report. This prompt shows that result in the existing application and tightens the fixing prompt so an external assistant cannot mistake it for a conformance certificate or an automatic edit.

## Goal

Add the project result to the `project` mode started in prompt 01. One screen, after the user confirms analysis, shows:

- how complete the folder scan was
- IBM findings, separately, per artifact
- model advice, separately, per target and rule
- coverage gaps and rules that were not assessed
- source path and line
- one copyable fixing prompt

The application still does not modify the user's project.

## Prerequisite gate

- `POST` project analysis from prompt 04 returns IBM data and `advisoryReport` in one response after a single upload.
- Frontend modes `html` and `react` still render their current reports. Read the result components in [frontend/src/App.tsx](../../frontend/src/App.tsx) before splitting anything. You may extract a presentational component into `frontend\src\` if `App.tsx` becomes unwieldy. Do not rewrite the HTML report markup except to share a component that preserves its output.
- Design tokens in [frontend/src/tokens.css](../../frontend/src/tokens.css) are the only colors and shadows you use.

## API response the UI must consume

Define a TypeScript type `ProjectAnalyzeResponse` in the frontend that matches the backend JSON. Do not parse with `any`. Mirror the guards already used for `AnalyzeResponse` and `SourceAnalyzeResponse`: if the payload is missing `ibm` or `advisoryReport`, show an error, not a partial success that looks finished.

Required sections:

1. **Scope.** `snapshotId`, `completeness` (`complete` or `partial`), file counts, and the omission reasons from intake and the index. If `completeness` is `partial`, the heading text includes "Partial project scan". Do not show a badge that only says "Passed".
2. **Files.** Relative paths with status `accepted`, `ignored`, `rejected`, `parsed`, `parse-error`, or `omitted`. This list is a disclosure or a scrollable region with a heading, not a wall of text above the findings.
3. **IBM.** For each artifact: `inputKind` (`native-html` or `static-projection`), path or projection id, `shell`, `ibmStatus`, summary counts, and issues. Projection artifacts include the sentence "Static projection. This is not a browser-rendered page." Issues show rule id, level, message, DOM path, and source location when `sourceMapping` is present. When mapping is unavailable, say "Source line not mapped." Do not file IBM issues under a contextual rule id.
4. **Models.** Reuse the existing advisory presentation for model status, job outcomes, and finding groups: agreement, per-model explanation, evidence, and insufficient context. Add the relative path and line on each group. Keep blocked, failed, and invalid jobs out of the finding list. The existing copy that says a missing result is not a negative assessment stays.
5. **Coverage.** A table or definition list of all 20 rule ids. Columns: scheduled count, not-assessed count, and the reason strings. Rules 13, 15, and 19 should be visible as not assessed when the backend withheld them. Candidate groups for rules 6, 14, and 20 show the matched strings and the label "Equivalence not proven."
6. **Fixing prompt.** A text area or preformatted region plus a copy button, following the existing copy feedback pattern. If the backend sent `fixingPrompt: null`, say the prompt is unavailable. Do not synthesize a cheerier prompt in the client.

## Fixing prompt content

Extend the backend prompt builder used by `aggregateAdvisoryReport` only for the project source kind, or add a project-specific builder that the aggregator calls. The prompt is plain text and bounded. Include:

- A first line that this is advisory output from a static scan, not a WCAG conformance statement.
- The snapshot id, completeness, and omission reasons.
- IBM issues grouped by artifact, with path, line when mapped, rule id, and message. Cap the list. If you omit some, say how many were omitted. The existing report's omitted-count behavior is the pattern.
- Model findings that survived validation, with rule id, status, path, line, and the short explanation. Include disagreements as disagreements, not as a single blended verdict.
- Not-assessed rules and the reasons, especially image pixels, computed names, runtime errors, and unproven equivalence.
- An instruction to the external coding assistant: read the cited files before editing, do not apply changes blindly, do not claim the scan covered routes or states that the omission list excludes, and do not treat model advice as an IBM failure.
- No full file bodies, no `.env` contents, and no unmapped source dumps.

The checker application does not write patches, open pull requests, or call an agent API to edit the project.

## UI behavior

- The analysis control in project mode is enabled once a folder is selected. The accessible name is "Analyze project".
- Before the request, the page repeats the consent sentence from prompt 01: eligible HTML is sent to the local IBM checker, and short evidence excerpts are sent to the configured model providers. The control is a button, not an auto-submit on folder selection.
- While the request runs, set `aria-busy` on the results region and disable the button. Honor abort on mode switch, as the HTML mode does.
- On success, move focus to the results heading or announce the completion in a live region. Use a polite live region for completion and an assertive region for the existing error pattern. Do not trap focus.
- Empty IBM and empty model findings still show the coverage section. "No IBM issues in the scanned artifacts" is allowed only next to the scan count and the partial/complete flag. It must not be readable as "the application is accessible."
- Keyboard users can reach the mode switch, folder input, analyze button, file list, findings, and copy button. Focus indicators stay visible. Contrast follows the existing tokens.
- At a narrow width, sections stack. At a wide width, do not invent a three-column analytics dashboard. One main column with the current brutalist borders is enough.
- Do not render raw HTML projections as live HTML. Show them as text if you show them at all. Prefer not showing the full projection. A projection is untrusted content from the user plus your serializer.

## Client parsing

Follow the type guards in `App.tsx`. Check `ibm.artifacts` is an array, each issue has the fields you display, and each advisory finding's `status` is one of the known unions. Unknown model statuses display as their raw string only if the existing formatter already does that. Do not throw away the IBM section when the advisory section fails to parse. Show the part that parsed and an error for the part that did not, so a model-report bug cannot hide IBM results. If the whole body is not JSON, use the existing network error copy.

Point the project request at `http://localhost:3001` and the route you created in prompts 01 through 04. Do not post the folder to `/api/analyze`.

## Tests and verification

Backend:

- A unit test on the fixing prompt builder with a partial scan, one projection IBM issue, one model `potential_issue`, one `insufficient_context`, and a not-assessed rule. Assert the prompt contains the path, the static-projection warning, the not-assessed reason, and the instruction not to edit blindly. Assert it does not contain `NOT_EVIDENCE_SENTINEL`.
- The HTML and single-file fixing prompts still match their existing tests. If they share a builder, run those tests and keep their wording unless a shared sentence must change. Prefer a branch for `react-project`.

Frontend:

- `npm run lint` and `npm run build` from `frontend\`.
- Browser verification is required. Start the backend and the Vite app if they are not already running. Exercise project mode: select a folder that contains at least two components where one imports the other, run analysis, and confirm the page shows separate IBM and model sections plus coverage. Then run the HTML mode on a small HTML file and the React mode on a single `.tsx` file and confirm those reports still render. Also check a narrow viewport by resizing the window. If a mode cannot reach the backend, fix the client or server bug and re-check. Do not finish on a screenshot of an empty state.

If browser tools are unavailable, say exactly which clicks you could not perform.

## Acceptance

- A partial multi-file scan cannot be read as a full WCAG pass.
- IBM issues and model findings are visually and structurally separate.
- Every displayed source reference has a relative path and, when known, a line.
- The copyable prompt tells an assistant to inspect and not to treat the scan as complete coverage.
- HTML mode and single-file React mode still complete an analysis.

## Explicitly out of scope

- Automatic fixes, diff views that apply a patch, and editing files on disk.
- New model calls beyond the request prompt 04 already performs.
- Zip upload, route crawling, and a rendered preview in an iframe.
- Restyling the HTML and single-file reports for visual novelty.

## Done when

The project mode shows a real response from the local app, the fixing-prompt test passes, frontend lint and build pass, and you stop before [06-acceptance.md](06-acceptance.md).
