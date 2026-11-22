# Prompt 02 — Cross-file source index

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md). Complete [00-prerequisites.md](00-prerequisites.md) and finish [01-safe-project-intake.md](01-safe-project-intake.md), including its tests, before this prompt. Intake must already reject traversal and secret files. This prompt builds a static index. It does not call IBM and it does not schedule models.

## Goal

Given the accepted files from a project intake, parse each supported script with the existing Babel extractor and build a bounded import, export, and component-reference index. Record what was resolved, what was dynamic, and what was missing. Stable IDs must survive a second run of the same bytes.

The index is evidence for later rule and projection prompts. It is not a bundler and not a typechecker.

## Prerequisite gate

- `POST /api/project-intake` exists, preserves relative paths, and ignores `.env` and `node_modules`.
- [backend/src/services/reactSourceExtractor.ts](../../backend/src/services/reactSourceExtractor.ts) still parses one file with `@babel/parser` and returns the `reactSource` snapshot types.
- You have not added a second JSX parser.
- HTML V2 types in [backend/src/types/contextV2.ts](../../backend/src/types/contextV2.ts) are unchanged.

## Current code to reuse

Call `extractReactSourceTargets(source, relativePath)` once per accepted `.jsx`, `.tsx`, `.js`, and `.ts` file. The function today rejects filenames that are not `.jsx` or `.tsx`. Extend it, or add a thin wrapper in a new module, so `.js` and `.ts` parse as source text with the same JSX plugin set the extractor already uses. Do not fork the element-walking logic. If a `.js` file has no JSX, return an empty target list and still record imports and exports.

Keep these extractor rules:

- Syntax only. No `eval`, no `import()`, no `require` execution, no TypeScript program that emits JavaScript, no Vite, no esbuild, no Babel transform that runs code.
- Bounds already in the extractor stay in force per file: about 500 KB, 500 elements, bounded text and attributes. If a file hits those bounds, the index says that file is `partial`. Do not raise the caps in this prompt.
- Dynamic attributes, spreads, and non-literal children stay unknown. Do not invent a constant evaluator beyond what the extractor already does inside one file.

Put new types in `backend\src\types\reactProject.ts`. Do not overload `t-N` HTML ids or single-file target ids as project ids.

## Module resolution you must implement

Resolve only specifiers that point at another accepted file in the same manifest. Record every other specifier with an explicit status.

### Relative imports

Support `./` and `../` in static `import` and `export ... from`. Try, in order, the specifier as written and then these suffixes and indexes if the path has no extension:

- `.tsx`, `.ts`, `.jsx`, `.js`
- `/index.tsx`, `/index.ts`, `/index.jsx`, `/index.js`

Only accept a candidate that is in the accepted-file set. If two candidates exist, status is `ambiguous`. Do not pick the first. If none exist, status is `unresolved`. A relative import that normalizes outside the project root is `rejected-path`, not a successful escape.

Also record `export { X } from "./mod"` and `export * from "./mod"` as re-exports. `export *` does not copy names you did not parse. Point at the target module and mark the name set `namespace-star`.

### Aliases

Read the accepted `tsconfig.json` or `jsconfig.json` as JSON text. If the file is absent, truncated, or invalid JSON, record `aliasConfig: "unavailable"` and do not guess aliases.

Use only `compilerOptions.baseUrl` and `compilerOptions.paths`. Ignore `extends`, plugins, and references. Do not load another file because `extends` names it, unless that exact file was also accepted and you document a one-level static include. Prefer refusing `extends` over executing a config chain. A comment in JSON is invalid JSON; do not strip comments unless you already have a parser in the repo. If you do not, invalid JSON means aliases are unavailable.

Apply a path pattern only when the target stays inside the project root after normalization and matches one accepted file by the same suffix rules as relative imports. Unmatched aliases are `unresolved`. Do not read `node_modules` to satisfy `react` or a library.

### Bare and remote specifiers

`react`, `react-dom`, `@scope/pkg`, `http:`, `https:`, `node:`, and `data:` are `external`. They are not missing project files. Do not fetch them.

### Dynamic imports

`import(expr)` is `dynamic`. If `expr` is a string literal, you may also attempt the static resolution above and record both facts: the import is dynamic, and the literal target was or was not an accepted file. Do not load it. A template literal without substitution may be treated as a literal. Any substitution is `dynamic` and unresolved.

`require(...)` is the same policy. Do not execute it.

### Cycles

If A imports B and B imports A, keep both edges and set `cycle: true` on each edge that participates. Still parse both files. Do not recurse forever: visit each file once for parsing, and build the graph from the recorded edges afterward.

## Component and symbol identity

From each parsed file, record exports you can see syntactically:

- `export function Name`, `export class Name`, `export const Name = ...`
- `export default` with the local name when the default is a named function or class. Anonymous default is `default` and `anonymous: true`.
- Re-exports as edges, not as copies of the implementation.

A JSX tag that starts with an uppercase letter, or is a member expression such as `Form.Input`, is a component reference, not a native HTML element. Do not emit a fake `button` or `img` target because the component is named `Button` or `Image`.

Resolve a component reference to an imported binding only when all of these hold:

- The tag identifier is a local binding created by one static import in this file.
- That import edge is `resolved` to exactly one accepted file.
- That file has one matching named export, or a default export when the import is default.
- The binding is not a namespace import used with a dynamic property.

Otherwise the reference status is `unresolved`, `ambiguous`, `external`, or `dynamic`, matching the edge. Record the tag's source location anyway.

Same-file references to a function declared in that file are `resolved` with `local: true`.

Do not follow the resolved component into its JSX body in this prompt. Prompt 03 decides whether a component's markup may be inlined. Here you only store the edge.

## Identifiers

`snapshotId` comes from prompt 01. If you are building the index in the same request, reuse that hash. Do not invent a second hash of a subset of files.

Target id format, stable and opaque enough to quote in a report:

`proj:{snapshotId}:{relativePath}:{startLine}:{startColumn}:{kind}`

`kind` is the existing React target kind (`image`, `button`, `link`, `form-control`, `heading`, `text-content`, `custom-widget`) or `module`, `import`, or `export` for index records. Use the relative path with `/` separators. Do not include source text in the id.

Every target copied from the single-file extractor keeps its `ReactSourceLocation` with `file` set to the project relative path, plus start and end line and column. Excerpts stay within the extractor's existing character cap.

## Coverage record

Return a `ProjectIndex` object:

- `snapshotId`
- `completeness`: `complete` or `partial`
- `files`: for each accepted file, `parsed`, `ignored-non-script`, `parse-error`, or `omitted`, with a reason string
- `parseErrors`: file, line, message, bounded to the extractor's existing error style
- `imports`: from, specifier, resolvedPath or null, status, cycle
- `exports`: file, name, local, kind (`named`, `default`, `star`)
- `componentReferences`: file, tag, status, targetFile, targetExport, location
- `targets`: the per-file extractor targets with project ids
- `limitsHit`: which per-file or project caps fired

`completeness` is `partial` when any accepted script failed to parse, hit an extractor bound, was omitted, or when any internal relative import is `unresolved`, `ambiguous`, or `dynamic`. External package imports do not by themselves make the project partial. Say that in `limitsHit` or a separate `externalImportCount` so the UI does not call React itself a missing file.

An unresolved relative import is incomplete coverage. It is not proof that the module's elements are absent.

## HTML files in the manifest

Accepted `.html` and `.htm` files are `ignored-non-script` for this index's Babel pass. Record their relative paths and byte lengths so prompt 03 can scan them as native HTML. Do not parse them with Babel. Do not run scripts inside them. Do not rewrite them.

## Route discovery

Do not build a route table from filenames such as `pages/login.tsx` or `app/account/page.tsx`. You may record a file as a `routeCandidate` only when the source contains a literal route path in a recognized static form you document, for example a JSX `<Route path="/account" element={...}>` with a string literal path. If the element is a dynamic expression, store the path literal and `element: "dynamic"`. Do not claim those are all the routes. If you are unsure the pattern is static, omit the candidate and record `routeDiscovery: "not-inferred"`. Filename inference is forbidden.

## API

Extend the project flow with `POST /api/analyze-project` or, if prompt 01's route is the only upload, have the intake route return the index when the client sends `analyze=index`. Prefer one new route, `POST /api/project-index`, that accepts the same multipart contract as intake and returns the intake manifest plus `index`. Do not make the client upload twice if a single request can do both. Keep `POST /api/project-intake` working if prompt 01 tests call it.

The response must not contain full file text. It may contain the bounded excerpts already produced by the extractor.

Still do not call `aChecker.getCompliance` or `runContextualAssessmentJobs`.

## Tests

Add `backend\__tests__\services\reactProjectIndex.test.ts` using in-memory file maps, not a live upload of this repository. Fixtures live under `test-fixtures\react-project\` as tiny source strings, or inline in the test if that matches nearby tests. No `node_modules`.

Cover:

- `src/App.tsx` imports `./Button` and resolves to `src/Button.tsx` when that file exports `Button`.
- `export { Button as SaveButton } from "./Button"` resolves the public name `SaveButton` to the original export.
- A cycle between `A.tsx` and `B.tsx` parses both files and flags `cycle: true` without hanging.
- `import("whatever")` and `` import(`./${name}`) `` are `dynamic`.
- `import Button from "react-bootstrap"` is `external` and does not mark the project partial by itself.
- Missing `./Missing` is `unresolved`, completeness is `partial`, and no target is invented for `Missing`.
- Two files matching an extension search are `ambiguous`.
- A `tsconfig.json` path `@ui/*` -> `src/ui/*` resolves `@ui/Button` only when `src/ui/Button.tsx` was accepted. A path that would escape the root does not resolve.
- Invalid `tsconfig.json` yields `aliasConfig: "unavailable"` and leaves alias imports unresolved.
- `<Button />` whose import resolved to the `Button` export is a component reference. It does not create an HTML `button` target.
- `<button>Save</button>` in `Button.tsx` remains a `button` target with file `src/Button.tsx` and a stable project id. Running the index twice on the same bytes yields the same id.
- A file over the extractor element cap is `partial` and its omitted remainder is not described as absent.
- `.env` never appears as a parsed file. Build the index from an accepted-file map that already went through the intake policy, and add one test that wires intake output into the index and shows a denied file was not parsed.
- An accepted `index.html` is listed for later HTML handling and is not passed to Babel.

Run the new tests plus `npm test` and `npm run build` from `backend\`. Existing single-file extractor tests must pass. If you widened `extractReactSourceTargets` to accept `.ts` and `.js`, add cases for a `.ts` file with a type-only import. Type-only imports are edges with `typeOnly: true` and are not runtime component references.

## Acceptance

- The index names, for a three-file fixture, which component file supplies which JSX targets, without executing those files.
- Unresolved, dynamic, cyclic, external, and ambiguous edges are distinct statuses.
- IDs include snapshot, relative path, and source position.
- IBM and the model scheduler are still not invoked on this route.
- Single-file `POST /api/analyze-source` behavior is unchanged.

## Explicitly out of scope

- Inlining child component JSX into a parent.
- HTML serialization, IBM scans, and model jobs.
- Inferring routes from the filesystem.
- Evaluating expressions to discover props, styles, or text.
- Reading packages from `node_modules` or the network.

## Done when

The index tests pass, the project route returns coverage without file dumps, and you stop before [03-static-html-projection-and-ibm.md](03-static-html-projection-and-ibm.md).
