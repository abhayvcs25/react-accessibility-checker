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

## AI assessment migration

The legacy local Qwen and selected Gemini/OpenRouter assessment pipelines have
been retired. The direct Groq/Cloudflare six-model replacement is not yet
implemented, so contextual model assessment is disabled and no model API calls
are made. IBM Equal Access analysis remains available and authoritative.

The migration design and provider verification are documented in
[the six-model architecture](docs/ai/SIX_MODEL_ARCHITECTURE.md) and
[provider verification](docs/ai/SIX_MODEL_PROVIDER_VERIFICATION.md). Candidate
models remain blocked pending account and capability verification; do not
configure legacy model keys or enable billing as a workaround.

From the `backend` directory, run `npm run dev`. Optional analysis logs can
include snippets from the submitted HTML; set
`$env:RAC_LOG_ANALYSIS = "0"` before startup to disable them.

## Local development

For current migration status, see [AI provider setup](docs/AI_PROVIDER_SETUP.md).

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
