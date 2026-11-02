# Phase 4.1 — Pretrained ML Model Selection and Technical Preparation

**Status at the 2026-11-01 research revision:** No application source was changed, no packages or model files were installed/downloaded, and no model was trained.

### Phase 4.2 implementation update — 2026-11-02

The project selected its already-installed `huggingworld/Qwen3.5-4B-ONNX`
snapshot at revision `8e3760349b4480f1f1a0f2d2010e46c5863262f1` for the
experimental implementation path; this is distinct from the Qwen2.5 comparison
candidate discussed below. The exact local snapshot passed an offline
load/generation smoke test, and the authored-name assessment path returned
schema-valid output. This does not establish accessibility accuracy.

The API assessment path is enabled automatically by the development entry point
(`npm run dev`), which preloads the local model in the backend process. Other
runtime entry points remain opt-in with `RAC_ENABLE_QWEN_ASSESSMENTS=1`. Up to
10 eligible target/rule assessments are grouped into a single compact Qwen
generation with a 16-token cap and remain separate from IBM findings. The
API waits at most 40 seconds for Qwen, then returns IBM results and marks Qwen
assessments not assessed. Before disabling Qwen's thinking mode, a live
one-target probe completed in about 43 seconds (IBM: 2.7 seconds; Qwen wait: 40
seconds); the timed-out inference later completed in its worker. After the
change, the pinned-model JSON smoke test generated valid output in 56 seconds
including model load, and the end-to-end contextual-assessment smoke test
returned a schema-valid result within the 40-second inference budget after
preload (79 seconds total including model load). These are local measurements,
not latency guarantees. ONNX inference cannot be cancelled, so a timed-out
generation may finish in the background; concurrent scans skip Qwen until it
finishes.
Human-reviewed benchmark results and deployment resource budgets remain
outstanding, so this is not approval for production deployment. No other model
was examined as part of this follow-up.

## Executive conclusion

No candidate reviewed here has published accessibility-specific training or evaluation. None is established as capable of determining WCAG conformance or accessible-name quality. Phase 4.1 therefore selects **no production accessibility assessor**.

For a future, controlled feasibility benchmark, use **HuggingFaceTB/SmolLM2-360M-Instruct** as the first licensed prototype candidate, not as a proven winner. Its pinned Hub card declares Apache-2.0 and its pinned repository contains ONNX artifacts and Transformers.js metadata. However, the model card's JavaScript example uses the **135M** variant; the exact **360M + runtime** combination has not been tested here and must pass a smoke test before it is accepted. **Qwen2.5-0.5B-Instruct** remains a comparison candidate only: the upstream Qwen card says Apache-2.0, but the selected ONNX conversion repository does not declare its own license. Do not distribute or approve that conversion until licensing is resolved for the exact snapshot.

The only proposed assessment scope is conditional review of **authored naming text** against text explicitly captured in V2 native-label and ARIA naming evidence. Image-alt relevance and general link-purpose-in-context assessment are deferred. Even the retained scope is an experiment with frequent “insufficient context,” not an accessibility finding.

**Readiness verdict at this research revision:** NOT APPROVED for production use. The candidate then under consideration still needed exact-runtime smoke testing and a human-reviewed comparison benchmark; resource requirements were unknown until measured. Phase 4.2 must not train a model.

## 1. Current project architecture and API

- **Frontend:** React 19 + Vite. It uploads HTML as a string and sends it with a filename to the backend. See [`frontend/src/App.tsx`](../frontend/src/App.tsx) and [`frontend/package.json`](../frontend/package.json).
- **Backend:** Express 5, ESM, TypeScript, `parse5`, and IBM `accessibility-checker`; `POST /api/analyze` is the route. See [`backend/src/index.ts`](../backend/src/index.ts), [`backend/src/routes/analyze.ts`](../backend/src/routes/analyze.ts), and [`backend/package.json`](../backend/package.json).
- **TypeScript:** ES2022 target, NodeNext module and resolution, strict mode. The backend package does not declare `engines.node`. See [`backend/tsconfig.json`](../backend/tsconfig.json).
- **Tests:** Backend uses Vitest (`npm test`); frontend has build/lint scripts but no declared test script.
- **Existing API:** Request is `{ html, filename }`. The response contains `filename`, `analyzedAt`, IBM severity summary counts, normalized IBM `issues`, and a separate `contextualAssessments` property. Types are in [`backend/src/types/checker.ts`](../backend/src/types/checker.ts).
- **Active analyzer path:** [`analyzeHtml`](../backend/src/services/checker.ts) calls V2 extraction and adaptation once and passes the adapted result to the contextual assessment service. It does not duplicate extraction or parsing. Qwen inference remains off unless explicitly enabled.

## 2. Verified Phase 3 context schema

The active implementation is [`extractHtmlContextResultV2`](../backend/src/services/contextExtractionV2.ts) plus [`adaptContextSnapshotV2`](../backend/src/services/contextAdapterV2.ts), with types in [`backend/src/types/contextV2.ts`](../backend/src/types/contextV2.ts). V1 remains in the codebase but is not the path called by `analyzeHtml`.

### V2 snapshot

`ContextSnapshot` contains:

- `schemaVersion: 2`;
- `document.title` and `document.language`, each with present/absent/invalid/unavailable states;
- `targets`: discriminated targets of kind `image`, `link`, `button`, `form-control`, `heading`, `custom-widget`, or `other`;
- `evidence`: records with `id`, `kind`, optional tag/text/attributes/source locator, and completeness;
- `relationships`: target-to-associated-record relationships and parent-child relationships, with resolution status, provenance, and completeness;
- `completeness`: extraction truncations, policy omissions, and unresolved/ambiguous relationship counts.

Targets have an `id`, `tagName`, optional bounded text and source locator, a basis, completeness, common observed attributes (`authoredId`, role, captured ARIA attributes, title, hidden/inert, tab index), and kind-specific facts:

- Image: observed `alt`; no source URL or pixels.
- Link: observed `href` and, when available, `hrefKind`.
- Button: disabled state and optional input type/value.
- Form control: input type, name, optional placeholder, required/disabled, and optional checked/selected.
- ARIA attributes use typed observations distinguishing present, absent, ambiguous, unavailable, and invalid.

### Evidence actually produced

The extractor's actual `includeEvidence` call sites create:

- **`native-label`** evidence for associated native `<label>` elements;
- **`aria-reference`** evidence for resolved `aria-labelledby` and `aria-describedby` references.

The schema also declares a **`structural-context`** evidence kind, but the active extractor has no producer for it. Do not describe that evidence as available.

The extractor separately creates **parent-child structural relationships** between included records (targets and/or evidence) based on the nearest included ancestor. These relationships identify included record structure; they do **not** capture arbitrary surrounding paragraphs, sentences, list items, or nearby page prose. `structural-context` relationship kinds and schema types do not change that fact.

For a target, direct textual content is bounded to 500 characters (form-control target text is empty). Associated evidence text is also bounded to 500 characters at extraction, then the adapter caps evidence text at 2,400 characters per target unit, associated evidence at 8 records, and serialized unit size at 8,000 characters. Snapshot records are capped at 500; attribute values at 250 characters. Completeness/truncation and unresolved/ambiguous relationship states are explicit and must be retained.

**Not present:** computed browser accessible names; general neighboring text; image pixels; JavaScript-rendered state; a full browser accessibility tree; or a complete CSS visibility computation. `aria-describedby` supplies description evidence and must not be conflated with naming evidence.

## 3. Revised ML assessment scope

No task below is established as supported by model evidence. The table defines only conditional candidates for a human-reviewed experiment using fields V2 actually captures.

| Candidate task | Phase 4.2 feasibility | Prerequisites and “insufficient context” cases |
|---|---|---|
| Button authored-name wording | **Conditional experiment.** Compare captured button text and directly authored naming attributes with captured naming evidence. This is not a judgment of the browser-computed accessible name. | Require at least one present, non-truncated authored name source, usable role/kind, and sufficient context for the rubric. Abstain for missing/empty name, unresolved/ambiguous `aria-labelledby`, truncated evidence, unsupported/dynamic behavior, or a judgment requiring visual/icon semantics. |
| Form-control label wording | **Conditional experiment.** Compare a captured associated native label and/or resolved `aria-labelledby` evidence with the target's captured type/name/placeholder. | Require a resolved, non-empty, non-truncated label/name association. Abstain when no label is captured, the relationship is unresolved/ambiguous/omitted, text is truncated, or the field's intended business meaning is not stated by captured evidence. Placeholder/name are not automatically equivalent to a label. |
| ARIA naming wording for captured targets | **Conditional experiment, narrow.** Review present `aria-label` text or text from a resolved `aria-labelledby` relationship against the captured target text/role and associated naming evidence. | Require a supported target/role and present usable naming text. Abstain for absent/invalid/truncated ARIA values, unresolved/ambiguous references, omitted evidence, unsupported role, or browser/dynamic behavior. Never use `aria-describedby` as the accessible name. |
| Image alt-text relevance to the depicted image | **Deferred / not assessable.** | V2 records `alt` but no image bytes or source URL, and it does not generally capture surrounding prose. A future image-aware approach would need explicit image acquisition, safety/privacy controls, and a separate evaluation. |
| General link purpose in context | **Deferred / generally not assessable.** | V2 records link text/href and structural relationships but not general associated sentence/paragraph prose. A link-specific direct text inspection is not the same as WCAG link-purpose-in-context assessment. Reconsider only after evidence capture scope is explicitly extended or a separate suitable source exists; do not duplicate or silently alter Phase 3 extraction in this phase. |

Even retained experiments must not claim a computed accessible-name assessment until name computation is implemented and validated against the applicable accessible-name algorithm. Machine-generated advice is not a WCAG or IBM finding.

## 4. Candidate comparison and licensing

Artifact sizes below are exact Hub metadata at the pinned snapshots shown. They describe individual files, not total package installation, cache occupancy, or runtime memory. Parameter count is from model metadata/cards where available. No accessibility benchmark is published for these candidates.

| Candidate, exact repository revision | Intended pretrained task / architecture | Availability, license, selected artifact | Runtime evidence and accessibility limits |
|---|---|---|---|
| **SmolLM2-360M-Instruct** — [`HuggingFaceTB/SmolLM2-360M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/tree/a10cc1512eabd3dde888204e902eca88bddb4951), revision `a10cc1512eabd3dde888204e902eca88bddb4951` | 360M decoder-only Llama-family transformer; general instruction-following text generation. Chat messages in, generated text out. Model card reports SFT/DPO and warns output can be inaccurate/inconsistent, primarily English. | Public, not gated; pinned card metadata declares **Apache-2.0**. Same repository contains ONNX files, including `onnx/model_int8.onnx` (**364,564,558 B**) and `onnx/model_q4f16.onnx` (**272,737,275 B**). | Repository is tagged `transformers.js` and includes ONNX. The card's JS example uses **SmolLM2-135M**, not this exact 360M variant. Exact 360M Transformers.js+Node CPU pipeline compatibility therefore remains a smoke-test gate. General text generation only; no accessibility evaluation. |
| **Qwen2.5-0.5B-Instruct** — [`onnx-community/Qwen2.5-0.5B-Instruct`](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/tree/22942cb7d7ba4cc81bb4673549ca4d4614469b5e), revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`; upstream [`Qwen/Qwen2.5-0.5B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) | 0.49B causal decoder-only Qwen2 transformer; pretrained and instruction tuned for general generation. Model card reports improved general instruction following and structured outputs/JSON. | Public, not gated. **Conversion license unresolved:** the pinned ONNX repo metadata has no license declaration. Upstream card declares Apache-2.0, but that is not proof of the conversion repository's licensing. Int8 ONNX: **512,096,557 B**; q4f16: **483,003,582 B**. Licensing is a blocker for distribution/use pending review. | ONNX repository explicitly documents a Transformers.js text-generation example. This is documented support, not runtime testing in this backend. No accessibility-specific evidence. Do not select as deployable model before resolving exact conversion terms. |
| **all-MiniLM-L6-v2 ONNX** — [`onnx-community/all-MiniLM-L6-v2-ONNX`](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX/tree/aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f), revision `aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f` | About 22.7M MiniLM/BERT encoder; sentence/paragraph embeddings (384 dimensions) for similarity, clustering, semantic search. Input >256 word pieces is truncated per base card. | Public; pinned conversion metadata declares **Apache-2.0**. q4f16 graph and external data total **29,935,197 B**. | Explicit Transformers.js feature-extraction example. Similarity is not name quality, clarity, compliance, or an explanation; it can only serve as a baseline signal. |
| **MS MARCO MiniLM-L6-v2 Cross-Encoder** — [`cross-encoder/ms-marco-MiniLM-L6-v2`](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2/tree/233902d25c440f23af6f7d6e94d2946bac0bee0a), revision `233902d25c440f23af6f7d6e94d2946bac0bee0a` | About 22.7M BERT sequence-pair cross-encoder trained for MS MARCO passage ranking. Query + passage in, ranking logit out. | Public; pinned model metadata declares **Apache-2.0**. Standard ONNX about **91,011,230 B**; qint8 CPU-specific variants **23,200,716 B** each (AVX/ARM variants differ). | ONNX Runtime can run its ONNX graph, but tokenizer/preprocessing and output interpretation need integration; no Transformers.js model-specific example confirmed in this audit. Search-ranking scores are not calibrated accessibility assessments. |

### Selection policy

- **First licensed benchmark candidate:** SmolLM2-360M-Instruct, subject to a direct load/inference smoke test at the exact pinned revision/runtime. It is not a validated winner.
- **Qwen:** comparison candidate only until the exact ONNX conversion's licensing is resolved. Do not infer its license from upstream.
- **Baselines:** evaluate all-MiniLM and/or the MS MARCO cross-encoder only for clearly defined text-relevance comparisons; neither is an accessibility assessor.
- Compare candidates using the **same frozen human-reviewed dataset, context snapshots, assessment rubric, prompt/template, output schema, decoding settings, and abstention policy**. No accuracy ranking is supportable before that evaluation.

## 5. Runtime and reproducibility proposal

These are **proposed pins for a later smoke test**, not tested deployment requirements:

- **Node.js:** `v24.20.0` (official Windows x64 artifact exists; SHA-256 manifest is published). This is an exact reproducibility baseline, not a claim that Transformers.js declares this as its minimum/supported version.
- **Transformers.js:** `@huggingface/transformers@4.3.2`. The npm package publishes a Node ESM entry point and lists `onnxruntime-node@1.30.0` plus `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` as dependencies. Verify the actual resolved dependency graph in the implementation lockfile. The package metadata does not declare an `engines.node` constraint.
- **First model candidate:** `HuggingFaceTB/SmolLM2-360M-Instruct` at immutable revision `a10cc1512eabd3dde888204e902eca88bddb4951`. This revision's model card declares Apache-2.0. Use only a selected ONNX variant and required tokenizer/config assets; do not clone/download the entire repository.
- **Comparison candidate:** Qwen ONNX revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`, blocked pending license review.

**Documented vs tested:** Node's official distribution provides v24.20.0. Transformers.js docs describe ONNX-backed pipelines, dtypes, and Node filesystem cache configuration; npm metadata documents Node exports and dependency versions. The model repository declares ONNX and Transformers.js metadata. ONNX Runtime separately documents the Node CPU execution provider for Windows x64. These are documentation/metadata evidence only. No package was installed and the exact Node 24.20.0 + Transformers.js 4.3.2 + SmolLM2-360M pinned-revision combination has **not** been executed or tested. In particular, the model card's JS sample is for 135M.

**Layer distinction:** Transformers.js is the higher-level JavaScript model/pipeline, tokenizer, and model-loading API. It uses ONNX Runtime to execute ONNX graphs. Direct `onnxruntime-node` use would be a separate lower-level design: the application would have to provide tokenizer/chat preprocessing, tensor inputs, generation loop/caching as required, and output decoding. For a generative model in a Node + TypeScript backend, prefer testing Transformers.js first; use direct ONNX Runtime only if concrete compatibility or performance findings justify implementing that extra machinery.

**Python:** not required for inference using the published ONNX artifacts and Transformers.js. No model training or conversion is proposed.

## 6. Artifact, download, cache, and runtime resource accounting

Keep these quantities distinct:

- **Artifact size:** the selected ONNX weight file itself. For the SmolLM2 int8 candidate: **364,564,558 B**.
- **Listed support-file payload:** at pinned Smol revision, `config.json`, `generation_config.json`, `merges.txt`, `special_tokens_map.json`, `tokenizer.json`, `tokenizer_config.json`, and `vocab.json` sum to **3,377,006 B**. Confirm which files the pinned library actually requests with its load trace; do not assume every repository file is required.
- **Known selected payload subtotal:** those listed files plus the int8 ONNX artifact total **367,941,564 B** (about 368 MB decimal). This is not a measured total network download or installed footprint: library-required files, metadata, runtime packages, cache layout, filesystem allocation, and duplicate cache copies may change the total.
- **Full repository:** do not clone it. The model repository includes full-precision weights, multiple quantizations, and training outputs unrelated to this selection; downloading every file is substantially larger than the selected artifact set.
- **Cache/disk:** configure a persistent cache using Transformers.js `env.cacheDir` or provision a pinned local model directory. Measure actual cache bytes after a clean load. Include npm packages/native runtime binaries separately in deployment disk accounting. Public models do not require a Hugging Face token, but first-time remote loading needs network access unless artifacts are pre-provisioned.
- **Peak memory and latency:** **unknown** for all candidates in this application. No RAM range is asserted. Measure process RSS, startup/load time, inference latency, and concurrency under a fixed test protocol before setting deployment requirements.

No model-specific environment variable is required by the cited library documentation. If later needed, define a project-owned cache path and pinned model revision setting; these do not exist in the current backend.

## 7. Phase 4.2 architecture guardrails

1. Reuse Phase 3 V2 extraction and adapter exactly once. Change the orchestration boundary so the already-computed adapted result can be passed internally to an ML service; do not add another HTML parser, duplicate extraction, invent context fields, or infer general nearby prose.
2. The current analyzer discards its adapted result. Retain/pass that in-memory result from the same analysis operation; don't re-run extraction to recover it.
3. Keep the model behind a separate, optional assessment service. Its input is only the existing `AdaptedContextInput` unit, including exact associated evidence, relationship statuses, and completeness flags. Abstain for missing/ambiguous/truncated/omitted evidence.
4. Do not ask the model to compute browser accessible names. Until a deterministic accessible-name implementation is available and validated, describe outputs only as review of **authored naming text** and captured evidence.
5. Validate any generated response against a runtime schema. Require target and evidence IDs to exist in the supplied unit; bound generation; reject malformed output; don't treat model-reported confidence as calibrated.
6. Put ML output in a separate optional API property or endpoint. Never append it to IBM `issues`, change IBM levels, or include it in IBM severity counts. Model load/inference failure must not change IBM results; expose ML's unavailable/not-assessed status explicitly.

## 8. Human-reviewed evaluation and resource benchmark plan

Do not install or run this plan in Phase 4.1. In Phase 4.2, prepare and freeze a human-reviewed dataset **before** comparing candidates:

1. Build HTML fixtures whose target instances have verified V2 context snapshots. Include present/missing/empty authored names, native labels, `aria-label`, resolved/unresolved/ambiguous `aria-labelledby`, repeated labels, role variation, truncation, omitted evidence, and conflicting target/evidence wording. Include clear concerns, acceptable alternatives, and cases that must abstain. Exclude image-alt relevance and generic link-purpose judgments from this phase.
2. Have at least two accessibility reviewers independently annotate the exact target-level question, evidence actually available in the V2 unit, concern/no-concern/insufficient-context label, and rationale; adjudicate disagreements. Keep the final held-out set inaccessible during rubric/prompt refinement. This is evaluation only, not model training.
3. Run each candidate and any deterministic baseline on the **same** cases, same serialized V2 input, same task rubric, same output schema, same generation settings/token limit, and same abstention rule. Record immutable model revision, package lock, prompt/rubric hash, and test fixture revision.
4. Report per-task confusion matrices, precision/recall/F1 for concerns, false-positive rate, abstention rate/coverage, invalid-output rate, and reviewer agreement. Report no accessibility accuracy until measured; decide acceptance thresholds before seeing held-out results.
5. On a named target machine/OS/CPU, with Node `v24.20.0` and the locked package graph, separately measure cold download bytes/time, warm cache bytes, process RSS at idle/loaded/peak, model initialization time, per-unit p50/p95 latency, worst-page latency at the maximum extracted target count, throughput, and behavior under bounded concurrency. Repeat runs and report raw values and hardware.
6. Smoke-test exact model load, a fixed prompt, valid bounded output, graceful load failure, offline cached loading, and unchanged IBM response before considering broader work. Test the 360M exact snapshot; a documented 135M example is not enough.

## 9. Unresolved risks and blockers

- **Qwen conversion licensing:** unresolved on the exact ONNX repository/revision; blocks distribution/use until independently reviewed.
- **SmolLM2 exact compatibility:** documented ONNX/Transformers.js metadata exists, but model-specific JS sample uses 135M; exact 360M Node CPU pipeline smoke test is required.
- **No task evidence:** no candidate reports accessibility-specific benchmark results. Human-reviewed evaluation is a gate, not evidence already obtained.
- **Context insufficiency:** V2 does not capture arbitrary neighboring prose or image content. Image-alt relevance and general link-purpose-in-context remain deferred.
- **Accessible-name computation:** V2 carries authored attributes/evidence, not the computed browser-exposed name.
- **Resources:** model artifact byte counts are known; total download/cache/disk and runtime memory/latency are not yet measured.
- **Generation correctness and privacy:** fluent text may be wrong; HTML-derived content is untrusted input. Validate all outputs, bound tokens/concurrency, and use local inference/pre-provisioned model files to avoid sending source HTML to a remote inference service.
- **Revision/licensing drift:** pin model commits, npm versions, resolved transitive dependencies, and re-check declared terms before redistribution.

## 10. Decision and next gate

The original report supports only a **controlled feasibility benchmark** as a possible next phase. It does not support shipping ML assessments or calling any model the best accessibility model. Its SmolLM2-360M recommendation and Qwen2.5 licensing concern are historical candidate comparisons; the current Qwen3.5 project choice is described in the implementation update above and is not an accuracy recommendation.

Phase 4.2 production readiness remains **NOT APPROVED** until:

- the human-reviewed held-out benchmark meets predeclared acceptance criteria; and
- measured resource requirements meet an agreed deployment budget.

## Sources

- Project source: [`contextV2.ts`](../backend/src/types/contextV2.ts), [`contextExtractionV2.ts`](../backend/src/services/contextExtractionV2.ts), [`contextAdapterV2.ts`](../backend/src/services/contextAdapterV2.ts), [`checker.ts`](../backend/src/services/checker.ts), [`checker.ts` API types](../backend/src/types/checker.ts).
- [SmolLM2-360M-Instruct card at pinned revision](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/a10cc1512eabd3dde888204e902eca88bddb4951/README.md) and [pinned repository metadata/files](https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-360M-Instruct/revision/a10cc1512eabd3dde888204e902eca88bddb4951?blobs=true).
- [Qwen upstream model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) and [Qwen ONNX pinned repository metadata/files](https://huggingface.co/api/models/onnx-community/Qwen2.5-0.5B-Instruct/revision/22942cb7d7ba4cc81bb4673549ca4d4614469b5e?blobs=true).
- [all-MiniLM ONNX pinned repository metadata](https://huggingface.co/api/models/onnx-community/all-MiniLM-L6-v2-ONNX/tree/main?recursive=true) and [MS MARCO Cross-Encoder pinned metadata](https://huggingface.co/api/models/cross-encoder/ms-marco-MiniLM-L6-v2/revision/233902d25c440f23af6f7d6e94d2946bac0bee0a?blobs=true).
- [Transformers.js overview](https://huggingface.co/docs/transformers.js/en/index), [quantized dtypes](https://huggingface.co/docs/transformers.js/en/guides/dtypes), [cache/environment API](https://huggingface.co/docs/transformers.js/en/api/env), and [`@huggingface/transformers@4.3.2` npm metadata](https://registry.npmjs.org/@huggingface%2ftransformers/4.3.2).
- [ONNX Runtime Node.js binding and CPU platform table](https://onnxruntime.ai/docs/get-started/with-javascript/node.html).
- [Node.js v24.20.0 Windows x64 release checksum manifest](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt).
- [W3C Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/) and [WCAG 2.2 Understanding Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html).
