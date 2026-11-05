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

## Contextual ML analysis

The default `.env.example` configuration uses the selected online model
(`gemini-3.8-flash`) for eligible contextual assessments and allows up to 512
output tokens. Add its API key to `backend/.env` before starting the backend.
The development command enables online analysis by default if
`RAC_AI_ENABLED` is unset. Set it to `0` to disable contextual ML analysis;
the analyzer does not fall back to Qwen.

The repository retains Transformers.js `4.4.0-next.0` and the ONNX conversion
[`huggingworld/Qwen3.5-4B-ONNX`](https://huggingface.co/huggingworld/Qwen3.5-4B-ONNX)
at revision `8e3760349b4480f1f1a0f2d2010e46c5863262f1` for standalone
experimental tests only. The analysis API does not load or send requests to
Qwen.

From the `backend` directory, run:

```powershell
npm run dev
```

The development entry point uses the selected online provider unless
`RAC_AI_ENABLED=0` is set. It logs extraction summaries (up to 100 characters
of target/name text), IBM scan timings, and total analysis time to the local
terminal.
These logs may contain snippets from the HTML being analyzed; use
`$env:RAC_LOG_ANALYSIS = "0"` before startup to disable them. The backend HTTP
server starts normally; no local model is loaded.

For production (`npm start`), remote assessment is enabled with
`RAC_AI_ENABLED=1` and the selected provider key. When the request contains
eligible contextual candidates, every candidate is sent to the selected model;
the analysis response waits for all of those requests. There is no per-report
10-candidate cap or model-request deadline. Provider rate and daily usage
budgets still apply and are reported explicitly if exhausted.

Remote assessments use complete, captured V2 naming evidence, omit description
evidence from the naming prompt, and abstain when the evidence gate fails.
They remain separate from IBM findings and summary counts and are not WCAG
conformance findings.

The remaining Qwen smoke tests validate the legacy local runtime only; they
are not part of `/api/analyze` and do not evaluate accessibility accuracy.

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
