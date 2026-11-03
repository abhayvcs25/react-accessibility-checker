import {
  AI_MODELS,
  AI_PROVIDERS,
  getProviderApiKey,
  selectedModelId,
} from './config.js';
import {
  generateProviderCompletion,
  ProviderRequestError,
  type ProviderCompletion,
} from './providerClient.js';
import { waitForProviderCapacity } from './rateLimiter.js';
import {
  recordApiAttemptEnd,
  reserveEstimatedUsage,
} from './usage.js';

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
const estimatedTokens = Math.ceil(prompt.length / 3) + 192;
const releaseReservation = reserveEstimatedUsage(selectedModelId, estimatedTokens);
let completion: ProviderCompletion;
try {
  const requestStartedAt = await waitForProviderCapacity(
    selectedModelId,
    estimatedTokens,
  );
  try {
    completion = await generateProviderCompletion(selectedModelId, prompt);
    recordApiAttemptEnd(
      selectedModelId,
      requestStartedAt,
      Date.now() - requestStartedAt,
      {
        inputTokens: completion.inputTokens || Math.ceil(prompt.length / 3),
        outputTokens:
          completion.outputTokens || Math.ceil(completion.text.length / 3),
      },
      false,
    );
  } catch (error) {
    const rateLimited =
      error instanceof ProviderRequestError && error.statusCode === 429;
    recordApiAttemptEnd(
      selectedModelId,
      requestStartedAt,
      Date.now() - requestStartedAt,
      { inputTokens: 0, outputTokens: 0 },
      rateLimited,
    );
    throw error;
  }
} finally {
  releaseReservation();
}

const parsed: unknown = JSON.parse(completion.text);
if (
  typeof parsed !== 'object' ||
  parsed === null ||
  !('assessment' in parsed) ||
  parsed.assessment !== 'no_issue_detected'
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
