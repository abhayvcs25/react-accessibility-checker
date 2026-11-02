import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const processor = Object.assign(vi.fn(), {
    apply_chat_template: vi.fn(),
    batch_decode: vi.fn(),
  });

  return {
    processor,
    loadProcessor: vi.fn(),
    loadModel: vi.fn(),
    generate: vi.fn(),
    dispose: vi.fn(),
  };
});

vi.mock('@huggingface/transformers', () => {
  class Tensor {
    dims = [1, 8];
    slice = vi.fn().mockReturnValue({});
  }

  mocks.generate.mockImplementation(() => new Tensor());

  return {
    AutoProcessor: { from_pretrained: mocks.loadProcessor },
    Qwen3_5ForConditionalGeneration: {
      from_pretrained: mocks.loadModel,
    },
    Tensor,
  };
});

import {
  closeQwenModel,
  generateQwenText,
  getQwenModelCacheDirectory,
  initializeQwenModel,
  QWEN_MAX_NEW_TOKENS,
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
} from '../../src/services/qwenModel.js';

describe('Qwen local inference runtime', () => {
  beforeEach(() => {
    process.env.RAC_MODEL_CACHE_DIR = 'C:\\nonexistent-qwen-test-cache';
    mocks.processor.mockReset().mockResolvedValue({
      input_ids: { dims: [1, 4] },
    });
    mocks.processor.apply_chat_template
      .mockReset()
      .mockReturnValue('formatted prompt');
    mocks.processor.batch_decode
      .mockReset()
      .mockReturnValue(['{"ok":true}']);
    mocks.loadProcessor.mockReset().mockResolvedValue(mocks.processor);
    mocks.loadModel.mockReset().mockResolvedValue({
      generate: mocks.generate,
      dispose: mocks.dispose,
    });
    mocks.generate.mockClear();
    mocks.dispose.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await closeQwenModel();
    delete process.env.RAC_MODEL_CACHE_DIR;
  });

  it('loads the pinned model lazily and returns decoded text', async () => {
    expect(mocks.loadProcessor).not.toHaveBeenCalled();
    expect(mocks.loadModel).not.toHaveBeenCalled();

    await expect(generateQwenText('Use only the supplied evidence.')).resolves.toBe(
      '{"ok":true}',
    );

    expect(mocks.loadProcessor).toHaveBeenCalledWith(
      QWEN_MODEL_ID,
      expect.objectContaining({ revision: QWEN_MODEL_REVISION }),
    );
    expect(mocks.loadModel).toHaveBeenCalledWith(
      QWEN_MODEL_ID,
      expect.objectContaining({
        revision: QWEN_MODEL_REVISION,
        device: 'cpu',
        dtype: {
          embed_tokens: 'q4',
          vision_encoder: 'fp16',
          decoder_model_merged: 'q4',
        },
      }),
    );
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_new_tokens: QWEN_MAX_NEW_TOKENS,
        do_sample: false,
      }),
    );
    expect(mocks.processor.apply_chat_template).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Use only the supplied evidence.' }],
      expect.objectContaining({
        add_generation_prompt: true,
        tokenize: false,
        enable_thinking: false,
      }),
    );
  });

  it('propagates model load failures and allows a later retry', async () => {
    mocks.loadModel.mockRejectedValueOnce(new Error('offline model unavailable'));

    await expect(generateQwenText('First attempt')).rejects.toThrow(
      'offline model unavailable',
    );
    await expect(generateQwenText('Retry attempt')).resolves.toBe('{"ok":true}');

    expect(mocks.loadProcessor).toHaveBeenCalledTimes(2);
    expect(mocks.loadModel).toHaveBeenCalledTimes(2);
  });

  it('uses the configured external model cache directory', () => {
    process.env.RAC_MODEL_CACHE_DIR = 'C:\\local-model-cache';

    expect(getQwenModelCacheDirectory()).toBe('C:\\local-model-cache');
  });

  it('can preload the pinned model without running inference', async () => {
    await initializeQwenModel();

    expect(mocks.loadProcessor).toHaveBeenCalledOnce();
    expect(mocks.loadModel).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();

    await generateQwenText('Use only the supplied evidence.');

    expect(mocks.loadProcessor).toHaveBeenCalledOnce();
    expect(mocks.loadModel).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it('loads a complete pinned snapshot directly from the external cache', async () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), 'rac-qwen-cache-'));
    const modelDirectory = join(
      cacheDirectory,
      QWEN_MODEL_ID,
      QWEN_MODEL_REVISION,
    );
    const files = [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/decoder_model_merged_q4.onnx',
      'onnx/decoder_model_merged_q4.onnx_data',
      'onnx/decoder_model_merged_q4.onnx_data_1',
      'onnx/embed_tokens_q4.onnx',
      'onnx/embed_tokens_q4.onnx_data',
      'onnx/vision_encoder_fp16.onnx',
      'onnx/vision_encoder_fp16.onnx_data',
    ];
    for (const file of files) {
      const path = join(modelDirectory, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    }
    process.env.RAC_MODEL_CACHE_DIR = cacheDirectory;

    try {
      await generateQwenText('Use only the supplied evidence.');

      expect(mocks.loadProcessor).toHaveBeenCalledWith(
        modelDirectory,
        { local_files_only: true },
      );
      expect(mocks.loadModel).toHaveBeenCalledWith(
        modelDirectory,
        expect.objectContaining({ local_files_only: true, device: 'cpu' }),
      );
    } finally {
      await closeQwenModel();
      rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });

  it('disposes the loaded model explicitly', async () => {
    await generateQwenText('Test prompt');
    await closeQwenModel();

    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
