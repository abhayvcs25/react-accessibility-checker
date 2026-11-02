import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import type {
  AutoProcessor,
  Qwen3_5ForConditionalGeneration,
} from '@huggingface/transformers';

const MODEL_ID = 'huggingworld/Qwen3.5-4B-ONNX';
const REQUIRED_REVISION = '8e3760349b4480f1f1a0f2d2010e46c5863262f1';
const REQUIRED_FILES = [
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

interface LoadedModel {
  processor: Processor;
  model: QwenModel;
  Tensor: TransformersModule['Tensor'];
}

interface WorkerRequest {
  id: number;
  action: 'initialize' | 'generate' | 'dispose';
  prompt?: string;
  maxNewTokens?: number;
}

if (!parentPort) {
  throw new Error('Qwen model worker requires a parent thread.');
}

const port = parentPort;
let loadedModel: LoadedModel | undefined;

function getCacheDirectory(): string {
  const configuredPath = process.env.RAC_MODEL_CACHE_DIR?.trim();
  if (configuredPath) {
    return configuredPath;
  }
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData
    ? join(localAppData, 'ReactAccessibilityChecker', 'models')
    : join(homedir(), '.cache', 'react-accessibility-checker', 'models');
}

async function loadModel(): Promise<LoadedModel> {
  if (loadedModel) {
    return loadedModel;
  }
  const transformers = await import('@huggingface/transformers');
  const cacheDirectory = getCacheDirectory();
  const localModelDirectory = join(
    cacheDirectory,
    MODEL_ID,
    REQUIRED_REVISION,
  );
  const hasCompleteSnapshot = REQUIRED_FILES.every((file) =>
    existsSync(join(localModelDirectory, file)),
  );
  const modelSource = hasCompleteSnapshot ? localModelDirectory : MODEL_ID;
  const loadOptions = hasCompleteSnapshot
    ? { local_files_only: true }
    : {
        revision: REQUIRED_REVISION,
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
      session_options: {
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        executionMode: 'sequential',
      },
      dtype: {
        embed_tokens: 'q4',
        vision_encoder: 'fp16',
        decoder_model_merged: 'q4',
      },
    },
  );
  loadedModel = { processor, model, Tensor: transformers.Tensor };
  return loadedModel;
}

async function generateText(
  prompt: string,
  maxNewTokens: number,
): Promise<string> {
  const { processor, model, Tensor } = await loadModel();
  const templateOptions: NonNullable<
    Parameters<Processor['apply_chat_template']>[1]
  > & { enable_thinking: false } = {
    add_generation_prompt: true,
    tokenize: false,
    enable_thinking: false,
  };
  const formattedPrompt = processor.apply_chat_template(
    [{ role: 'user', content: prompt }],
    templateOptions,
  );
  const inputs = await processor(formattedPrompt);
  const inputTokenCount =
    inputs.input_ids.dims[inputs.input_ids.dims.length - 1];
  if (!Number.isInteger(inputTokenCount)) {
    throw new Error('Qwen tokenizer returned invalid input dimensions.');
  }

  const generated = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
  });
  if (!(generated instanceof Tensor)) {
    throw new Error('Qwen generation returned an unexpected output shape.');
  }

  const decoded = processor.batch_decode(
    generated.slice(null, [inputTokenCount, null]),
    { skip_special_tokens: true },
  );
  const text = decoded[0]?.trim();
  if (!text) {
    throw new Error('Qwen generation returned empty output.');
  }
  return text;
}

port.on('message', (request: WorkerRequest) => {
  void (async () => {
    try {
      if (request.action === 'initialize') {
        await loadModel();
        port.postMessage({ id: request.id, action: request.action });
        return;
      }
      if (request.action === 'generate') {
        if (typeof request.prompt !== 'string') {
          throw new Error('Qwen worker received an invalid prompt.');
        }
        const text = await generateText(
          request.prompt,
          request.maxNewTokens ?? 16,
        );
        port.postMessage({ id: request.id, action: request.action, text });
        return;
      }
      if (loadedModel) {
        await loadedModel.model.dispose();
        loadedModel = undefined;
      }
      port.postMessage({ id: request.id, action: request.action });
    } catch (error) {
      port.postMessage({
        id: request.id,
        action: request.action,
        error: error instanceof Error ? error.message : 'Unknown Qwen worker error',
      });
    }
  })();
});
