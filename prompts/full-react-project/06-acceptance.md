# Prompt 06 — Acceptance for the full project scan

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md). Prompts 00 through 05 are implemented. This prompt does not add a new product surface. It proves the whole path, fixes only defects that break the acceptance criteria below, and writes nothing that changes IBM policy or the six model configurations.

If a defect's honest fix would require a new model, a higher quota, an IBM rule change, or executing the uploaded app, do not "fix" it that way. Record it as a remaining limit in the coverage text and adjust the test so it expects that honest limit.

## Goal

Show that a user-selected multi-file React project is indexed, projected where the JSX is static, scanned by the existing IBM checker, and assessed by the existing six-model pipeline, while the original HTML and single-file React modes still behave as they did before this feature.

## Prerequisite gate

Confirm the code contains all of these before you add the acceptance fixture. If one is missing, return to the prompt that was supposed to add it. Do not reimplement it from scratch in a new stack.

- Directory intake with path checks and a secret deny list.
- A Babel-based project index with resolved, unresolved, dynamic, external, ambiguous, and cyclic imports.
- Static HTML projection that never passes `className=` or `import ` into `getCompliance`.
- One scheduler call after IBM, with mocked providers in tests.
- A project UI mode that separates IBM results, model advice, and coverage.
- `backend\src\ai\config.ts` model ids still exactly:
  - `openai/gpt-oss-120b`
  - `openai/gpt-oss-20b`
  - `qwen/qwen3.8-27b`
  - `@cf/zai-org/glm-4.7-flash`
  - `@cf/nvidia/nemotron-3-120b-a12b`
  - `@cf/google/gemma-4-26b-a4b-it`

## Fixture

Create `test-fixtures\react-project\mini-app\` with a small tree. Keep every file short. Do not copy `node_modules`. Suggested files:

- `tsconfig.json` with `compilerOptions.paths` mapping `@ui/*` to `src/ui/*`.
- `src/main.tsx` that imports `./App`.
- `src/App.tsx` that renders a literal `<main>` and `<SaveButton />`, plus a relative import of `./SaveButton` and an alias import of a presentational component from `@ui/Field`.
- `src/SaveButton.tsx` that returns a literal `<button type="submit">Save</button>` only if your prompt 03 inliner is allowed to inline it. If the inliner correctly refuses this component, keep the button literal in `App.tsx` instead and use `SaveButton` as an unresolved or unexpanded case in a second file. The fixture must include both a projectable native control and one unexpanded component. Do not weaken the inliner so the fixture looks finished.
- `src/ui/Field.tsx` with a literal `<label htmlFor="email">Email</label>` and `<input id="email" />`.
- `src/Other.tsx` with a second `<button>Save</button>` so rule 6 has a candidate and nothing in the fixture asserts those two buttons are the same action.
- `src/Broken.tsx` with a syntax error so coverage is partial when that file is included.
- `public/index.html` with a real, small document that includes one obvious static issue the current IBM configuration already reports in HTML tests, such as an image without `alt`, if that issue is stable in [backend/__tests__/services/checker.test.ts](../../backend/__tests__/services/checker.test.ts). If it is not stable, assert the native file was scanned and the summary object exists, not a specific count you hoped for.
- `notes.md`, `src/logo.png`, and a file named `.env` whose contents are the single line `dummy`. The pipeline must ignore all three. The acceptance test reads the `.env` fixture only to build the upload and asserts the response and logs under test do not contain `dummy`.

Do not include a real credential. Do not add a package.json script and then run it.

## End-to-end test

Add `backend\__tests__\routes\analyzeProject.acceptance.test.ts`.

Build the multipart body from the fixture files. Post it to the project route using the same in-process app harness as [backend/__tests__/routes/analyze.test.ts](../../backend/__tests__/routes/analyze.test.ts) and [backend/__tests__/routes/analyzeSource.test.ts](../../backend/__tests__/routes/analyzeSource.test.ts).

Stub `runContextualAssessmentJobs` so it returns one valid `potential_issue` for a scheduled rule, one `insufficient_context`, and does not call a provider. The test fails if the stub is invoked before IBM artifacts are produced, if it is invoked more than once, or if its evidence payload contains `dummy` or the full text of every source file.

Assert:

- Snapshot id is stable across two identical posts.
- Paths use `/` and include `src/ui/Field.tsx`. The alias did not cause a read outside the fixture.
- `.env`, `notes.md`, and `src/logo.png` are ignored. `src/Broken.tsx` yields a parse error and `completeness` is `partial`.
- A traversal part added in a second request returns 400 and does not return the rest of the project as success.
- At least one IBM artifact has `inputKind` `native-html` or `static-projection`. Every `static-projection` artifact's stored HTML, if you return it in test-only inspection or you capture it via a spy on `getCompliance`, contains no `className=` and no `import `.
- An unexpanded component is listed under omissions and is not represented as an empty successful page with zero issues unless that page had other static content you meant to scan.
- Rule coverage includes all 20 ids. Rules that prompt 04 forbids are not in the stub's received units.
- The two `Save` buttons are a candidate group with equivalence not proven, unless one of them was omitted as dynamic. If omitted, the test expects the omission, not a fabricated group.
- The fixing prompt contains the partial-scan wording, a source path, and the instruction to inspect before editing.
- IBM summary numbers on the native HTML artifact are whatever the checker returned. The test does not rewrite them to match the model stub.

## Regression

Run, from `backend\`:

```sh
npm test
npm run build
```

These existing suites must pass without loosened assertions:

- `backend\__tests__\routes\analyze.test.ts`
- `backend\__tests__\routes\analyzeAcceptance.test.ts`
- `backend\__tests__\routes\analyzeSource.test.ts`
- `backend\__tests__\services\checker.test.ts`
- `backend\__tests__\ai\config.test.ts`

From `frontend\`:

```sh
npm run lint
npm run build
```

From the repository root:

```sh
git diff --check
```

Fix whitespace errors `git diff --check` reports in files you touched.

## Browser pass

With the backend on port 3001 and the Vite app on port 5173:

1. HTML mode: load a local HTML file, analyze, see IBM counts and the model section.
2. React mode: load one `.tsx` file, analyze, see `IBM was not run` (or the existing not-run copy) and the advisory section.
3. Project mode: select `test-fixtures\react-project\mini-app`, analyze, see partial coverage, separate IBM and model regions, a source path, and a copyable prompt. Copy the prompt and confirm the clipboard text matches the on-screen prompt if the browser allows clipboard access. If clipboard permission is denied, activate the button and record the visible feedback.
4. Resize to a narrow window and confirm the project result stacks without overlapping controls.
5. Switch back to HTML mode and confirm the project result cleared and HTML analysis still runs.

If a step fails, fix the defect and repeat that step. Do not declare the feature done from the API test alone.

## Limits you must leave visible

The final UI and fixing prompt still state that this scan:

- did not install dependencies or execute the project
- did not discover routes from filenames
- did not see image pixels, computed accessible names, or runtime validation
- did not prove that similar labels are the same action or term
- sent IBM only native HTML and static projections
- may have left targets unassessed when the model budget was exhausted

Do not delete those statements to make the screen look more confident.

## Explicitly out of scope

- New features beyond gaps found while running this acceptance list.
- Live calls to Groq or Cloudflare to "see if the models agree."
- Editing `.achecker.yml`, `MODEL_CANDIDATES`, provider clients, or ledger limits.
- Committing, unless the user asked for a commit in the implementation session. This prompt does not ask for one.
- Updating the stale root README sentence about models being unimplemented, unless the user asked for documentation. The acceptance test on `config.ts` is the guard, not a README rewrite.

## Done when

The acceptance test passes, the regression commands pass, `git diff --check` is clean, and the browser pass has been performed for all three modes. Summarize for the user:

- the route and UI mode that scan a folder
- what IBM received
- what the six models received
- which of the 20 rules stay not assessed on static source
- any fixture case that remains partial on purpose

That summary is the end of this pack. Do not open a new analysis stage.
