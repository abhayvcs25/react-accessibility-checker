import {
  AI_MODELS,
  AI_PROVIDERS,
  getProviderApiKey,
  selectedModelId,
} from './config.js';
import {
  generateProviderCompletion,
  type ProviderCompletion,
} from './providerClient.js';

const model = AI_MODELS[selectedModelId];
const provider = AI_PROVIDERS[model.provider];
if (!getProviderApiKey(model.provider)) {
  throw new Error(
    `Connection test skipped: configure ${provider.keyEnv} in backend/.env first. No API request was made.`,
  );
}

const startedAt = performance.now();
const prompt = [
  'Return exactly this JSON object and nothing else:',
  '{"assessment":"no_issue_detected","explanation":"connection test"}',
].join('\n');
const completion: ProviderCompletion = await generateProviderCompletion(
  selectedModelId,
  prompt,
);

const parsed: unknown = JSON.parse(completion.text);
if (
  typeof parsed !== 'object' ||
  parsed === null ||
  !('assessment' in parsed) ||
  parsed.assessment !== 'no_issue_detected' ||
  !('explanation' in parsed) ||
  typeof parsed.explanation !== 'string' ||
  !parsed.explanation.trim()
) {
  throw new Error('Connection test received invalid structured JSON.');
}

console.log(
  JSON.stringify(
    {
      provider: model.provider,
      modelId: selectedModelId,
      connected: true,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      note: 'This probe uses free-tier quota and may be subject to provider limits.',
    },
    null,
    2,
  ),
);
