# React Accessibility Checker

React Accessibility Checker is a frontend project for exploring and checking
web accessibility. The initial scaffold uses Vite's React and TypeScript
template; no checker interface or backend has been added yet.

## Technology stack

- React
- TypeScript
- Vite
- npm

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- npm (included with Node.js)

## Local contextual model

The backend pins Transformers.js `4.4.0-next.0` and the ONNX conversion
[`huggingworld/Qwen3.5-4B-ONNX`](https://huggingface.co/huggingworld/Qwen3.5-4B-ONNX)
at revision `8e3760349b4480f1f1a0f2d2010e46c5863262f1`. The model repository
declares Apache-2.0; the upstream `Qwen/Qwen3.5-4B` repository is separately
licensed Apache-2.0. No training or fine-tuning is performed.

Install backend dependencies from the project root:

```powershell
npm --prefix backend install
```

The first model use downloads the pinned snapshot to the local Transformers.js
cache. Its ONNX weight artifacts total 3,781,408,366 bytes; tokenizer and
configuration files add about 19 MB. Allow roughly 3.8 GB of disk space for
the snapshot. By default, Windows uses
`%LOCALAPPDATA%\ReactAccessibilityChecker\models`; override the cache root with
`RAC_MODEL_CACHE_DIR`. After the snapshot is present, prevent network access
with:

```powershell
$env:RAC_MODEL_OFFLINE = "1"
```

The runtime uses CPU execution with Q4 decoder and embedding weights and an
FP16 vision encoder. Python and a separate model-server terminal are not
required: Qwen runs inside the backend Node.js process.

From the `backend` directory, run:

```powershell
npm run dev
```

The development entry point enables the experimental Qwen assessment path and
starts loading the pinned model in the background. It also logs compact
extraction summaries (up to 100 characters of target/name text), IBM scan
timings, Qwen's short result, and total analysis time to the local terminal.
These logs may contain snippets from the HTML being analyzed; use
`$env:RAC_LOG_ANALYSIS = "0"` before startup to disable them. The backend HTTP
server starts while Qwen loads. Watch the terminal for `Local Qwen model is
ready for contextual assessments.` If loading fails, the terminal reports the
error and IBM accessibility analysis remains available; fix the cache/network
issue and restart the backend. A missing snapshot is downloaded automatically
unless `RAC_MODEL_OFFLINE=1` is set. The model is loaded once and reused for
subsequent eligible analysis requests.

For production (`npm start`), model assessment remains disabled unless
`RAC_ENABLE_QWEN_ASSESSMENTS=1` is set in the backend process environment. With
that setting, the model loads on the first eligible analysis request rather
than server startup. To preload it in another deployment, call the backend's
model initialization during that deployment's startup sequence.

The experimental feature only receives complete, captured V2 naming evidence,
omits description evidence from the naming prompt, and abstains when its
evidence gate fails. Qwen output is schema-validated and citations must refer
to supplied records. Up to 10 eligible targets are sent in one compact Qwen
request, which returns only one classification character per target and is
capped at 16 generated tokens. Remaining eligible targets are explicitly
marked not assessed. Before disabling Qwen's thinking mode, a live one-target
probe completed in about 43 seconds: IBM took 2.7 seconds and the Qwen wait
ended at its 40-second budget; inference continued in the worker afterward.
With thinking disabled, the pinned-model JSON smoke test generated valid output
in 56 seconds including model load, and the end-to-end contextual-assessment
smoke test returned a schema-valid result within the 40-second inference
budget after preload (79 seconds total including model load). These are local
measurements, not guarantees. The native inference cannot be cancelled and may
continue in the background; the terminal logs its eventual result, and new
requests skip Qwen while that run is still active. Keep IBM as the dependable
report and treat Qwen feedback as an optional follow-up. These heuristics are
not WCAG conformance findings and remain separate from IBM findings and summary
counts. Keep production assessments disabled until human-reviewed benchmark
and deployment-resource reviews are complete.

The local smoke test validates pinned model loading and bounded JSON text
generation only; it is not an accessibility-accuracy evaluation. A Qwen
assessment can add substantial CPU latency and memory use; the measurements
below are not guarantees for other hardware or workloads.

An offline CPU smoke test on Windows with Node.js `v24.11.0` generated valid
JSON in 110.2 seconds and reported a process maximum resident set of 2,996,532
KiB (about 2.86 GiB). This is one model-load-plus-generation observation, not a
latency or memory guarantee for other hardware, workloads, or repeated
inference.

To run the optional end-to-end authored-name assessment smoke test against the
installed snapshot, set `RUN_QWEN_ASSESSMENT_SMOKE=1` and
`RAC_MODEL_OFFLINE=1`, then run:

```powershell
npm --prefix backend test -- __tests__/services/qwenAssessment.smoke.test.ts
```

This confirms runtime/schema compatibility only; model output still requires
human-reviewed accuracy evaluation before the opt-in feature is considered
ready for deployment.

## Local development

For provider research, API-key setup, cost controls, and remote-model
configuration, see [AI provider setup](docs/AI_PROVIDER_SETUP.md).

Run these commands from the project root:

```sh
cd frontend
npm install
npm run dev
```

Vite prints the local development URL after the server starts. To type-check
and build the frontend, run:

```sh
npm run build
```

To run the frontend linter:

```sh
npm run lint
```
