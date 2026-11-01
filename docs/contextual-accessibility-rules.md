# Contextual Accessibility Rules — Technical Specification

**Status:** Rule decisions and ML assessment are not implemented. A static multi-HTML extraction foundation is implemented separately from the rule evaluator. Proposed identifiers, statuses, metrics, and thresholds require project approval. This document does not select a model or establish model accuracy.

## 1. Project objective and boundaries

Define 20 contextual checks for a future analyser that may process one HTML document, a set of project pages, rendered React routes/states, or (later) website URLs. The rules distinguish mechanical facts from semantic judgments and require traceable evidence and abstention when the inputs cannot support a conclusion.

The current backend accepts one HTML string per `POST /api/analyze`, uses `parse5` for V2 extraction, adapts the snapshot into per-target units, and runs IBM Equal Access Checker. The V2 result is currently discarded by `analyzeHtml`; it is not exposed as ML input or returned by the existing API. A separate `extractHtmlProjectContext` service accepts explicitly supplied HTML files and produces static project context; it does not change the endpoint, run rules, or alter IBM findings and summary counts.

This specification:

- Defines **proposed contextual assessment rules**, not 20 confirmed WCAG failures.
- Does not claim a pretrained model exists or that these rules are presently assessable.
- Does not treat generic nearby DOM text, image pixels, computed accessible names, event actions, routes, or cross-page equivalence as present in V2 unless stated below.
- Requires future analysis to reuse the existing V2 extraction and adapter, extending them only when a rule's required evidence justifies an approved Phase 3 extension. Never add duplicate HTML parsing as an ML workaround.
- Keeps ML advisory results separate from IBM `issues`, IBM levels, and IBM summary counts.

## 2. Assessment statuses and decision contract

Each contextual assessment has exactly one proposed status:

- **`potential_issue`** — provided evidence meets the rule's potential-problem criteria. It is an advisory, not a confirmed WCAG violation.
- **`no_issue_detected`** — sufficient, relevant evidence was available and met the rule's acceptable criteria. This is not a guarantee of accessibility or conformance.
- **`insufficient_context`** — evidence is missing, incomplete, ambiguous, conflicting, outside the rule's scope, or requires unavailable runtime/project information. This is a valid result, not a negative finding.

Use deterministic checks first. A model may only assess a semantic question explicitly assigned to that rule and only from supplied evidence. It must not infer missing relationships, image contents, destinations, actions, user intent, equivalence, or dynamic state. If evidence completeness is partial, rule-specific policy must either limit the conclusion to intact evidence or abstain; it must never silently treat partial input as complete.

### Evidence availability and absence

For every required evidence item, distinguish:

- **Present:** captured and available for this assessment.
- **Confirmed absent:** the relevant extraction/rendering scope completed, and the extractor explicitly established that the content or relationship is absent.
- **Not captured:** the current extractor does not collect that evidence or relationship.
- **Omitted or incomplete:** truncation, record/character limits, unsupported or unresolved references, failed parsing/rendering, or incomplete page/project coverage may have hidden it.
- **Unknown:** capture status cannot be established.

An empty or missing field is not, by itself, proof of confirmed absence. In particular, `[P3]` not producing a prose relationship is **not captured**, not proof that no relevant prose exists. Only confirmed absence may support a finding whose criterion is specifically that the content or relationship is absent; even then, assess whether the absence matters under that rule. Not captured, omitted/incomplete, and unknown evidence must not be converted into `potential_issue`; abstain or limit the claim to other sufficient evidence. If a rule reports multiple subchecks, each must retain its own evidence-availability status.

### Common proposed output shape

This is a conceptual contract, not an existing API type:

```json
{
  "ruleId": "BUTTON-PURPOSE-CLARITY",
  "targetId": "project://app/src/Form.tsx#route:/account#component:SaveButton",
  "assessmentStatus": "insufficient_context",
  "location": {
    "projectId": "optional",
    "file": "optional",
    "route": "optional",
    "component": "optional",
    "sourceLocator": "optional"
  },
  "evidence": [
    {
      "evidenceId": "optional",
      "source": "dom|browser|source|project-index",
      "relationship": "optional",
      "excerpt": "bounded, exact supporting text"
    }
  ],
  "explanation": "Short statement grounded only in supplied evidence.",
  "confidence": null
}
```

`ruleId` and `targetId` are required. Location fields are nullable/omitted when unavailable. Each claim should cite evidence IDs where available; excerpts must be bounded and preserve provenance. `confidence` is omitted/null unless calibration and meaning are validated for the selected method; do not expose raw language-model token probabilities as user-facing confidence. Output schema and proposed IDs require implementation review. Never copy a contextual assessment into the IBM issue list.

## 3. Shared evidence model and current availability

### Phase 3 V2 facts

The active types are in [`backend/src/types/contextV2.ts`](../backend/src/types/contextV2.ts). The extractor is [`backend/src/services/contextExtractionV2.ts`](../backend/src/services/contextExtractionV2.ts); the per-target adapter is [`backend/src/services/contextAdapterV2.ts`](../backend/src/services/contextAdapterV2.ts).

V2 currently represents:

- A schema-versioned snapshot with document title/language, typed targets, evidence records, relationships, and completeness.
- Targets of kind `image`, `link`, `button`, `form-control`, `heading`, `custom-widget`, or policy-selected `other`.
- Bounded target text and source locator; common observed attributes include authored ID, role, captured ARIA values (including `aria-live`), title, hidden/inert, and tab index. Kind-specific attributes include image `alt`/`src`, link `href`/coarse `hrefKind`, button state/value, and form-control type/name/placeholder/autocomplete/required/disabled/checked/selected as appropriate.
- Attribute states that distinguish present, absent, ambiguous, unavailable, and invalid.
- **Actually produced evidence kinds:** `native-label` for associated HTML labels and `aria-reference` for resolved, unresolved, ambiguous, or unknown `aria-labelledby`, `aria-describedby`, and `aria-errormessage` references. The type `structural-context` exists, but no producer in the active V2 extractor emits that evidence kind.
- Separate `parent-child` structural relationships between included records (targets and/or evidence), based on the nearest included ancestor. This connects records; it does not by itself establish semantic relevance.
- Target-to-evidence relationships for native labels and the three captured ARIA ID-reference attributes, with resolution state and provenance.
- Parser diagnostics are retained with source offsets. Duplicate-attribute diagnostics make affected authored attributes unavailable and mark affected evidence/incompleteness; uncertain references are not promoted to confirmed absence or resolved relationships.
- Explicit completeness, unresolved/ambiguous/unknown relationship counts, and truncation/omission metadata.

Current bounds include at most 500 total target/evidence records, 500 characters of extracted text, and 250 characters per attribute value. The adapter caps associated evidence at 8 records, evidence text at 2,400 characters per target unit, and serialized unit size at 8,000 characters. These limits can cause partial inputs and must be retained downstream. Source locators are document-local DOM paths or source ranges; target IDs such as `t-1` are document-local sequence IDs, not stable project-wide identifiers.

V2 parses one static submitted HTML document. It does **not** run JavaScript, render CSS, compute browser accessibility names, expose visible text distinct from DOM text, resolve href destinations, inspect React component/source code, observe handlers/state transitions, fetch images, or aggregate pages/routes. The project extension below adds bounded static context; neither API establishes full rendered section/workflow semantics.

### Static multi-HTML extraction foundation

`backend/src/services/contextExtractionProject.ts` accepts a caller-provided list of `{documentId, filePath, html}` values and invokes the shared V2 parser once per document. It preserves document-local V2 IDs/source locations, adds bounded static context records for headings, labels, forms/groups/sections, lists, tables/captions, figures, and text-bearing elements, and records DOM parent/child, adjacent-element, native-label, ARIA-reference, form-owner, field-group, caption, and heading-to-content relationships. It does not discover files or routes.

The project result keeps `present`, `confirmed-absent`, `not-captured`, `omitted-incomplete`, `ambiguous`, and `unknown` distinct. It records authored accessible-name inputs without calculating an accessible name; records static text separately from rendered-visible text; resolves relative href paths against the supplied file list using a captured `<base href>` when available; and preserves query and fragment identity. Fragment existence is not checked. Cross-document groups compare exact authored link text, target text, context text, or the same supplied destination. Such groups are literal comparison facts, not semantic equivalence or accessibility findings. A missing destination from the supplied set remains unknown; no URL is fetched.

Static surrounding text and relationships are bounded and carry per-record/project completeness. Editable-region and form-control values are excluded from surrounding prose. V2 remains the single parser/extractor; the former V1 implementation is now a deprecated compatibility projection over V2, not a second extraction path. The project foundation does not integrate with `/api/analyze`.

### Evidence provenance labels used below

- **`[P3]`** — represented/emitted by active V2 today, within the bounds above.
- **`[EXT]`** — requires an explicit extension to Phase 3 extraction/schema/adapter; not available today.
- **`[BROWSER]`** — requires browser-rendered analysis, accessibility-tree computation, or rendered visual/state inspection.
- **`[REACT]`** — requires source/build analysis of React components, event handlers, routes, or app metadata.
- **`[PROJECT]`** — requires stable project identity, aggregation/indexing across files/routes/pages/states.
- **`[IMAGE]`** — requires actual image input or a vision-capable system; filenames are not image evidence.
- **`[PROJECT-HTML]`** — emitted by the static multi-HTML foundation for explicitly supplied HTML only; it does not imply full project coverage, rendered behavior, or semantic equivalence.

Multiple labels mean multiple distinct prerequisites. “Supported” never implies that the evidence is complete in every input.

## 4. Detailed specifications: 20 rules

### 4.1 Images

#### Rule 1 — Alt-text relevance (`IMG-ALT-RELEVANCE`)

1. **Objective:** Determine whether authored alternative text serves the image's evidenced purpose in context, without asserting visual accuracy when pixels are unavailable.
2. **Scope:** `img` and image-input targets; image-only links/buttons; figures and complex images. `[PROJECT-HTML]` supplies bounded static context and DOM relationships; image-grounded judgments still need `[IMAGE]`.
3. **Required evidence:** Target identity, `alt` state/value, role, link/button parent, figure/caption, nearby heading/paragraph/section, and image visual content when claiming description-to-image accuracy. `[P3]` supplies an image target and observed alt; `[PROJECT-HTML]` supplies captured static context nodes and structural/adjacency relationships. These relationships do not prove semantic relevance. Rendered context may require `[BROWSER]`; pixels require `[IMAGE]`.
4. **Evidence relationships:** Image-to-action parent; figure-to-caption; section heading and relevant prose; equivalent image descriptions elsewhere `[PROJECT]`. These are not inferred from proximity alone.
5. **Deterministic checks:** Identify alt presence/empty value and captured roles/attributes; detect image within included target hierarchy only when relationship exists. Do not infer image content from filename.
6. **ML assessment:** Compare alt wording with the evidenced role, purpose, caption, and associated text. Evaluate action/destination wording for functional images. Visual correspondence is assessable only with actual image input and a separately validated vision method.
7. **Evaluation criteria:** `potential_issue` if sufficient evidence shows an alt that is unrelated, misleading, or fails to name a known action/purpose. `no_issue_detected` only if available text is useful and consistent with known purpose; without pixels, this cannot mean visually accurate. Empty alt is acceptable when the image is established decorative; it is concerning for an evidenced informative/functional image. Otherwise `insufficient_context`.
8. **Abstention:** No image pixels for visual accuracy; unknown image role/purpose; empty alt with no evidence of decorativeness; missing or partial caption/context; unresolved parent action; truncation; inaccessible external resource.
9. **Expected output:** Common output with target/image source references, exact alt and cited context records; explicitly indicate whether judgment is textual-purpose-only or image-grounded. No fabricated image description.
10. **Positive example:** `<a href="/checkout"><img src="x" alt="Company logo"></a>` where project evidence establishes the link action is “Place order”; flag only as a potential mismatch between functional name and known action, not visual-image mismatch.
11. **Negative example:** `<img src="x" alt="">` in an evidenced decorative flourish with no information/action.
12. **Borderline example:** `<img src="chart.png" alt="Sales chart">` with no chart pixels, caption, or data context; abstain.
13. **Evaluation method:** Human reviewers label image purpose, decorative/informative/functional/complex status, and alt relevance using actual image and surrounding context. Include HTML-only cases where expected outcome is abstention, and paired cases where only the image changes. Score text-only and image-grounded subtasks separately.

#### Rule 2 — Alt-text clarity (`IMG-ALT-CLARITY`)

1. **Objective:** Detect alt wording that is confusing, too vague for its known purpose, overloaded, or includes unexplained abbreviations/irrelevant detail.
2. **Scope:** Non-empty image alternative text; evaluate empty alt under Rule 1, not as unclear wording.
3. **Required evidence:** Exact alt, image purpose/role, associated action/caption/context, and pixels when clarity depends on visual details. `[P3]` supplies target attributes; `[PROJECT-HTML]` supplies bounded static text/context relationships, while purpose/action may still need `[REACT]`/`[BROWSER]`; pixels need `[IMAGE]`.
4. **Evidence relationships:** Use captured DOM ancestry and adjacent-element links to inspect image function/caption/section candidates; these are structural evidence only and do not assert semantic relevance.
5. **Deterministic checks:** Detect empty/whitespace text, truncation, duplicate literal phrases, and suspiciously generic terms as candidate features only. No fixed length/word-count rule.
6. **ML assessment:** Judge whether a reader can understand useful information in the alt for its evidenced purpose; examine ambiguity, unexplained abbreviations, and irrelevant detail without requiring a particular style.
7. **Evaluation criteria:** Potential issue requires a concrete, evidence-cited clarity defect relevant to an established image purpose. No issue requires wording understandable and suitably informative in that context. Short text is not inherently unclear; long text is not inherently excessive. Unknown purpose does not establish that the alt is vague.
8. **Abstention:** Purpose/context is not captured, omitted, incomplete, or unknown; pixels needed for the claim are unavailable; language is unsupported; alt is truncated; context conflicts; or a complex image requires data not supplied. Even if a complete capture confirms no surrounding purpose/context exists, abstain from judging purpose-relative clarity unless the image or other supplied evidence establishes the intended purpose.
9. **Expected output:** Common output plus exact alt span and purpose/context evidence; state whether visual content was available.
10. **Positive example:** `<img alt="Thing">` for an evidenced informational diagram whose captured caption and section text establish that it compares monthly rainfall across three cities; the alt does not communicate that established purpose.
11. **Negative example:** `<img alt="Quarterly revenue by region, 2024">` when that is the supported purpose and chart content.
12. **Borderline example:** `<img alt="ACME">` where reviewers cannot tell if this is a logo, product, or decorative image; abstain.
13. **Evaluation method:** Pair identical alt strings with different human-established purposes; have reviewers label clarity and reason. Include abbreviations, short correct labels, long necessary text, and abstention cases; measure per-context agreement.

#### Rule 3 — Unnecessary alt-text wording (`IMG-ALT-REDUNDANCY`)

1. **Objective:** Identify wording that adds no useful information because it redundantly announces an image or repeats accessible context.
2. **Scope:** Non-empty image alt, evaluated against its image role, accessible role, and associated surrounding content.
3. **Required evidence:** Exact alt, role/purpose, computed accessible context where available, caption/adjacent text, and image pixels if needed. `[P3]` has alt/role attributes; `[PROJECT-HTML]` adds bounded static context and relationships; computed roles/names `[BROWSER]`, pixels `[IMAGE]`.
4. **Evidence relationships:** Figure caption, link/button action, adjacent text, repeated description, and other equivalent content `[PROJECT]` where applicable.
5. **Deterministic checks:** Detect literal duplicated text and possible phrases such as “image of” only as candidates. Do not flag keywords in isolation.
6. **ML assessment:** Determine whether a phrase contributes context (for example, distinguishing a diagram from a photograph) or merely repeats role/nearby wording.
7. **Evaluation criteria:** Potential issue only when the cited phrase adds no useful distinguishing information in the established context. No issue when it identifies a useful medium/type or meaning. Neither “photo” nor “diagram” is automatically redundant.
8. **Abstention:** No surrounding or accessible context to establish redundancy; unclear image role; text truncated; language or intent unclear.
9. **Expected output:** Common output citing the alt phrase and the exact duplicated/role evidence; do not claim a universal wording prohibition.
10. **Positive example:** `<img alt="Image, image of a picture">` when the only established purpose is the same already announced object.
11. **Negative example:** `<img alt="Diagram: three steps from signup to approval">` where “Diagram” distinguishes a process graphic from adjacent prose.
12. **Borderline example:** `alt="Photo of the team"` beside a heading “Meet our team”; whether “Photo” adds useful information depends on the page context; abstain if context is missing.
13. **Evaluation method:** Annotate phrase-level usefulness using paired contexts that change only caption/role; include legitimate medium descriptors and repetitive cases. Score phrase localization and reviewer agreement.

### 4.2 Buttons

#### Rule 4 — Button purpose clarity (`BUTTON-PURPOSE-CLARITY`)

1. **Objective:** Determine whether the button's name and legitimately associated context let a user understand its purpose.
2. **Scope:** Native buttons, button inputs, and supported custom button-role targets.
3. **Required evidence:** Computed accessible name, visible text, ARIA naming, role/type, form/dialog context, associated instructions, and known action/handler. `[P3]` provides authored target text/attributes and label/ARIA relationships; `[PROJECT-HTML]` adds bounded static form/group/text context. Computed name/visible rendering `[BROWSER]`; actual action `[REACT]` or other source analysis.
4. **Evidence relationships:** Button-to-form/dialog, label references, instruction-to-control, action handler/state transition, and page/component identity.
5. **Deterministic checks:** Identify native/custom button candidates and authored text/attributes. Standards-based computed name requires `[BROWSER]` or a separately validated implementation; do not have ML calculate it. Static HTML cannot establish handler behavior.
6. **ML assessment:** Assess semantic clarity only when a non-empty computed name and sufficient associated purpose/context evidence are available. Assess name-to-behavior consistency separately and only when actual behavior is evidenced. Missing-name detection is a separate deterministic result, not a semantic clarity judgment.
7. **Evaluation criteria:** For semantic clarity, potential issue requires a non-empty computed name that is unclear or misleading relative to an evidenced purpose/action; no issue requires sufficient evidence that the name/context communicates that purpose. A missing computed name is reported separately as a deterministic missing-name result. Missing or uncaptured purpose/action evidence is not proof of unclear naming.
8. **Abstention:** Computed name unavailable or empty for the semantic subcheck; purpose/context is not captured, omitted, incomplete, or unknown; action is unknown for behavior claims; dynamic state/handler unresolved; or relevant relationships partial. A separate deterministic check may still report a confirmed missing name.
9. **Expected output:** Common output, button target, computed-name source/version if available, and separate results for (a) deterministic name presence, (b) semantic name clarity, and (c) name/behavior consistency. Preserve each subcheck's evidence-availability status.
10. **Positive example:** A rendered button has computed name “thing”; complete associated form and action evidence establishes that it deletes the current draft. The non-empty name does not communicate that purpose.
11. **Negative example:** A “Save changes” button has a computed name of “Save changes,” and complete form/action evidence establishes that it saves edited settings.
12. **Borderline example:** `<button>Go</button>` in static HTML where purpose/action context is not captured; abstain on semantic clarity and behavior consistency, rather than treating missing context as a defect.
13. **Evaluation method:** Test name clarity separately from action truth. Use browser-computed names and controlled handler/source fixtures, with blind reviewer annotations; include unknown-action cases requiring abstention.

#### Rule 5 — Ambiguous button names (`BUTTON-NAME-AMBIGUITY`)

1. **Objective:** Detect names that could reasonably denote multiple actions in the target's usable context.
2. **Scope:** Button names, including short names and repeated labels.
3. **Required evidence:** Computed/authored name, role, associated form/dialog/section, related instructions, action evidence, and same-name button instances. `[P3]` supplies target text/attributes and explicit label/ARIA relationships; `[PROJECT-HTML]` supplies bounded static context and cross-file exact-text comparisons. Rendered dialog state/actions require `[BROWSER]`/`[REACT]`; project-wide component identity/equivalence requires `[PROJECT]`.
4. **Evidence relationships:** Name-to-control context, form submit scope, dialog state, nearby topic, action handler, and same-name targets.
5. **Deterministic checks:** Group exact duplicate names only when computed names exist; discover short/generic literals as review candidates. Duplicate/short names alone do not prove ambiguity.
6. **ML assessment:** Decide whether multiple materially different interpretations remain only after considering available programmatically associated context and any known action. Repeated or generic names are candidate signals, not evidence of ambiguity by themselves.
7. **Evaluation criteria:** Potential issue only when evidence establishes at least two materially different plausible interpretations in the target's usable context and confirms that available context does not disambiguate them. Repeated generic names alone do not satisfy this criterion. No issue when context/action uniquely identifies purpose, including repeated “Delete” controls scoped to distinct, named records. A capture gap cannot prove that disambiguating context is absent.
8. **Abstention:** Purpose/context/action is not captured, omitted, incomplete, or unknown; name computation unavailable; repeated instances are outside the indexed scope; or dynamic dialog/state is not captured. If a complete relevant capture confirms that no disambiguating context is present, a potential issue still requires evidence of materially different plausible interpretations.
9. **Expected output:** Common output with competing interpretations stated only as hypotheses grounded in cited evidence.
10. **Positive example:** In a fully captured payment workflow, a “Continue” button follows two equally active, distinct choices (“Save as draft” and “Publish now”); the complete rendered context supplies no selected-choice indicator or other association identifying which action “Continue” will take. The competing interpretations are evidenced by the workflow, not by repetition of the button name.
11. **Negative example:** Two buttons are both named “Delete,” but complete captured associations identify one as “Delete invoice 4821” and the other as “Delete invoice 7350”; the repeated name alone does not make either ambiguous.
12. **Borderline example:** Two buttons named “More” appear in a static fragment whose card associations and rendered behavior were not captured; abstain because repetition alone does not establish ambiguity.
13. **Evaluation method:** Create matched sets for “Go”, “More”, “Submit”, and repeats with/without explicit context. Reviewers list plausible actions; score issue detection and correct abstention.

#### Rule 6 — Action-name consistency (`BUTTON-ACTION-CONSISTENCY`)

1. **Objective:** Detect a mismatch between a button name and known action, or confusing terminology drift across equivalent actions.
2. **Scope:** Buttons with known actions; equivalent buttons across components/routes only with project aggregation.
3. **Required evidence:** Computed name, visible/authored text, handler/action/state transition or navigation, component identity, and equivalent instances. Name/role partly `[P3]`; behavior `[REACT]`/`[BROWSER]`; equivalents `[PROJECT]`.
4. **Evidence relationships:** Name-to-handler mapping, state transition, route destination, and equivalence relation between actions.
5. **Deterministic checks:** Resolve literal static `type`/href where relevant; do not equate submit with actual operation, nor infer handler behavior from label. Source-analysis can identify handler references but semantic outcome may remain unknown.
6. **ML assessment:** Compare wording with an evidenced action and compare terminology only after equivalence has been established.
7. **Evaluation criteria:** Potential issue for materially misleading wording or inconsistent terms that can confuse users across the same verified action. No issue for harmless wording variants or distinct actions.
8. **Abstention:** Unknown action/equivalence, dynamic effects unobserved, incomplete project coverage, name computation unavailable.
9. **Expected output:** Common output with action-source and equivalence provenance; separate single-instance mismatch from cross-project terminology finding.
10. **Positive example:** A button visibly named “Cancel order” whose verified handler permanently confirms the order.
11. **Negative example:** Two verified “Save” actions where one saves a draft and one saves a published profile; distinct actions justify differing names.
12. **Borderline example:** Button named “Continue” whose JavaScript handler is unavailable; abstain on action consistency.
13. **Evaluation method:** Use instrumented source fixtures with known handlers and an equivalence label reviewed by humans. Include incomplete bundles and state-specific labels; score mismatch and terminology subtask separately.

### 4.3 Links

#### Rule 7 — Link purpose clarity (`LINK-PURPOSE-CLARITY`)

1. **Objective:** Determine whether the link purpose is understandable from its name alone or its programmatically associated context, and whether wording matches a known destination.
2. **Scope:** Native anchors and supported link-role targets; page-level context is necessary.
3. **Required evidence:** Computed accessible name, visible text, href resolved against base URL, destination/page title or content, associated paragraph/list/table/section, instructions, and relevant repeated instances. `[P3]` captures target text and raw href; `[PROJECT-HTML]` resolves relative paths only among supplied files and supplies bounded static context. It does not fetch destinations, validate fragment existence, or compute names. Remaining inputs require `[BROWSER]`, `[PROJECT]`, or URL-stage analysis.
4. **Evidence relationships:** Link to text in same sentence/paragraph/list item/table cell/header, section heading, actual destination, and cross-page repeats.
5. **Deterministic checks:** Detect missing href, raw href, and structural target relationships. Do not treat href existence or substring as meaningful purpose.
6. **ML assessment:** Assess purpose clarity only from supplied name, programmatically associated context, and verified destination evidence.
7. **Evaluation criteria:** Potential issue only where sufficient evidence shows that the name alone is unclear and either (a) a complete relevant capture confirms no associated context is available to clarify it, or (b) captured associated context/destination still leaves its purpose unclear or conflicts with a verified destination. No issue where the name or valid associated context communicates purpose. An extractor gap is not evidence that context is genuinely absent.
8. **Abstention:** Computed name unavailable; potentially relevant context is not captured, omitted, incomplete, or unknown; destination unresolved when needed; external destination not fetched; page/project coverage incomplete; or evidence truncated. If complete capture confirms no associated context, assess whether the name itself sufficiently communicates purpose before deciding.
9. **Expected output:** Common output citing link name, context relationship and destination evidence separately.
10. **Positive example:** In a complete capture of the relevant page and link relationships, `<a href="/x">Click here</a>` has no associated text, and verified destination evidence shows that `/x` is the account-deletion page. The name and complete absence of clarifying context leave the link's purpose unclear; the finding is not based merely on V2 failing to extract prose.
11. **Negative example:** “Download the accessible invoice (PDF)” is associated with the relevant invoice and links to a verified accessible-invoice PDF.
12. **Borderline example:** `<a href="/x">Read more</a>` has no topic prose or destination title in the supplied V2 unit, but the capture did not establish that no such context exists; abstain because the context may simply not have been captured.
13. **Evaluation method:** Pair generic/explicit names with controlled context and destination metadata. Human reviewers judge purpose from allowed evidence; include absent-destination and incomplete-page abstention cases.

#### Rule 8 — Generic link text (`LINK-GENERIC-TEXT`)

1. **Objective:** Find link names that contribute little information when considered with their actual programmatic context.
2. **Scope:** Links with generic/short wording and repeated instances.
3. **Required evidence:** Computed name, associated topic text, structural relation and resolved destination, including other same-name links. `[P3]` supplies target text/href/label relationships; `[PROJECT-HTML]` supplies static context and destinations only for supplied files. Computed name needs `[BROWSER]`; absent files remain unknown and are not crawled.
4. **Evidence relationships:** Generic link to relevant teaser/topic heading, card/article container, table row/cell, and destination identity.
5. **Deterministic checks:** Candidate lexicon for “Click here”, “Read more”, “Learn more”, “More”, “Here”; never automatically flag a lexicon hit. Resolve explicit references only when represented.
6. **ML assessment:** Decide whether associated topic context makes the link distinguishable and meaningful; compare repeated generic names with destinations.
7. **Evaluation criteria:** Potential issue only when complete, relevant evidence shows that generic wording plus its programmatic context does not distinguish the link's purpose, such as verified distinct destinations with no programmatic association to their distinct topics. No issue where the name or programmatic context uniquely identifies the item/purpose. Repeated generic names or different destinations alone do not prove an ambiguity or clarity problem.
8. **Abstention:** Topic context or destination is not captured, omitted, incomplete, or unknown; relation to teaser is visual/proximity-only; or repeated pages are not indexed. A potential issue based on absent context requires complete capture confirming the relevant association is genuinely absent, plus evidence that the link purpose remains unclear.
9. **Expected output:** Common output with generic phrase span, linked context evidence, and compared destination IDs if available.
10. **Positive example:** A complete rendered/relationship capture shows two “Read more” links to verified, different articles. Each is visually adjacent to a different topic heading, but the full captured structure confirms neither heading is programmatically associated with its link; the links' names and available programmatic context do not distinguish their purposes.
11. **Negative example:** “Read more” is programmatically associated with the heading “How to renew your passport,” and the verified destination is the passport-renewal guide.
12. **Borderline example:** A V2 unit contains a “Learn more” link and no topic text; because arbitrary prose/association is not captured by V2, this does not establish that context is absent, so abstain.
13. **Evaluation method:** Build positive/negative pairs changing only programmatic association or destination. Annotators label the allowable context window and whether it uniquely resolves purpose.

#### Rule 9 — Similar-looking links with unclear purposes (`LINK-SIMILAR-CHOICES`)

1. **Objective:** Identify link choices that are visually or textually alike yet expose materially different purposes without adequate distinction.
2. **Scope:** Groups of links within a page, then cross-page only if comparison is justified; requires rendered view for visual similarity.
3. **Required evidence:** Computed/visible names, destinations, page groups, associated headings/context, rendered positions/styles, and completeness. Target text/href `[P3]`; supplied-file destinations and literal cross-page comparison groups `[PROJECT-HTML]`; rendered visual similarity `[BROWSER]`; project equivalence/coverage `[PROJECT]`.
4. **Evidence relationships:** Compare members within same menu/list/table/card grid and corresponding labels/destinations; do not compare unrelated links merely because strings match.
5. **Deterministic checks:** Detect identical/near-identical text and differing href strings as candidate pairs. DOM string similarity does not establish visual similarity or confusion.
6. **ML assessment:** Decide whether the set creates genuinely indistinguishable choices after considering the supplied visual and semantic context.
7. **Evaluation criteria:** Potential issue when similar-looking names point to materially different purposes and associated context does not distinguish them. No issue when repeated names are grouped with clear individual topics or destinations.
8. **Abstention:** No rendered view for visual claim; destination unresolved; group membership unknown; no cross-page identity mapping.
9. **Expected output:** Common output per ambiguous link group, listing all target IDs, names, destination evidence and visual evidence provenance.
10. **Positive example:** A rendered results panel shows three visually identical “Open” links to unrelated documents with no distinguishable row names programmatically associated.
11. **Negative example:** Three “Open” links in rows whose accessible names include distinct document titles.
12. **Borderline example:** Anchor labels all say “View” and DOM order suggests separate cards, but card headings are not associated/rendered; abstain.
13. **Evaluation method:** Use rendered-page fixtures and human pair/group annotations. Evaluate visual similarity and semantic indistinguishability separately; DOM-only cases should be expected abstentions for visual criterion.

### 4.4 Forms

#### Rule 10 — Label relevance (`FORM-LABEL-RELEVANCE`)

1. **Objective:** Determine whether an associated label accurately describes the information expected in a form control.
2. **Scope:** Inputs, selects, textareas, and supported form widgets.
3. **Required evidence:** Control type/role, computed name, native label, `aria-label`/`aria-labelledby`, descriptions/instructions, group/form purpose, expected value and validation messages. `[P3]` captures target attributes and native-label/ARIA-reference evidence; `[PROJECT-HTML]` adds bounded form/group/static text context. Computed name `[BROWSER]`; validation state/value and expected business meaning need runtime/application evidence.
4. **Evidence relationships:** Control-to-native-label, IDREF naming/description, fieldset/legend/group, instructions, error and form workflow.
5. **Deterministic checks:** Resolve captured label/ARIA IDREF status; identify input type, required/disabled, name/placeholder. A placeholder is not proof of persistent label. No semantic mismatch conclusion from attribute names alone.
6. **ML assessment:** Compare label wording with independently evidenced expected information and form context.
7. **Evaluation criteria:** Potential issue when resolved label meaning conflicts with evidenced expected value or misleads. No issue when it accurately describes expected information. Do not infer expected value from `name` attribute alone.
8. **Abstention:** No known expected information; unresolved/ambiguous relationship; conflicting labels; custom widget unsupported; missing state/error context.
9. **Expected output:** Common output citing control ID, exact label relationship and expected-purpose evidence; distinguish accessible-name absence from semantic label mismatch.
10. **Positive example:** `<label for="zip">Email address</label><input id="zip" type="text">` where form schema establishes postal code is expected.
11. **Negative example:** “Email address” label for a field whose verified expected value is email.
12. **Borderline example:** Label “Code” with no form purpose or field instructions; abstain.
13. **Evaluation method:** Construct typed forms with known expected-value schema and controlled wrong labels. Reviewers independently judge label-to-value fit; include ambiguous/unknown business-purpose cases.

#### Rule 11 — Ambiguous labels (`FORM-LABEL-AMBIGUITY`)

1. **Objective:** Detect labels that permit materially different interpretations in the supplied form context.
2. **Scope:** Associated form labels/names; includes repeated labels and groups.
3. **Required evidence:** Computed name, label text, control type, form/group context, other fields, instructions and expected data. Label evidence `[P3]`; `[PROJECT-HTML]` adds bounded form/group/static text context; computed name `[BROWSER]`; task semantics may remain unavailable.
4. **Evidence relationships:** Label-to-control, field-to-group, labels of sibling fields, task and instructions.
5. **Deterministic checks:** Find short/repeated labels and relationship ambiguity. Repetition/shortness alone is not a failure.
6. **ML assessment:** Determine whether multiple plausible expected values remain after considering supplied field/group context.
7. **Evaluation criteria:** Potential issue when at least two plausible inputs remain and context does not disambiguate. No issue when “Name”, “Date”, “Type”, or “Number” is unambiguous in the task context.
8. **Abstention:** No task/form context, duplicate IDs/ambiguous labels, or expected data unknown.
9. **Expected output:** Common output with plausible interpretations linked to evidence, not asserted as user fact.
10. **Positive example:** A form has “Date” for two unrelated dates with no qualifier/instructions.
11. **Negative example:** “Date” in a section explicitly headed “Date of birth” with only one date field.
12. **Borderline example:** “Number” in a billing form with a phone-number field and invoice-number field, but no associated group; abstain.
13. **Evaluation method:** Contrast identical labels across contexts; human reviewers list plausible interpretations and resolve disagreements. Track abstention correctness.

#### Rule 12 — Placeholder-only guidance (`FORM-PLACEHOLDER-ONLY`)

1. **Objective:** Identify controls for which placeholder text is the only visible guidance because no appropriate persistent visible label is present. Evaluate accessible-name presence separately; a computed accessible name does not establish a persistent visible label, and a visible label does not by itself establish the computed accessible name.
2. **Scope:** Form controls with placeholder attributes. This rule's primary result concerns rendered visible-label presence; accessible-name presence is a separate deterministic subcheck, not a substitute for that result.
3. **Required evidence:** Placeholder, native/ARIA labels, computed accessible name, rendered visible label persistence, focus/filled states and instructions. Placeholder/name/label reference facts partly `[P3]`; browser-rendered persistence/visibility `[BROWSER]`.
4. **Evidence relationships:** Control-to-label and instruction; relationship must not equate placeholder with visible persistent label.
5. **Deterministic checks:** Detect placeholder attribute and captured label/name relationships. Browser rendering must establish whether a visible label is present and persistent across relevant states. Compute accessible-name presence separately; do not infer visible-label presence from it, or accessible-name presence from a visible label or placeholder.
6. **ML assessment:** None required for detecting placeholder/label presence. Optional semantic assessment of label suitability follows Rule 10, not this rule.
7. **Evaluation criteria:** For the visible-label subcheck, potential issue requires a complete relevant browser-state capture confirming there is no appropriate persistent visible label and the placeholder is the only visible guidance. No issue when an appropriate visible label persists; placeholder may coexist with it. Report accessible-name presence independently, including a confirmed missing name, without allowing either subcheck to stand in for the other.
8. **Abstention:** Abstain on visible-label status when rendered visibility/persistence or relevant focus/filled states were not captured, were omitted, or are unknown. Abstain on accessible-name presence only when computed-name evidence is unavailable or incomplete. One subcheck may be decided while the other abstains.
9. **Expected output:** Common output with distinct deterministic subresults and evidence-availability states for (a) placeholder presence, (b) persistent visible-label status, and (c) computed accessible-name status. Do not infer one from another or present an unverified browser fact.
10. **Positive example:** `<input placeholder="Email">` has a complete browser capture of empty, focused, and filled states confirming no persistent visible label; report a potential issue for visible-label guidance. Report computed-name presence separately, whether present or absent.
11. **Negative example:** `<label for="email">Email</label><input id="email" placeholder="name@example.com">` has a complete browser capture confirming the visible label persists in empty, focused, and filled states. The placeholder does not make this a placeholder-only visible-guidance issue; assess computed accessible-name presence independently.
12. **Borderline example:** `<input placeholder="Email">` in static HTML where CSS may render a floating label; abstain until rendered states are inspected.
13. **Evaluation method:** Use browser fixtures tested in empty/focus/filled/error states and include static-only abstention cases. Review visible label persistence and computed name separately.

### 4.5 ARIA and naming

#### Rule 13 — Accessible-name clarity (`ARIA-NAME-CLARITY`)

1. **Objective:** Assess whether the actual computed accessible name communicates the supported target's purpose.
2. **Scope:** Targets with computed names, including ARIA widgets and native controls; not raw attributes in isolation.
3. **Required evidence:** Browser-computed accessible name and role, target purpose/context, `aria-label`, `aria-labelledby`, native label/text/title provenance, and descriptions separately. Raw attributes/relationships `[P3]`; bounded static purpose/context `[PROJECT-HTML]`; computed name/role `[BROWSER]`.
4. **Evidence relationships:** Apply accessible-name precedence and trace contributing nodes; keep `aria-describedby` separate from name.
5. **Deterministic checks:** Obtain name from browser accessibility computation or a separately validated standards implementation. ML must not independently compute the name from raw attributes.
6. **ML assessment:** Evaluate semantic clarity only for a non-empty computed name and against associated purpose evidence; do not judge conformance of ARIA syntax. Missing accessible-name detection is a separate deterministic result, not a semantic name-clarity prediction.
7. **Evaluation criteria:** For semantic clarity, potential issue requires a non-empty computed name that is materially vague, misleading, or mismatched to an evidenced purpose. No issue requires sufficient evidence that the name communicates the purpose. A confirmed empty computed name is reported separately as a deterministic missing-name result and is not classified as semantically unclear by this rule.
8. **Abstention:** Abstain on semantic clarity when the computed name is empty/unavailable, the role is unsupported, the purpose/context is not captured, omitted, incomplete, or unknown, dynamic state is not rendered, or referenced content is unavailable. A separate deterministic result may still report a confirmed missing name.
9. **Expected output:** Common output with actual computed name, role, computation source/browser version, trace evidence IDs, and distinct results for deterministic name presence and semantic clarity. Preserve evidence availability for each.
10. **Positive example:** A rendered custom button has the non-empty computed name “thing”; complete form and action evidence establishes that its purpose is “Delete draft,” so the name is materially vague.
11. **Negative example:** A custom switch has the non-empty computed name “Email notifications,” and complete purpose evidence confirms it controls email notifications; this rule assesses name clarity only, not role/state correctness.
12. **Borderline example:** A rendered icon-only control has the non-empty computed name “Account,” but purpose/action context is not captured; abstain on semantic clarity. If the computed name is empty, report that separately as missing-name evidence.
13. **Evaluation method:** Use real browser accessibility snapshots and gold names checked by independent standards-based tooling/reviewers. Annotate clarity separately from name computation correctness.

#### Rule 14 — Naming consistency (`ARIA-NAMING-CONSISTENCY`)

1. **Objective:** Find confusing name variation among controls/components verified to represent equivalent actions or concepts.
2. **Scope:** Repeated components/actions across project pages and dynamic states.
3. **Required evidence:** Computed names, role, component identity, action/concept equivalence, routes/states, and project coverage. Names partially `[P3]`; computed names `[BROWSER]`; equivalence and aggregation `[PROJECT]`/`[REACT]`.
4. **Evidence relationships:** Group only verified equivalent controls; link each member to action/component and context.
5. **Deterministic checks:** Normalize strings and identify variants after trusted equivalence grouping; string mismatch alone is not an issue.
6. **ML assessment:** Assess whether wording variants plausibly confuse users, preserving legitimate differences.
7. **Evaluation criteria:** Potential issue for unexplained inconsistent terms for the same verified action that affect recognition. No issue for equivalent, understandable synonyms when not confusing or for distinct actions.
8. **Abstention:** Incomplete project/page set, equivalence not established, dynamic states not captured, computed names missing.
9. **Expected output:** One group-level assessment with all member targets, source locations, evidence and project coverage.
10. **Positive example:** Verified same “remove saved item” action called “Remove” on one route and “Cancel” on another, where “Cancel” has a different meaning.
11. **Negative example:** “Remove from wishlist” and “Remove from cart” for distinct verified actions.
12. **Borderline example:** Same component appears in one scanned page but app route coverage is unknown; abstain on project consistency.
13. **Evaluation method:** Multi-page/state corpus with human-labeled action equivalence and acceptable variants. Evaluate grouping accuracy separately from semantic consistency.

#### Rule 15 — Conflicting naming information (`ARIA-NAME-CONFLICT`)

1. **Objective:** Identify meaningful conflicts between the computed accessible name, visible text, title, associated labels/descriptions, and evidenced purpose.
2. **Scope:** Named controls, links, widgets, and other supported accessible objects.
3. **Required evidence:** Computed name, visible text, `aria-label`, `aria-labelledby` target text, title, native labels, descriptions, purpose/context, and provenance. Raw ARIA/text `[P3]`; bounded static context `[PROJECT-HTML]`; browser computation and visibility `[BROWSER]`.
4. **Evidence relationships:** Exact naming algorithm contribution order; `aria-labelledby` and `aria-label` are not interchangeable; `aria-describedby` is description only.
5. **Deterministic checks:** Compare actual computed name with authored sources and identify differences. A difference is not automatically harmful; precedence must be computed before semantic review.
6. **ML assessment:** Decide whether the difference is materially misleading or confusing in context, not merely non-identical.
7. **Evaluation criteria:** Potential issue when a supplied source contradicts computed name or purpose in a meaningful way (for example, visible “Pay now” but computed name “Delete account”). No issue for harmless abbreviation/extra detail with same purpose. Naming algorithm defects remain a separate deterministic issue.
8. **Abstention:** No computed name/visible rendering, provenance missing, purpose unknown, descriptions conflated with names, or dynamic state.
9. **Expected output:** Common output citing computed name and each conflicting source with provenance; distinguish deterministic mismatch from semantic concern.
10. **Positive example:** `<button aria-label="Delete account">Pay now</button>` when browser reports that computed name and the visible action is verified as payment.
11. **Negative example:** Visible “Search” and computed name “Search site” for a verified site search action.
12. **Borderline example:** `aria-label="Open account"` with visible “Account”; action is not available; abstain.
13. **Evaluation method:** Browser-rendered fixtures covering precedence, multiple IDREFs, hidden refs, title, visible text, and description. Reviewers label meaningful conflict vs benign variation.

### 4.6 Headings

#### Rule 16 — Heading clarity (`HEADING-CLARITY`)

1. **Objective:** Assess whether a heading communicates a recognizable topic for its associated section.
2. **Scope:** Native h1–h6 and supported ARIA heading targets.
3. **Required evidence:** Heading text/level, page title, parent and child section content, neighboring headings, lists/tables. `[P3]` has heading target text/level; `[PROJECT-HTML]` adds bounded static text and DOM relationships, but does not calculate complete heading-governed section boundaries.
4. **Evidence relationships:** Heading to the section it governs, page title, hierarchy, and nested headings.
5. **Deterministic checks:** Identify heading tag/ARIA heading and level; independently report structural level errors. Do not turn heading hierarchy rules into semantic ML judgments.
6. **ML assessment:** Judge whether wording identifies the topic based on section content supplied.
7. **Evaluation criteria:** Potential issue when heading is vague/confusing and associated content does not resolve it. No issue when short wording clearly identifies section in context.
8. **Abstention:** No reliable section boundary/content, truncation, heading is generated dynamically but state absent, or title context unavailable when needed.
9. **Expected output:** Common output with heading ID/level, section evidence IDs and separate deterministic hierarchy results if available.
10. **Positive example:** Heading “Other” preceding several unrelated procedures with no further distinctions.
11. **Negative example:** Heading “Payment methods” introducing a list of supported payment methods.
12. **Borderline example:** Heading “Overview” with no section content in extracted evidence; abstain.
13. **Evaluation method:** Fixtures with short headings under distinct contents and nested sections; human reviewers label topic clarity and section boundary. Include structural-level tests separately.

#### Rule 17 — Heading relevance to surrounding content (`HEADING-CONTENT-RELEVANCE`)

1. **Objective:** Detect headings that materially misrepresent or appear unrelated to the content they govern.
2. **Scope:** Heading plus a reliably segmented section in one page.
3. **Required evidence:** Heading text, complete section boundary, paragraphs/lists/tables, child headings, hierarchy and page completeness. Heading text/level `[P3]`; `[PROJECT-HTML]` adds bounded structures/text but not authoritative complete section boundaries; rendered/dynamic content `[BROWSER]`.
4. **Evidence relationships:** Heading-to-descendant content until the next same/higher-level section boundary, with nested sections handled explicitly.
5. **Deterministic checks:** Establish section boundaries using documented segmentation rules; if boundary cannot be established, abstain. A heading level alone cannot prove semantic relevance.
6. **ML assessment:** Compare heading topic with section content and flag material mismatch, not merely incomplete topical coverage.
7. **Evaluation criteria:** Potential issue when substantial associated content concerns another topic or heading promises content absent from section. No issue when content fits heading, including reasonable subtopics. Mixed sections may be unclear rather than issue without scope policy.
8. **Abstention:** Ambiguous boundary, partial page, large omitted content, dynamic content unavailable, or nested content attribution unclear.
9. **Expected output:** Common output citing heading and representative supporting/contradicting section excerpts plus boundary method.
10. **Positive example:** “Refund policy” heading followed only by unrelated account-security instructions.
11. **Negative example:** “Refund policy” followed by eligibility and refund-process details.
12. **Borderline example:** Section has refund and exchange content under “Returns”; policy on acceptable umbrella headings is unresolved; abstain/reviewer.
13. **Evaluation method:** Human-labeled section boundaries and relevance judgments; include nested, mixed, truncated, and dynamic sections. Score boundary accuracy separately from semantic relevance.

### 4.7 General content

#### Rule 18 — Ambiguous instructions (`CONTENT-INSTRUCTION-AMBIGUITY`)

1. **Objective:** Identify instructions that do not make the required action, expected input, or next step understandable.
2. **Scope:** Instructions associated with controls, tasks, and workflow steps.
3. **Required evidence:** Exact instruction, referents, associated control/task, headings, explanatory text, workflow/state and locale. `[PROJECT-HTML]` can capture bounded static text and DOM relationships; it does not infer a text-to-control association or provide workflow/state. Rendered/workflow details may require `[BROWSER]`/`[REACT]`.
4. **Evidence relationships:** Instruction to explicit task/control and referents of pronouns/deictic terms (“this”, “it”, “correct one”).
5. **Deterministic checks:** Locate candidate instruction text in captured static text records; a relationship cannot be inferred merely from proximity, and runtime instructions remain unavailable.
6. **ML assessment:** Judge whether the instruction identifies what to do and what value/choice is expected using captured referents.
7. **Evaluation criteria:** Potential issue where required action or referent remains materially unclear; no issue where concise instructions have a uniquely clear referent/action.
8. **Abstention:** Instruction/task text absent, referent outside captured content, unknown workflow state, or truncated surrounding guidance.
9. **Expected output:** Common output with exact instruction and referent/control IDs; do not invent action steps.
10. **Positive example:** “Select the correct one” when multiple options exist and no criterion is provided.
11. **Negative example:** “Enter the six-digit code sent to your email” next to a one-time-code field.
12. **Borderline example:** “Enter it below” with only a partial form excerpt; abstain.
13. **Evaluation method:** Annotate instruction spans, intended task/action, and required referents; create clear and intentionally underspecified pairs plus truncation cases.

#### Rule 19 — Unclear error messages (`CONTENT-ERROR-CLARITY`)

1. **Objective:** Evaluate whether an error explains the evidenced problem and, where possible, gives useful corrective guidance and is associated with the affected control.
2. **Scope:** Validation errors, form-level errors, and task errors.
3. **Required evidence:** Error text, affected field/task, browser validation state, expected input/constraint, instructions, submission context, and programmatic association. `[PROJECT-HTML]` can capture static error-like text and explicit ARIA references, but does not establish an active validation error or its cause. Rendered `aria-invalid`/live-region/focus state `[BROWSER]`; expected constraint may need application/source evidence.
4. **Evidence relationships:** Error-to-control IDREF, form submission state, constraint/validator source, and instruction.
5. **Deterministic checks:** If captured, validate relationship resolution and ARIA invalid state. Technical association does not establish semantic clarity. Never infer cause solely from an error string.
6. **ML assessment:** Judge whether message identifies the known problem and offers appropriate correction grounded in the supplied constraint; separately judge whether it's programmatically associated.
7. **Evaluation criteria:** Potential issue when a captured, current error corresponds to a known validation failure and its message is materially unclear, omits necessary corrective guidance, or contradicts the known constraint. No issue when the message accurately explains the known failure and gives appropriate correction. Report programmatic association separately. Missing error/cause evidence due to unsupported extraction or incomplete capture is not itself a potential clarity issue.
8. **Abstention:** Failure cause/constraint or current error state is not captured, omitted, incomplete, or unknown; error-to-control relationship is unresolved when needed; error state may be stale; expected value/constraint evidence is absent; or content is truncated. If a complete capture confirms no error is present, this rule is not applicable rather than a potential issue.
9. **Expected output:** Common output with error target, affected-control link, validation evidence and separate semantic/association subresults.
10. **Positive example:** A submitted form contains `alice@` in an email field; the captured validator result specifically confirms “email address is missing a domain,” but the associated error says only “Invalid.” The known failure makes the message's lack of specific guidance assessable.
11. **Negative example:** A submitted form confirms the required postal-code field is empty, and its associated message says “Enter a postal code.”
12. **Borderline example:** The message “We couldn't process this request” is captured, but the backend failure cause and applicable correction are not; abstain on cause-specific clarity.
13. **Evaluation method:** Controlled form submissions with known validator outcomes and associated/unassociated messages; reviewers label clarity, correction usefulness and association separately.

#### Rule 20 — Inconsistent terminology (`CONTENT-TERM-CONSISTENCY`)

1. **Objective:** Detect terminology variation for the same verified concept/action across an application that could confuse users.
2. **Scope:** Project-level content across pages/routes, controls, links, labels, headings, instructions and errors.
3. **Required evidence:** Text corpus, stable project/page/component/route identity, concept/action equivalence, locale, state and project coverage. Not provided by current V2 except limited individual target/evidence text; requires `[EXT]`/`[PROJECT]`, with `[REACT]` or `[BROWSER]` for component/state identity.
4. **Evidence relationships:** Each term mapped to the same verified concept/action; retain context to distinguish synonyms and homonyms.
5. **Deterministic checks:** Normalize exact strings, surface variants and counts after identity/equivalence mapping. String differences are candidates, not errors.
6. **ML assessment:** Review candidate variants for unexplained terminology changes likely to confuse users, only after equivalence is supported.
7. **Evaluation criteria:** Potential issue where same concept is referred to with materially inconsistent terms without explanation. No issue for legitimate synonyms, locale differences, or different concepts. Must not report project consistency from one page.
8. **Abstention:** Project corpus incomplete, equivalence unknown, terms in different contexts/locales, or component/state identity missing.
9. **Expected output:** Group-level common output with all source locations, exact terms, evidence for equivalence, and project coverage denominator.
10. **Positive example:** Verified “saved items” collection is called “Bookmarks” on another page without explaining the relationship.
11. **Negative example:** “Remove from cart” and “Remove from wishlist” describe distinct collections/actions.
12. **Borderline example:** One route uses “Orders” and another uses “Purchases”; no product glossary or action mapping exists; abstain.
13. **Evaluation method:** Multi-page corpus with human-curated concept equivalence and acceptable synonym sets; split by project to prevent page leakage and report grouping/evaluation errors separately.

## 5. Evidence availability matrix

| Evidence needed | Current V2 status | Required work/limitations |
|---|---|---|
| Static HTML target kinds, authored IDs, bounded target text, selected attributes/ARIA states | **[P3] Available, bounded** | Completeness flags apply; not every HTML node is a target. |
| `alt`, image `src`, raw `href`, coarse href kind, button/form-control fields including placeholder/autocomplete | **[P3] Available, bounded** | Image source is an authored URL string, not image pixels; V2 raw href is not itself a resolved destination. |
| Native HTML label association and `aria-labelledby`/`aria-describedby`/`aria-errormessage` reference states | **[P3] Available** | Resolved, unresolved, ambiguous, unknown, and omitted/incomplete evidence remain distinct. |
| `native-label` and `aria-reference` evidence kinds | **[P3] Produced** | ARIA reference kind preserves whether a relationship supplies naming, description, or error-message context. |
| HTML parser diagnostics, including duplicate-attribute errors | **[P3]/[PROJECT-HTML] Available** | Diagnostics retain source offsets; affected authored attributes are unavailable and extraction is marked incomplete rather than silently trusting normalized values. |
| `structural-context` evidence records | **Not produced** | Type is declared, but no active extractor producer was found. Requires implementation before use. |
| Parent-child relationships among included records | **[P3] Available, limited** | Nearest included parent only; not a prose/context extraction mechanism. |
| Document title/language, heading text/level, completeness/truncation | **[P3] Available, bounded** | Does not provide a complete section tree/content corpus. |
| Static surrounding text, headings, labels, form/group/section/list/table/caption context and structural associations | **[PROJECT-HTML] Available, bounded** | Only text/structures in explicitly supplied HTML; relationships reflect DOM structure and adjacency, not inferred semantic relevance. Per-document caps can make evidence partial. |
| Runtime instructions/errors, validation results, browser-visible states | **Not available** | Requires browser/runtime capture and, for cause-specific errors, validator or application evidence. Static text alone does not establish an active error. |
| Computed accessible name/description, visible name, accessible role | **Not available** | Requires browser accessibility-tree capture or separately validated computation; V2 observations are authored inputs, not computed results. |
| Rendered visible labels, visual similarity/layout, focus/filled/error states, dynamic DOM | **Not available** | Requires browser-rendered snapshots and state-driving/evidence provenance. |
| Relative href destination when the target HTML file is supplied | **[PROJECT-HTML] Available, bounded** | Uses `<base href>` and retains query/fragment identity; resolves only against supplied file paths, does not verify fragment existence, and performs no URL crawling/fetching or route mapping. |
| Actual button action/state transition/handler | **Not available** | Requires React/source analysis, browser interaction instrumentation, or trusted action metadata. Text/type alone cannot establish behavior. |
| React component identity and source mapping | **Not available** | Requires source/build analysis and mapping rendered targets to component/source locations. |
| Supplied document IDs/file paths and source locations | **[PROJECT-HTML] Available** | Caller-provided identities only; not React component IDs, routes, stable cross-revision IDs, or a completeness claim for the whole project. |
| Cross-page exact authored link/target/context text and same-supplied-destination comparisons | **[PROJECT-HTML] Available** | Comparison groups retain document/record identity and exact destination tuples; literal matches do not prove same purpose, action, or confusion. |
| Cross-page action/concept equivalence and terminology consistency | **Not available** | Requires project-wide coverage plus authoritative action/concept equivalence data; exact text/destination groups are insufficient. |
| Image pixels and image-to-alt grounding | **Not available** | Requires image input, fetch/security/privacy controls, and a vision-capable assessment path; filename is not evidence. |

## 6. Deterministic versus ML responsibility matrix

| Concern | Deterministic responsibility | ML/reviewer responsibility |
|---|---|---|
| Target identification and literal attributes | Parse/extract supported facts, IDs, role/ARIA observations and source locators. | None; do not re-identify from prose. |
| Reference/label resolution | Resolve IDs and report resolved/unresolved/ambiguous/truncated status. | Interpret supplied text only; never repair or invent relationships. |
| Accessible names | Obtain through browser accessibility information or validated standards-based computation; preserve provenance. | Assess meaning/clarity of computed string only; never calculate name from raw attributes. |
| Presence/empty placeholder, alt, href, ARIA state | Deterministic candidate flags and state. | Contextual interpretation only when extra evidence supports it. |
| Section/group/page boundaries | Establish using explicit extraction/browser/project rules and report completeness. | Semantic comparison only after boundaries are trusted; abstain otherwise. |
| Image visual accuracy | Image acquisition and metadata/safety handling. | Image-grounded semantic comparison only if actual image is provided; otherwise abstain on visual accuracy. |
| Action/destination/equivalence | Source/browser/project evidence and stable mapping. | Compare wording to supplied behavior/destination/equivalence; never infer hidden effects. |
| IBM Equal Access findings | IBM remains source of IBM issues and severity summary. | ML output is an independent advisory stream; cannot modify/suppress/relabel IBM results. |

## 7. Cross-page and full-project analysis requirements

1. Define project identity and explicit analysis unit: single static document, collection of pages, React app build/routes, browser session/state, or crawled site. Do not mix scopes silently.
2. Add stable target identity composition from project + file/route + source locator/component mapping. Current `t-N` IDs are snapshot-local and cannot correlate page revisions.
3. Retain one page-level V2 snapshot and adapter result, then aggregate derived evidence with provenance and project coverage. Do not parse HTML twice or flatten all text without relationships.
4. Define route discovery, base URL, authentication, crawl depth, external-link policy, redirects, privacy, robots/access controls, and dynamic-state coverage before URL analysis.
5. Establish relation schemas for section membership, table/list/card membership, instructions/errors to controls, captions to figures, and component/action equivalence. These are extensions, not existing `structural-context` evidence.
6. Record browser/runtime/version, viewport, locale, state-driving actions, rendered accessibility data, and screenshot/reference when visual judgments are used.
7. Keep page-level candidate generation separate from cross-page grouping and record missing pages/routes as coverage limitations. Project-level no-issue conclusions require declared coverage.
8. Maintain separation from IBM results even when both assessments refer to the same DOM target.

## 8. Test dataset and human annotation methodology

Create a versioned test corpus for every rule before implementation claims accuracy:

- Include clearly problematic, acceptable, and borderline cases requiring `insufficient_context`; vary markup, content, roles, page structures, locales if supported, repeated components, and partial/truncated evidence.
- Include all rule-specific contrasts listed above. For rules 6, 9, 14 and 20 include multi-page/project fixtures; for rules 1–3 include actual images if visual judgments are evaluated; for rules 4, 12, 13 and 15 include browser-rendered accessibility data; for rules 6/10/19 include known action/validation evidence.
- Store expected target identity, expected status, rule-specific rationale, evidence that a system is allowed to use, required relationships, and an explicit abstention reason where relevant.
- At least two trained accessibility reviewers independently label each case before adjudication. Reviewers should receive the same evidence scope as the system and must not infer inaccessible project/source facts. Adjudicate disagreements and report inter-reviewer agreement.
- Keep project-level cases split by project between tuning and held-out evaluation; do not leak pages/components from one project into both sets. Freeze the held-out set, rules, prompts, model/runtime revision (if later chosen), and thresholds before final scoring.
- Evaluate each rule independently and jointly. Include deterministic-only baselines, ML-assisted outputs, and human adjudication. Do not train a model as part of this test plan; evaluation and prompt/rule calibration are not model training.

### Rule-specific case coverage

The per-rule evaluation instructions in Section 4 define the targeted controls. At minimum the dataset must include:

- Images: empty/decorative, informative, functional, complex, vague/overloaded, useful medium descriptors, repeated descriptions, actual pixels and no-pixel abstentions.
- Buttons: short names with/without context, repeated names with distinct item contexts, known and unknown handlers, misleading vs equivalent wording.
- Links: generic names with/without programmatic association, known/unknown destinations, visually similar rendered choices, repeated text across pages.
- Forms: correctly/mismatched/ambiguous labels, duplicate names, placeholder-only with rendered states, error association and known/unknown validator causes.
- ARIA: browser-computed names, precedence conflicts, name/description separation, hidden/unresolved references, supported and unsupported widget roles.
- Headings/content: short but useful/vague headings, nested boundaries, content mismatch, mixed sections, dynamic/partial section abstentions.
- General language: explicit and vague instructions, clear/actionable and unhelpful errors, unknown error causes, verified equivalent and distinct terminology.

## 9. Metrics and proposed acceptance criteria

No measured scores exist. The following are **proposed targets requiring approval** before held-out evaluation, not achieved results or guarantees:

| Metric | Definition/use | Proposed gate (not yet approved or measured) |
|---|---|---|
| Precision | Correct `potential_issue` / all predicted `potential_issue`, per rule | At least 0.90 per rule before user-visible issue suggestions. |
| Recall | Correctly found reviewer-labeled issues / all reviewer-labeled issues | At least 0.80 per rule; lower recall may be acceptable only with explicit scope review. |
| F1 | Harmonic mean of precision and recall | Report per rule and macro-average; no aggregate may hide a failing rule. |
| False-positive rate | False issue predictions / reviewer-labeled acceptable cases | At most 0.05 per rule, subject to approval. |
| False-negative rate | Missed issues / reviewer-labeled issue cases | At most 0.20 per rule, subject to approval. |
| Abstention rate | `insufficient_context` / all evaluated targets | Report per rule and evidence-availability stratum; no universal low-abstention target. |
| Abstention quality | Fraction of abstentions judged genuinely insufficient; coverage-risk curve | At least 0.90 of abstentions should be justified as insufficient; report overconfident errors separately. |
| Evidence correctness | Cited evidence exists, belongs to target/unit, and supports the claim | At least 0.98 citation validity; zero fabricated IDs/text in acceptance suite. |
| Invalid output rate | Malformed, out-of-schema, unknown-ID, or unsupported-status output | Zero accepted invalid outputs after validation; raw invalid rate reported. |
| Reviewer agreement | Agreement before adjudication | Report Cohen's kappa or a suitable multi-rater statistic and raw agreement; define minimum corpus quality with reviewers. |
| Performance by project size | Accuracy/resource results stratified by targets, pages, states, and completeness | Establish deployment budgets before test; measure p50/p95 and peak RSS, do not invent thresholds. |

Thresholds must be approved by product/accessibility owners, supported by adequate sample size and confidence intervals, and checked per rule. Failure of evidence correctness or IBM-separation tests blocks release regardless of aggregate F1.

## 10. Known limitations and abstention cases

- Static HTML V2 does not represent the live React DOM, browser-computed accessibility tree, CSS visibility, focus order/state, or dynamic error state.
- Static text and common list/table/section/form structures are captured by `[PROJECT-HTML]` with bounded values and structural/adjacency relations. These records do not establish browser visibility, all heading-governed section boundaries, or semantic relevance; parent-child/adjacent relations are not semantic judgments.
- Instruction/error wording may be captured as static text, but active error state, validator cause, corrective action, and control association are not established unless their explicit static relationships are present; runtime validation remains unavailable.
- `structural-context` is declared as a type but not emitted by the active extractor.
- No image bytes/pixels are extracted; alt relevance to the depicted image is not verifiable from alt text or filenames.
- No computed accessible name is in V2. Button/ARIA/name rules need a browser or validated name-computation source before naming-specific determinations.
- `hrefKind` is a coarse classification, not a resolved destination or destination semantics.
- No handler/action/state transition, project route, React component identity, cross-page corpus, or equivalence mapping exists in current request path.
- Extraction/adapter caps, omitted references, ambiguous IDs, parser failure, absent targets, unsupported roles, and incomplete project coverage require explicit abstention or narrower claim.
- Semantic relevance is purpose-dependent and reviewer disagreement is expected; never present model prose or confidence as objective evidence.
- IBM issue levels/counts remain independent and unchanged by all contextual rule outcomes.

## 11. Implementation dependencies and recommended order

This is a dependency/order proposal, not implementation authorization:

1. **Agree on rule definitions and statuses:** approve proposed IDs, output contract, issue/no-issue/abstention criteria, locales and scope boundaries.
2. **Evidence gap inventory:** design explicit, bounded extensions for prose/sections/instructions/errors and stable project identities. Preserve existing V2 schema/version behavior; choose a versioned extension rather than silently changing V2 semantics.
3. **Deterministic foundation:** stable target identity, source mapping, relationship validation, completeness propagation, and where required browser-computed names/roles. Keep accessible-name computation out of ML.
4. **Project and browser capture:** route/page aggregation, React component/source mapping, state/render capture, action/destination evidence, image input policy, only as demanded by approved rules.
5. **Deterministic rule portions:** implement attribute/reference/presence candidates and structural checks independently from semantic assessments.
6. **Human-reviewed datasets:** collect, adjudicate and freeze rule-specific data before any model selection or claims.
7. **Model/runtime evaluation:** select/benchmark only after evidence scope and held-out tests are fixed. No model is selected by this specification and no model training is proposed.
8. **ML advisory integration:** add an isolated, validated assessment output channel; preserve IBM response semantics and test invariance.
9. **Staged release:** enable only rules meeting approved per-rule accuracy, evidence, abstention and resource gates; disclose unsupported targets and project coverage.

### Decisions still required

- Whether the system is intended to provide usability advice, WCAG-related risk hints, or both; do not imply formal conformance from semantic advice.
- Which browser engines, assistive-technology mappings, locales, React build/source maps, routes, and dynamic states are in scope.
- Rules 7–9 may need URL fetching and/or rendered context; define security and privacy constraints first.
- Rule 1 needs actual image handling and an image-capable assessment path if visual accuracy is ever claimed.
- Rules 6, 14 and 20 need authoritative action/concept equivalence data; decide whether that comes from source analysis, curated metadata, or human annotation.
- Acceptance thresholds in Section 9 are proposals only and require approval.
- Runtime/model choice is deliberately outside this document; no model has been selected.
