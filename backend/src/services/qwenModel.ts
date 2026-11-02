import { homedir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const QWEN_MODEL_ID = 'huggingworld/Qwen3.5-4B-ONNX';
export const QWEN_MODEL_REVISION =
  '8e3760349b4480f1f1a0f2d2010e46c5863262f1';
export const QWEN_MAX_NEW_TOKENS = 16;

interface WorkerRequest {
  id: number;
  action: 'initialize' | 'generate' | 'dispose';
  prompt?: string;
  maxNewTokens?: number;
}

interface WorkerResponse {
  id: number;
  action: WorkerRequest['action'];
  text?: string;
  error?: string;
}

interface PendingRequest {
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let workerReady = false;
let generationActive = false;
let nextRequestId = 0;
let generationQueue: Promise<void> = Promise.resolve();
let initializationPromise: Promise<void> | undefined;
const pendingRequests = new Map<number, PendingRequest>();

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

function resetWorker(instance: Worker, error: Error): void {
  if (worker !== instance) {
    return;
  }
  worker = undefined;
  workerReady = false;
  initializationPromise = undefined;
  generationActive = false;
  for (const request of pendingRequests.values()) {
    request.reject(error);
  }
  pendingRequests.clear();
}

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  const isTypeScriptRuntime = import.meta.url.endsWith('.ts');
  const workerUrl = new URL(
    isTypeScriptRuntime ? './qwenModelWorker.ts' : './qwenModelWorker.js',
    import.meta.url,
  );
  const instance = new Worker(
    workerUrl,
    isTypeScriptRuntime ? { execArgv: ['--import', 'tsx'] } : {},
  );

  instance.on('message', (response: WorkerResponse) => {
    const request = pendingRequests.get(response.id);
    if (!request) {
      return;
    }
    pendingRequests.delete(response.id);

    if (response.error) {
      request.reject(new Error(response.error));
    } else {
      request.resolve(response.text);
    }
  });
  instance.on('error', (error: Error) => resetWorker(instance, error));
  instance.on('exit', (code) => {
    if (worker === instance) {
      resetWorker(
        instance,
        new Error(`Qwen worker exited unexpectedly with code ${code}.`),
      );
    }
  });

  worker = instance;
  return instance;
}

function sendWorkerRequest(
  action: WorkerRequest['action'],
  payload: Omit<WorkerRequest, 'id' | 'action'> = {},
): Promise<string | undefined> {
  const instance = getWorker();
  const id = ++nextRequestId;
  const request: WorkerRequest = { id, action, ...payload };

  return new Promise<string | undefined>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    instance.postMessage(request);
  });
}

export async function initializeQwenModel(): Promise<void> {
  if (workerReady) {
    return;
  }
  if (!initializationPromise) {
    initializationPromise = sendWorkerRequest('initialize')
      .then(() => {
        workerReady = true;
      })
      .catch((error: unknown) => {
        initializationPromise = undefined;
        throw error;
      });
  }

  await initializationPromise;
}

export function generateQwenText(
  prompt: string,
  maxNewTokens = QWEN_MAX_NEW_TOKENS,
): Promise<string> {
  const result = generationQueue.then(async () => {
    generationActive = true;
    try {
      await initializeQwenModel();
      const text = await sendWorkerRequest('generate', {
        prompt,
        maxNewTokens,
      });
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Qwen worker returned empty output.');
      }
      return text;
    } finally {
      generationActive = false;
    }
  });
  generationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function isQwenGenerationInProgress(): boolean {
  return generationActive;
}

export async function closeQwenModel(): Promise<void> {
  const instance = worker;
  if (!instance) {
    return;
  }

  if (workerReady && !generationActive) {
    try {
      await sendWorkerRequest('dispose');
    } finally {
      if (worker === instance) {
        worker = undefined;
        workerReady = false;
        initializationPromise = undefined;
        await instance.terminate();
      }
    }
    return;
  }

  resetWorker(instance, new Error('Qwen worker closed before completing its request.'));
  await instance.terminate();
}
