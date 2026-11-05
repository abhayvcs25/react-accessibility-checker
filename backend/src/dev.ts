import './env.js';
import {
  AI_PROVIDERS,
  isProviderConfigured,
  selectedModel,
  selectedProvider,
} from './ai/config.js';

if (process.env.RAC_AI_ENABLED === undefined) {
  process.env.RAC_AI_ENABLED = '1';
}
if (process.env.RAC_LOG_ANALYSIS === undefined) {
  process.env.RAC_LOG_ANALYSIS = '1';
}

await import('./index.js');

if (process.env.RAC_AI_ENABLED === '1') {
  console.log(
    `Online contextual assessment is enabled with ${selectedModel.modelId}.`,
  );
  if (!isProviderConfigured(selectedProvider)) {
    console.error(
      `Missing ${AI_PROVIDERS[selectedProvider].keyEnv}. Set it in backend/.env or the repository-root .env, then restart the backend.`,
    );
  }
} else {
  console.log('Online contextual assessment is disabled; Qwen is not used.');
}
