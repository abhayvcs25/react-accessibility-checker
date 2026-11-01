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
FP16 vision encoder. Python is not required. The model loader is lazy, so a
model is loaded only when an inference request is made. Current pilot checks
return `insufficient_context` through a deterministic evidence gate and do not
invoke Qwen: the current static V2 adapter does not provide browser-computed
accessible names or independently evidenced action/business purpose. The local
smoke test validates model loading and JSON text generation only; it is not an
accessibility-accuracy evaluation. Contextual assessments are separate from
IBM findings and summary counts.

An offline CPU smoke test on Windows with Node.js `v24.11.0` generated valid
JSON in 47.5 seconds and reported a process maximum resident set of 2,990,072
KiB (about 2.85 GiB). This is a single model-load-plus-generation observation,
not a latency or memory guarantee for other hardware, workloads, or repeated
inference.

## Local development

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
