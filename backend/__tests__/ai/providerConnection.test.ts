import { describe, expect, it } from 'vitest';
import {
  AI_MODELS,
  getProviderApiKey,
  selectedModelId,
} from '../../src/ai/config.js';
import { generateProviderCompletion } from '../../src/ai/providerClient.js';

const model = AI_MODELS[selectedModelId];
const shouldConnect =
  process.env.RUN_AI_CONNECTION_TESTS === '1' &&
  Boolean(getProviderApiKey(model.provider));

describe.skipIf(!shouldConnect)('configured AI provider connection', () => {
  it(`returns structured JSON from ${model.provider}/${model.modelId}`, async () => {
    const completion = await generateProviderCompletion(
      selectedModelId,
      [
        'Return exactly this JSON object and nothing else:',
        '{"assessment":"no_issue_detected","explanation":"connection test"}',
      ].join('\n'),
    );
    const parsed: unknown = JSON.parse(completion.text);

    expect(parsed).toMatchObject({
      assessment: 'no_issue_detected',
      explanation: 'connection test',
    });
  });
});
