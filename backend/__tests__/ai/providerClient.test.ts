import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODELS,
  AI_PROVIDERS,
  type AiModelId,
} from '../../src/ai/config.js';
import { generateProviderCompletion } from '../../src/ai/providerClient.js';

const responseText =
  '{"assessment":"no_issue_detected","explanation":"The supplied name is clear."}';
const modelIds = Object.keys(AI_MODELS) as AiModelId[];
const previousKeys = new Map(
  [...new Set(Object.values(AI_PROVIDERS).map(({ keyEnv }) => keyEnv))].map(
    (key) => [key, process.env[key]],
  ),
);
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of previousKeys) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('free model provider clients', () => {
  it.each(modelIds)(
    'does not make a network request without the provider key for %s',
    async (modelId) => {
      const provider = AI_PROVIDERS[AI_MODELS[modelId].provider];
      delete process.env[provider.keyEnv];
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        generateProviderCompletion(modelId, 'test prompt'),
      ).rejects.toThrow(`Missing ${provider.keyEnv}`);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(modelIds)(
    'uses the zero-paid-usage API request for %s',
    async (modelId) => {
      const model = AI_MODELS[modelId];
      const provider = AI_PROVIDERS[model.provider];
      process.env[provider.keyEnv] = 'test-key-not-sent-to-network';
      const data =
        provider.api === 'gemini'
          ? {
              candidates: [
                { content: { parts: [{ text: responseText }] } },
              ],
              usageMetadata: {
                promptTokenCount: 17,
                candidatesTokenCount: 11,
              },
            }
          : {
              choices: [{ message: { content: responseText } }],
              usage: { prompt_tokens: 17, completion_tokens: 11 },
            };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await generateProviderCompletion(
        modelId,
        'Use only the supplied evidence.',
      );

      expect(result).toMatchObject({
        text: responseText,
        inputTokens: 17,
        outputTokens: 11,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        provider.api === 'gemini'
          ? `${provider.endpoint}/models/${modelId}:generateContent`
          : `${provider.endpoint}/chat/completions`,
      );
      const requestBody = JSON.parse(String(options.body)) as Record<
        string,
        unknown
      >;
      if (provider.api === 'gemini') {
        expect(url).toContain(modelId);
      } else {
        expect(requestBody.model).toBe(modelId);
      }
      expect(JSON.stringify(requestBody)).not.toContain(
        'test-key-not-sent-to-network',
      );
      expect(JSON.stringify(options.headers)).toContain(
        'test-key-not-sent-to-network',
      );
      if (provider.api === 'openai-compatible') {
        expect(requestBody.provider).toEqual({ allow_fallbacks: false });
        expect(requestBody).not.toHaveProperty('models');
      }
    },
  );
});
