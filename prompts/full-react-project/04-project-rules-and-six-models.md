# Prompt 04 — Project evidence and the six-model pipeline

You are working in:

`D:\react-accessibility-checker`

Read [README.md](README.md). Prompts 00 through 03 are complete. IBM scans for the project request already finish before this step runs. This prompt connects the project index to the existing contextual scheduler. It does not retune models.

## Goal

After IBM finishes, schedule one batch of contextual assessments for the project. Use the six models already configured. Send each model only the evidence a specific rule needs for a specific target. Reuse `runContextualAssessmentJobs` and `aggregateAdvisoryReport`. If the current request budget runs out, leave the remaining targets `not assessed`. Do not raise the budget.

The 20 rules stay advisory. They are not IBM findings. A model `potential_issue` must not appear in the IBM issue list or change IBM counts.

## Prerequisite gate

- Prompt 03 returns per-artifact IBM results without calling the scheduler.
- [backend/src/ai/config.ts](../../backend/src/ai/config.ts) still lists only these models, and you will not edit that file:
  - `openai/gpt-oss-120b`
  - `openai/gpt-oss-20b`
  - `qwen/qwen3.8-27b`
  - `@cf/zai-org/glm-4.7-flash`
  - `@cf/nvidia/nemotron-3-120b-a12b`
  - `@cf/google/gemma-4-26b-a4b-it`
- [backend/src/services/reactSourceRuleMap.ts](../../backend/src/services/reactSourceRuleMap.ts) remains the single-file policy. Project policy is a new module, `backend\src\services\reactProjectRuleMap.ts`, which may import `ALL_RULE_IDS` and the single-file policies. Do not weaken `assessableFromSingleFile` to sneak project-only rules into `POST /api/analyze-source`.
- [docs/contextual-accessibility-rules.md](../../docs/contextual-accessibility-rules.md) sections 2, 4, 7, and 10 are the decision rules. Where this prompt and the spec disagree, follow the spec and record the mismatch. Do not silently loosen abstention.

## How the current scheduler is shaped

`adaptReactSourceSnapshot` turns one file's targets into assessment units. `runContextualAssessmentJobs` accepts that adapter result, a content string used for hashing, a filename, and options such as `sourceKind: 'react-source-file'`.

Inspect the function signature and the adapter result type before editing. Extend the adapter, or add `adaptReactProjectIndex`, so a unit can carry:

- `ruleId` from `ALL_RULE_IDS`
- project target id from prompt 02
- relative path and source line/column
- bounded excerpts and evidence records the rule is allowed to see
- a coverage note when the evidence is partial

Pass `sourceKind: 'react-project'` only if the scheduler already ignores unknown source kinds or you can add that label without changing provider, quota, or model-selection code. If adding the label requires an edit under `backend\src\ai\` other than a type union the scheduler uses for display, stop and report the mismatch. Do not edit provider clients.

Call `runContextualAssessmentJobs` once for the project request. Do not call it inside the per-artifact IBM loop. Do not call `analyzeHtml` to obtain model results.

The content hash input must be the same snapshot identity as prompt 01, not a single random file and not the full concatenated source of the repository. Tests must mock the scheduler. No live Groq or Cloudflare calls.

## What a project adds, rule by rule

Single-file analysis already dispatches some rules from one file. Project analysis may add cross-file evidence only where the evidence is static and explicit. It still cannot see pixels, the accessibility tree, or a running event handler.

Dispatch a unit only when the evidence column says the project can support a judgment. Otherwise include the rule in coverage as `not_assessed` with the prerequisite. Do not send the rule to a model "so the report looks complete."

| Rule | Project static evidence you may add | Still do not assess |
| --- | --- | --- |
| `IMG-ALT-RELEVANCE`, `IMG-ALT-CLARITY` | Authored `alt`, literal `src` string, ancestor text that is static across inlined files. | Whether the alt matches the picture. No pixels. A filename is not image content. Keep these `not_assessed` unless the spec's non-visual subcheck is fully met by text you actually have. Default is abstain. |
| `IMG-ALT-REDUNDANCY` | Literal alt and literal adjacent text in the same projected subtree or same component, including text from a file the index resolved and prompt 03 was allowed to inline. | Redundancy that depends on rendered layout. |
| `BUTTON-PURPOSE-CLARITY`, `BUTTON-NAME-AMBIGUITY` | Literal name, `aria-label`, and static ancestors across the inlined or same-file tree. Other button names in the same page root. | Handler behavior. A name that merely repeats is not automatically ambiguous. |
| `BUTTON-ACTION-CONSISTENCY` | A candidate pair only when both the visible name and the action are explicit static facts, such as `type="submit"` versus `type="reset"`, or a call-site literal that prompt 03's inliner substituted. Record other buttons that share a name as candidates. | `onClick={save}` does not establish what the click does. String-equal labels across files are not the same action. Abstain unless action evidence is explicit. |
| `LINK-PURPOSE-CLARITY`, `LINK-GENERIC-TEXT` | Literal link name and static ancestor text. An `href` string may be shown as an authored attribute. | Do not treat `href` as fetched destination content. Do not request the URL. |
| `LINK-SIMILAR-CHOICES` | Candidate groups of links in one page root with similar literal text and different literal hrefs. | Visual similarity. Destination identity beyond the literal href string. |
| `FORM-LABEL-RELEVANCE`, `FORM-LABEL-AMBIGUITY`, `FORM-PLACEHOLDER-ONLY` | `htmlFor`/`id` and `aria-labelledby` when prompt 02 proved the ids inside the page root's static tree, including across files that were inlined under prompt 03's rule. | Ids that are dynamic, duplicated, or outside the included tree. Browser-computed names. |
| `ARIA-NAME-CLARITY`, `ARIA-NAME-CONFLICT` | Keep authored `aria-label`, labelledby text, and children as evidence records. | Do not dispatch a verdict. The spec requires the computed accessible name and precedence. Project source does not have it. |
| `ARIA-NAMING-CONSISTENCY` | Group controls in the included page roots that share a resolved role and an authored name. They are candidates. | Do not call two names inconsistent or consistent unless the spec's equivalence evidence is present. Similar strings are not equivalence. Prefer `not_assessed` over a forced verdict. |
| `HEADING-CLARITY`, `HEADING-CONTENT-RELEVANCE` | Literal heading text and literal sibling content in the static tree. | Content hidden in a dynamic branch. Do not claim the section is complete. |
| `CONTENT-INSTRUCTION-AMBIGUITY` | Literal instruction text tied to a control by a static id reference. | Workflow state. |
| `CONTENT-ERROR-CLARITY` | Keep literal error text and `aria-errormessage` links as evidence. | Do not dispatch a verdict. Active validation and the validator cause are runtime facts. |
| `CONTENT-TERM-CONSISTENCY` | A bounded list of literal terms from included files, marked as a candidate corpus, plus the file list that was included and the file list that was omitted. | A project-wide "no inconsistency" result. Omitted files make a no-issue conclusion invalid. String variants are not automatically the same concept. Dispatch only if you can ask the model a narrower question the spec allows, and include the omission list in the evidence. If the omissions are large, do not dispatch. |

Evidence states, per item, must stay distinct: `present`, `confirmed_absent`, `not_captured`, `omitted`, `ambiguous`, `unknown`. Only `confirmed_absent` may support a finding whose criterion is absence, and only when the relevant scope finished. An omitted file is not confirmed absence.

## Scheduling rules

- Build units after IBM artifacts exist. You may cite an IBM issue id as a related reference when the sidecar mapped that issue to the same source node. The model prompt must say the IBM issue is a separate checker result, not proof of the contextual rule.
- One unit is one target plus one rule. Do not pack the whole project into one prompt.
- Cap evidence text with the existing excerpt limits from the single-file adapter. If you need a project-level cap, 20 units scheduled per request is a reasonable default, aligned with the projection cap. Further targets are `not_assessed` with reason `request-budget`. If the scheduler already has a lower cap, the scheduler wins. Do not raise it.
- Do not assign all six models to every unit yourself. Pass the units through the existing eligibility and assignment logic. The report lists each model's status, including `blocked`, `quota_limited`, and `failed`.
- Provider failure does not change IBM results already collected in prompt 03.
- Reject model output that cites evidence ids you did not send. Reuse [backend/src/ai/assessmentValidation.ts](../../backend/src/ai/assessmentValidation.ts). Extend the allow-list only so project target ids and source locations validate. Do not accept an evidence id that was not in the unit.
- Status values remain `potential_issue`, `no_issue_detected`, and `insufficient_context`. `no_issue_detected` is allowed only when the evidence the rule required was present and sufficient. Partial trees use `insufficient_context` or `not_assessed`, not a clean bill of health.

## Cross-file candidates for rules 6, 14, and 20

Implement grouping in `backend\src\services\reactProjectCandidates.ts`.

A group is a set of targets whose authored strings match after Unicode normalization and case-folding. The group stores the strings, files, and lines. The group is not a finding.

The model may see a group only together with a statement of what was not proved: same action, same widget type, or same concept. If that statement's required evidence is missing, do not send the group. Tests must show that two buttons both labeled `Save` in different files produce a candidate and do not produce `potential_issue` from the grouper itself. The grouper is deterministic. It does not call a model.

## Report fields this prompt must fill

`aggregateAdvisoryReport` already returns models, jobs, findings, and `fixingPrompt`. Feed it the six `MODEL_CANDIDATES` and the mocked or real outcomes, plus the IBM issues from prompt 03 so related ids can be attached when they truly map.

Add project-specific fields on the project response without removing the advisory report:

- `ruleCoverage[]` with `ruleId`, `evidenceAvailability`, `scheduledUnitCount`, `notAssessedCount`, `reasons[]`
- `candidateGroups[]` for rules 6, 14, and 20, each marked `equivalence: "not_proven"` unless you have the explicit evidence above
- `budget` with scheduled count and not-assessed count

Prompt 05 renders these. Returning them from the API is part of this prompt even if the UI is still the prompt 01 manifest.

## Tests

Use a stub scheduler that records the units it received and returns a fixed outcome list. Assert:

- IBM still runs first: the stub rejects if it is called before the IBM function resolves. A simple call-order array is enough.
- Raw JSX source of an entire file is not inside the unit evidence. Excerpts can appear. A fixture secret placed in a comment of an accepted file must not be copied wholesale into a unit; keep excerpts on the target element only. Do not put real secrets in fixtures. Use the marker `NOT_EVIDENCE_SENTINEL` in a file-level comment and assert it is absent from scheduled units.
- `.env` is not a unit source.
- Rules 13, 15, and 19 produce coverage rows and zero scheduled units.
- Rules 1 and 2 are not scheduled solely because `src` is `hero.png`.
- Two `Save` buttons become a rule-6 candidate and not a deterministic violation.
- The 21st eligible unit is `not_assessed` with `request-budget` if your cap is 20.
- A stub outcome that references an unknown evidence id is invalid and is not shown as a finding. Use the existing validation tests as the pattern.
- `MODEL_CANDIDATES` deep-equality in a test, or a snapshot of the six ids, fails if someone edited the config. Do not update that assertion to match a new model.
- `POST /api/analyze` and `POST /api/analyze-source` tests still pass, including their scheduler expectations.

## Acceptance

- One project request performs all IBM scans, then one scheduler invocation.
- Eligible units contain bounded, rule-specific evidence and source locations.
- Ineligible rules and exhausted budget show as not assessed.
- Model output cannot alter IBM counts.
- No file under `backend\src\ai\` changed except a type field you justified in the mismatch check. If you changed a provider, revert it.

## Explicitly out of scope

- Live inference, new model ids, higher token limits, and extra retries.
- Fetching images or URLs to "complete" rules 1, 2, 7, 8, or 9.
- Browser automation for computed names and rules 13, 15, and 19.
- Editing the uploaded project.
- UI layout beyond what is required to return JSON. Prompt 05 owns the screen.

## Done when

The stubbed project request returns IBM artifacts plus rule coverage and an advisory report, the abstention tests pass, and you stop before [05-unified-report-and-ui.md](05-unified-report-and-ui.md).
