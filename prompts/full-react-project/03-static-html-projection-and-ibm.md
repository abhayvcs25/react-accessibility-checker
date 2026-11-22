# Prompt 03 — Static HTML projection and the unchanged IBM checker

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md). Prompts 00, 01, and 02 must be done and their tests passing. This prompt is the IBM half of project analysis. It does not schedule the six models. Prompt 04 adds that, once per project request, after IBM finishes.

## Goal

Run IBM Equal Access on two kinds of HTML only:

1. Native `.html` and `.htm` files the user supplied in the project folder.
2. A deterministic HTML projection built from statically supported JSX for a page root you can identify without executing the project.

Raw `.jsx`, `.tsx`, `.js`, and `.ts` never enter `aChecker.getCompliance`. If you cannot build a valid projection, say IBM was not scanned for that artifact. Do not send an empty document just to obtain zero counts, and do not copy success counts from another file.

## Prerequisite gate

- The project index from prompt 02 lists files, imports, component references, and per-file JSX targets with source locations.
- [backend/src/services/checker.ts](../../backend/src/services/checker.ts) `analyzeHtml` still scans one HTML string, then calls `runContextualAssessmentJobs`. You must not call `analyzeHtml` once per file or per component. That would schedule models once per artifact and would change the meaning of a project scan.
- You know how to reuse the IBM call itself: `ensureConfiguration`, the single-flight `enqueue` queue, `aChecker.getCompliance(html, label)`, the invalid-report throw, non-`PASS` filtering, and `normalizeIssue`. Extract the shared scan helper only if existing HTML tests still prove the same issues and summary counts. If a refactor would risk that contract, duplicate the smallest compliance-and-normalize sequence in a new function and leave `analyzeHtml` untouched.

## What IBM is

IBM is the rules-based checker. It has its own rule pack, `IBM_Accessibility`, loaded from [backend/.achecker.yml](../../backend/.achecker.yml). Those rules are not the 20 contextual rules. Do not map an IBM `ruleId` onto `BUTTON-PURPOSE-CLARITY` or any other contextual id. Do not drop, rename, or rescore IBM issues to match model opinions.

The checker expects an HTML document string. A projection is an input we generated. Label every finding from a projection as `inputKind: "static-projection"`. Label every finding from a user HTML file as `inputKind: "native-html"`.

## Projection policy

Add `backend\src\services\reactStaticProjection.ts`. Input is the prompt 02 index plus the accepted file texts you already hold for the request. Output is zero or more projection artifacts and a list of skipped roots.

### What may appear in the HTML

Include an element only when all of the following are true:

- The JSX name is a lowercase intrinsic (`div`, `button`, `a`, `img`, `input`, `label`, `h1` through `h6`, `form`, `ul`, `li`, `p`, `span`, `section`, `header`, `footer`, `nav`, `main`, `textarea`, `select`, `option`, and the other intrinsic names Babel already treats as native in the extractor).
- Every included attribute is a string literal or a static value the single-file extractor already marks as known. Rename React attributes the browser requires: `className` to `class`, `htmlFor` to `for`. Copy `aria-*`, `alt`, `href`, `src`, `type`, `placeholder`, `id`, `role`, `title`, and `tabIndex` to `tabindex` only when the value is a literal.
- Children that are included are JSX text or elements that themselves qualify. Trim only what the extractor already treats as insignificant whitespace. Do not invent text.

Escape text and attribute values for HTML. `<img alt="Tom & "Jerry"">` must not break the document. Quote attributes. Do not emit event handlers (`onClick` and the rest). Do not emit `style` objects. A non-literal `style` or event handler is omitted, and the element can still be projected if the remaining literal attributes are valid.

### What must be omitted

Omit the subtree, and record a coverage reason, when you see:

- A component tag (`Button`, `Form.Field`, `motion.div`) whose body you are not allowed to inline under the rule below.
- Spread attributes `{...props}`.
- Conditional expressions, logical expressions, function calls, map callbacks, or variables as children or attribute values, unless the existing same-file literal policy already resolved them.
- Fragments may be flattened only when every child is itself projectable. If one child is dynamic, omit the dynamic child and record the omission. Do not drop the static siblings without saying the fragment was partial.

### Inlining a custom component

Inline a component into its parent only when every item below holds. If one item fails, omit the tag and record `unexpanded-component`.

- Prompt 02 resolved the tag to exactly one accepted file and one exported function or class.
- That component's parameters are unused in the returned JSX, or every referenced prop is a literal at the call site and the component reads it as a simple identifier in an attribute or text position you can substitute without evaluating a function. If you cannot describe that substitution in one pure function with tests, do not inline. Prefer omission over a clever evaluator.
- The returned JSX is a single projectable tree. Multiple return statements, hooks, and early returns make the component `dynamic-body`.
- Inlining depth is at most 3. A cycle in the component graph stops with `cycle` and does not inline.

Do not inline a component merely because its name looks like a native role.

### Page roots

Create at most one projection per discovered page root, and at most 20 projections per request. Extra roots are `omitted` with reason `projection-cap`.

A page root is one of:

- An accepted HTML file. Scan it as native HTML. Do not parse it as JSX.
- A JSX file the index marked as a static route candidate with a literal path and a resolved element, from prompt 02. The projection's label includes that path.
- If there is no route candidate and exactly one accepted file renders a projectable tree that is not imported by any other accepted file, treat that file as the single synthetic root and set `rootKind: "unreferenced-module"`. If several such files exist, do not guess the app entry. Record `pageRoots: "ambiguous"` and emit no JSX projection. Native HTML files are still scanned.

Do not treat every component as a page. A `Button.tsx` that is imported by `App.tsx` is not its own IBM document.

### Shell

If an accepted HTML file contains a single empty mount node that you can point at with a literal `id`, and exactly one JSX root is unambiguous, you may insert the projection's body inside that mount and scan the combined document once. Set `shell: "user-html"`. Do not execute the HTML file's scripts. Do not scan the empty shell again as a second page.

If you cannot pair them, scan the user HTML as its own native document, and wrap a JSX projection in a minimal document:

```html
<!DOCTYPE html>
<html lang="und">
  <head><meta charset="utf-8"><title>Static projection</title></head>
  <body>
    ...projected body...
  </body>
</html>
```

`lang="und"` means the language is unknown. Do not copy a language from a filename or from `package.json`. Set `shell: "generated"`. The title is the fixed string `Static projection` plus nothing that pretends to be the app's title. Do not add skip links, landmarks, or labels the user did not write. Those would create false IBM results.

If the projected body is empty because everything was dynamic, do not call IBM. Status is `not_scanned` and the reason explains the omission.

### Source map sidecar

For each element you emit, keep a sidecar entry only when the mapping is one-to-one: generated CSS-selector-like path or child index, source file, start line, start column, end line, end column. If two JSX nodes collapse to one HTML node, or a wrapper you invented sits between them, omit the source mapping for that node and set `sourceMapping: "unavailable"`. Never put `data-scan-id` or other attributes into the HTML solely to help the mapper. Those attributes would change IBM's view of the page.

When an IBM issue's DOM path hits a mapped node exactly, attach the source location. Otherwise show the DOM path and `sourceMapping: "unavailable"`. Do not guess the nearest line.

## IBM execution

For each native HTML file and each projection that has a non-empty projectable body:

1. Wait on the same checker queue `analyzeHtml` uses, so two scans do not overlap inside `accessibility-checker`.
2. Call `getCompliance` with a unique label.
3. Normalize issues with the same function the HTML route uses.
4. Keep the summary counts for that artifact. Also return a project rollup that sums counts and includes `scanCount`. Do not deduplicate issues across files. The same `button-name` pattern in two projections is two findings.
5. Store `inputKind`, relative path or projection id, `shell`, `rootKind`, and the coverage omissions next to the issues.

Order: finish every IBM scan for the request before any later prompt schedules models. This prompt's route may stop after IBM and return `advisoryReport: null` or omit the model section with `modelsStatus: "not_run_in_this_stage"`. Do not fabricate model agreement.

If `getCompliance` throws, that artifact is `ibmStatus: "error"` with a short message. Other artifacts still return. Do not convert a throw into zero violations.

Run one projection through the installed checker in a test using a local fixture. That test may use the real `accessibility-checker` package the way [backend/__tests__/services/checker.test.ts](../../backend/__tests__/services/checker.test.ts) already does. It must not call Groq or Cloudflare. Mark the test as projection-scoped: a missing `alt` on a literal `<img>` in JSX should surface as an IBM issue whose sidecar maps to the JSX line, if your fixture is static enough for the installed rules to report it. If the installed rule does not fire, assert the projection HTML and the `not_scanned` or issue list you actually got. Do not tune `.achecker.yml` to force a finding.

## Response sketch

Attach this to the project index response, or return it from `POST /api/analyze-project` if you introduce that route now. Prompt 04 will add models to the same route. Leave a single function `analyzeProject` that currently performs intake, index, and IBM, so prompt 04 can append scheduling without a second upload.

```json
{
  "ibm": {
    "status": "partial",
    "scanCount": 1,
    "artifacts": [
      {
        "id": "projection:src/App.tsx",
        "inputKind": "static-projection",
        "shell": "generated",
        "ibmStatus": "scanned",
        "summary": { "total": 0, "violations": 0, "potentialViolations": 0, "recommendations": 0, "potentialRecommendations": 0, "manual": 0 },
        "issues": [],
        "omissions": [{ "reason": "unexpanded-component", "file": "src/App.tsx", "line": 10 }]
      }
    ]
  }
}
```

Use the same summary fields as [backend/src/types/checker.ts](../../backend/src/types/checker.ts). `status` is `complete` only when every native HTML file was scanned and every discovered page root was either scanned or explicitly `not_scanned` with a reason, and no cap dropped a root. A skipped dynamic root means `partial`, not failure.

## Tests

- A fixture component with `<img src="/a.png" />` and no alt projects to an `img` without an `alt` attribute, and the sidecar points at the JSX line. Attribute values with `&`, `<`, and quotes are escaped.
- `<Button label="Save" />` does not become `<button>Save</button>` unless the inlining rule is fully satisfied and a test shows the component source. A name-only component stays omitted.
- `{condition && <button>Save</button>}` omits the button and records a dynamic branch. It does not emit the button.
- Two page-like modules and no route data produce no JSX projection and `pageRoots: "ambiguous"`. An included `public/index.html` is still a native scan.
- Calling the project analyzer does not call `runContextualAssessmentJobs`. Assert with a mock or a spy. If the module graph makes spying hard, inject the scheduler function with a default of the real one and pass a failing stub in the test.
- Existing `analyze.test.ts` and `checker.test.ts` pass unchanged. A comment in the projection module should state that `analyzeHtml` remains the single-document entry.
- A raw JSX string passed to the projection function as if it were HTML is not how the API works. Add a test that the route never calls `getCompliance` with input that still contains `className=` or `import `.

## Acceptance

- IBM findings for a projection are labeled static and partial.
- Source locations appear only when the sidecar matched.
- Native HTML and projections are separate artifacts.
- The HTML endpoint's issue counts for its own fixtures are unchanged.
- No model request was added.

## Explicitly out of scope

- Changing IBM policy, rules, report levels, or `normalizeIssue` behavior.
- Server-side rendering, `react-dom/server`, or running Vite.
- Scheduling `runContextualAssessmentJobs` in this prompt.
- Drawing a page for every file in the folder.
- Claiming the projection is what a browser would show.

## Done when

A multi-file fixture returns per-artifact IBM results or explicit `not_scanned` reasons, tests prove JSX was not the compliance input, and you stop before [04-project-rules-and-six-models.md](04-project-rules-and-six-models.md).
