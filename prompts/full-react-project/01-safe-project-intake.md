# Prompt 01 — Safe React project intake

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md) and complete [00-prerequisites.md](00-prerequisites.md) first. The prerequisite report must be a pass. This prompt adds intake only. Do not parse a project import graph, do not build an HTML projection, do not call IBM, and do not schedule models.

## Goal

Let the user select a React project folder from the browser and send a bounded, path-safe file manifest to a new backend route. The server validates every path and returns which files are accepted, ignored, or rejected, plus explicit limit and secret-exclusion results. Analysis of file contents, other than reading bytes the user already selected in order to enforce size and text-encoding checks, waits for later prompts.

The user must understand that a later analysis action can send selected HTML projections to the local IBM checker and selected evidence excerpts to the configured external model providers. Selecting a folder is not that consent. Keep the existing pattern: files stay in the browser until the user presses the analysis action.

## Prerequisite gate

Do not start if any of these are false:

- Prompt 00's backend tests, backend build, frontend lint, and frontend build passed.
- `POST /api/analyze` and `POST /api/analyze-source` still exist with their current contracts.
- Frontend mode is only `'html' | 'react'`.
- You have read [.github/instructions/frontend-design.instructions.md](../../.github/instructions/frontend-design.instructions.md).

## Current code to reuse

- UI shell, mode switch, file reading, error text, and analysis button in [frontend/src/App.tsx](../../frontend/src/App.tsx). Add a third mode. Do not break the two existing modes when the user switches. Switching modes must abort an in-flight request the same way `handleModeSwitch` already does.
- Visual language in [frontend/src/tokens.css](../../frontend/src/tokens.css) and [frontend/src/App.css](../../frontend/src/App.css). Reuse tokens. Do not introduce a new palette, gradient, or dashboard layout.
- Path rejection ideas in [backend/src/services/contextExtractionProject.ts](../../backend/src/services/contextExtractionProject.ts): non-empty relative paths, no absolute paths, no `..` after normalization. That helper is HTML-only. Do not route React projects through `extractHtmlProjectContext`.
- Express app wiring in [backend/src/index.ts](../../backend/src/index.ts). Register a new router beside `analyzeRouter` and `analyzeSourceRouter`.
- Error JSON shape used by the existing routes: `{ error: string }` and an optional `code`.

## Product decision

One transport: directory selection.

- Use `<input type="file" webkitdirectory="" multiple>`. Also set the `directory` attribute if you need a non-WebKit fallback, and test the control in the browser.
- Read `file.webkitRelativePath` when it is a non-empty string. Fall back to `file.name` only for a single file that has no relative path, and record that the selection was not a directory. A project analysis requires a directory selection. Reject a normal single-file picker result on this mode with a clear error telling the user to choose a folder.
- Preserve the relative path exactly after normalization. Do not flatten `src/components/Button.tsx` to `Button.tsx`.
- Do not accept zip archives, drag-and-drop of archives, pasted source trees, or URL input in this prompt.

## Server contract

Add `POST /api/project-intake`.

Do not accept the project as one JSON `source` string. The existing JSON limit is `5mb` and is shared with the HTML and single-file routes. A folder of source will exceed that, and raising `MAX_BODY_SIZE` would also raise the limit for those routes. Use `multipart/form-data`.

Recommended shape:

- Each part is one file.
- A text field `relativePath` on each part, or a filename that is the relative path. Prefer an explicit `relativePath` field so browser filename sanitization cannot drop directories.
- Optional text field `projectLabel` for display only. It is untrusted. Bound its length. Do not use it as a filesystem path.

If the multipart parser you need is not already a dependency, add the smallest maintained parser that supports per-file limits and aborts when the total size cap is exceeded. Do not add a zip library. Document the dependency in the test file header comment only if the code is not self-explanatory. Keep the existing JSON parser limit unchanged.

### Limits

Put the numbers in one backend module, for example `backend\src\services\projectIntakeLimits.ts`, and import them from the route and tests. Suggested starting caps, adjustable only with a comment that explains the bound:

- Maximum files accepted into the manifest: 200.
- Maximum files inspected including ignored files: 500. Extra files are omitted and listed as omitted by count, not by dumping every path once the cap is hit.
- Maximum bytes per accepted text file: 512_000 (same order as the single-file extractor).
- Maximum total accepted text bytes: 4_000_000.
- Maximum relative path length: 240 characters.
- Maximum path segments: 16.
- Maximum `projectLabel` length: 120 characters.

When a cap is hit, return HTTP 200 with `completeness: "partial"` and a reason, unless the request itself is malformed. Malformed input is 400. A single oversized file is omitted or rejected with a file-level error; it must not be silently truncated and then described as complete. Over-limit total bytes stop acceptance and report the remainder as omitted. Do not return 413 for the whole project merely because one file was too large, unless the multipart stream itself exceeds a hard transport ceiling you set above the total-byte cap. Document that ceiling.

### Path rules

Normalize with POSIX separators. Reject the file, or the whole request when the path is an attack rather than a stray file, using these rules:

- Empty path, absolute path, drive prefix (`C:`), UNC path, or a path that normalizes to `..` or starts with `../`: reject.
- `\` and `/` are separators. Repeated separators collapse. `.` segments drop. The stored path uses `/`.
- Reject NUL, control characters, and backslashes in the stored form.
- Reject duplicate normalized paths. Keep the first and report the duplicate. Do not merge contents.
- Reject paths that escape the logical project root after normalization.

Return 400 with `code: "invalid-path"` when any supplied path is absolute or traverses. A project that contains one `..\secret` entry is hostile input, not a partial success. Duplicates and unsupported files inside an otherwise valid tree are file-level results, not request failures.

### Allow and deny policy

Apply deny before allow. Do not read the contents of a denied file. You may see its relative path and size because the browser sent them. Do not log contents.

Deny if any path segment, case-insensitive, matches:

- `.env`, or a segment that starts with `.env`
- `.git`, `.svn`, `.hg`
- `node_modules`, `bower_components`, `vendor`
- `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`, `out`
- `secrets`, `private`
- a filename equal to `credentials.json`, `id_rsa`, `id_dsa`, or ending in `.pem`, `.key`, `.p12`, `.pfx`, `.cer`, `.crt`

Also deny extensions: `.map`, `.lock`, images, fonts, wasm, zip, and other non-text binaries. The allow list is explicit. Anything else is `unsupported`, which is not the same as `secret`.

Allow for later analysis, and mark them `accepted` in this prompt:

- `.jsx`, `.tsx`, `.js`, `.ts`, `.html`, `.htm`
- `tsconfig.json` and `jsconfig.json` only, as bounded metadata for a later prompt. Cap each at 100 KB. Do not evaluate them. Do not accept `tsconfig.*.json` that could pull extra files in this prompt beyond recording the filename if it was selected; the alias prompt will read only the one accepted config.

Accepted files in this prompt are stored only for the duration of the request if you need them for a hash. Prefer not persisting uploads. Compute a project snapshot id as the hex SHA-256 of the sorted list of `relativePath + "\n" + sha256(contents)` for accepted files. Denied files contribute nothing to the hash. Return the snapshot id. Do not write the project to the repo, the user's home directory, or a long-lived cache.

HTML and JS are accepted into the manifest. This prompt does not parse them and does not execute `<script>` in HTML.

### Response shape

Return JSON:

```json
{
  "snapshotId": "64-char hex or null when nothing was accepted",
  "projectLabel": "bounded label or null",
  "completeness": "complete",
  "files": [
    {
      "relativePath": "src/App.tsx",
      "status": "accepted",
      "byteLength": 1200,
      "reason": null
    }
  ],
  "counts": {
    "selected": 10,
    "accepted": 4,
    "ignored": 5,
    "rejected": 0,
    "omitted": 1
  },
  "omissionReasons": ["total-byte-cap"]
}
```

`status` is `accepted`, `ignored`, or `rejected`. Use `ignored` for deny-list and unsupported files. Use `rejected` for duplicate or invalid-but-not-fatal path problems you chose to report per file. Traversal and absolute paths fail the request instead. `completeness` is `complete` only when every selected file was classified and no cap omitted a file. Never call a partial manifest a complete project.

Do not include file contents, source excerpts, or environment values in this response.

## Frontend

Add mode `project` next to `html` and `react`.

- The mode control is a real button group or radio group with an accessible name, keyboard operation, and visible focus. Do not rely on color alone.
- Directory input has an accessible name such as "React project folder".
- After selection, show counts: selected, accepted, ignored, and omitted. Show a scrollable list of relative paths and statuses. Do not render file contents in the preview.
- Explain, in the page text, that folder selection is local until analysis, and that the analysis action will send eligible HTML to the local IBM checker and short evidence excerpts to the configured model providers. The analysis button may be disabled in this prompt with the text "Index is not available yet" if the later prompts have not shipped. If you enable it, it may only call `POST /api/project-intake` and show the manifest. It must not call `/api/analyze` or `/api/analyze-source` with concatenated source.
- Switching away from `project` clears the manifest and aborts the request.
- Errors from 400 and network failure use the existing error region with `role="alert"` or the equivalent already used on the page.
- Layout works at a narrow viewport and a wide viewport. Reuse the current neo-brutalist surfaces, borders, and type. Do not add a component library.

Verify the new mode in the browser: choose a folder, see paths preserved, see `node_modules` and `.env` ignored if present in the test folder, and confirm the HTML and single-file React modes still upload and can start their existing requests. If the backend is not running, say so and still show the client-side path classification you can test without it. Do not claim browser verification you did not do.

Also classify paths in the client before upload so secret filenames are not sent as parts. The server must repeat the check. Client-side filtering is not the security boundary.

## Tests

Add focused backend tests. Use Node's test APIs already used in this repo (Vitest). Build multipart bodies in the test. No live model calls.

Cover:

- Relative paths with nested directories survive normalization.
- `src\\Button.tsx` and `src/Button.tsx` collapse to one path; the second is a duplicate.
- Absolute paths, `../`, and `foo/../../secret.txt` return 400 `invalid-path` and do not echo file contents.
- `.env`, `.env.local`, `src/.env.production`, `id_rsa`, and `certs/app.pem` are `ignored` with a secret reason, and the test never asserts on their contents because the fixture must not put real secrets in the repo. Use the single word `dummy` as the body if a body is required to build the part, and assert the response body does not contain it.
- `node_modules/react/index.js`, `dist/main.js`, and `coverage/lcov.info` are ignored even if the extension would otherwise be allowed.
- A `.tsx` file and an `.html` file are accepted. A `.png` and a `.md` are ignored as unsupported. Markdown is unsupported in this feature.
- The 201st accepted candidate is omitted, `completeness` is `partial`, and `snapshotId` covers only accepted bytes.
- Duplicate paths do not double-count bytes.
- `POST /api/analyze` and `POST /api/analyze-source` tests still pass without changes to their expected success bodies.

Add a small frontend test only if the repo already has a frontend test runner. It does not. Do not add one in this prompt. Verify the UI in the browser instead, and run `npm run lint` and `npm run build` from `frontend\`.

## Acceptance

- A directory selection produces a manifest with preserved relative paths.
- Hostile paths never return 200.
- Secret and dependency directories are ignored and their contents are not logged.
- Existing HTML and single-file routes behave as before.
- No IBM call and no `runContextualAssessmentJobs` call were added on this route.

## Explicitly out of scope

- Import graphs, Babel parsing, tsconfig path aliases, HTML projection, IBM, and model scheduling.
- Zip upload, symlink following, writing uploads to disk, and running the project.
- Changing `MAX_BODY_SIZE`, CORS origins, model config, or `.achecker.yml`.

## Done when

`POST /api/project-intake` matches the contract, the new UI mode can submit a folder, backend tests and build pass, frontend lint and build pass, and you have not started [02-cross-file-index.md](02-cross-file-index.md) inside this change. Stop here and review.
