import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AutoProcessor,
  Qwen3_5ForConditionalGeneration,
} from '@huggingface/transformers';

export const QWEN_MODEL_ID = 'huggingworld/Qwen3.5-4B-ONNX';
export const QWEN_MODEL_REVISION =
  '8e3760349b4480f1f1a0f2d2010e46c5863262f1';
export const QWEN_MAX_NEW_TOKENS = 256;

const LOCAL_MODEL_REQUIRED_FILES = [
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
] as const;

type TransformersModule = typeof import('@huggingface/transformers');
type Processor = Awaited<
  ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>
>;
type QwenModel = Awaited<
  ReturnType<
    TransformersModule['Qwen3_5ForConditionalGeneration']['from_pretrained']
  >
>;

interface LoadedQwenModel {
  processor: Processor;
  model: QwenModel;
  Tensor: TransformersModule['Tensor'];
}

let modelPromise: Promise<LoadedQwenModel> | undefined;
let generationQueue: Promise<void> = Promise.resolve();

export function getQwenModelCacheDirectory(): string {
  const configuredPath = process.env.RAC_MODEL_CACHE_DIR?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const localAppData = process.env.LOCALAPPDATA;
  return localAppData
    ? join(localAppData, 'ReactAccessibilityChecker', 'models')
    : join(homedir(), '.cache', 'react-accessibility-checker', 'models');
}

async function loadQwenModel(): Promise<LoadedQwenModel> {
  const transformers = await import('@huggingface/transformers');
  const cacheDirectory = getQwenModelCacheDirectory();
  const localModelDirectory = join(
    cacheDirectory,
    QWEN_MODEL_ID,
    QWEN_MODEL_REVISION,
  );
  const hasCompleteLocalSnapshot = LOCAL_MODEL_REQUIRED_FILES.every((file) =>
    existsSync(join(localModelDirectory, file)),
  );
  const modelSource = hasCompleteLocalSnapshot
    ? localModelDirectory
    : QWEN_MODEL_ID;
  const loadOptions =
    hasCompleteLocalSnapshot
      ? { local_files_only: true }
      : {
          revision: QWEN_MODEL_REVISION,
          cache_dir: cacheDirectory,
          local_files_only: process.env.RAC_MODEL_OFFLINE === '1',
        };
  const processor = await transformers.AutoProcessor.from_pretrained(
    modelSource,
    loadOptions,
  );
  const model = await transformers.Qwen3_5ForConditionalGeneration.from_pretrained(
    modelSource,
    {
      ...loadOptions,
      device: 'cpu',
      dtype: {
        embed_tokens: 'q4',
        vision_encoder: 'fp16',
        decoder_model_merged: 'q4',
      },
    },
  );

  return { processor, model, Tensor: transformers.Tensor };
}

function getLoadedQwenModel(): Promise<LoadedQwenModel> {
  if (!modelPromise) {
    modelPromise = loadQwenModel().catch((error: unknown) => {
      modelPromise = undefined;
      throw error;
    });
  }
  return modelPromise;
}

async function generateText(prompt: string): Promise<string> {
  const { processor, model, Tensor } = await getLoadedQwenModel();
  const conversation = [{ role: 'user', content: prompt }];
  const chatTemplateOptions = {
    add_generation_prompt: true,
    tokenize: false,
    enable_thinking: false,
  };
  const formattedPrompt = processor.apply_chat_template(
    conversation,
    chatTemplateOptions,
  );
  const inputs = await processor(formattedPrompt);
  const inputIds = inputs.input_ids;
  const inputTokenCount = inputIds.dims[inputIds.dims.length - 1];

  if (!Number.isInteger(inputTokenCount)) {
    throw new Error('Qwen tokenizer returned invalid input dimensions.');
  }

  const generated = await model.generate({
    ...inputs,
    max_new_tokens: QWEN_MAX_NEW_TOKENS,
    do_sample: false,
  });

  if (!(generated instanceof Tensor)) {
    throw new Error('Qwen generation returned an unexpected output shape.');
  }

  const responseTokens = generated.slice(null, [inputTokenCount, null]);
  const decoded = processor.batch_decode(responseTokens, {
    skip_special_tokens: true,
  });
  const text = decoded[0]?.trim();

  if (!text) {
    throw new Error('Qwen generation returned empty output.');
  }

  return text;
}

export function generateQwenText(prompt: string): Promise<string> {
  const result = generationQueue.then(() => generateText(prompt));
  generationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function closeQwenModel(): Promise<void> {
  await generationQueue;
  if (!modelPromise) {
    return;
  }

  const loadedModel = await modelPromise;
  await loadedModel.model.dispose();
  modelPromise = undefined;
}
