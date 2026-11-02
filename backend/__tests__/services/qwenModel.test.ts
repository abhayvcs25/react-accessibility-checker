import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface WorkerRequestForTest {
  id: number;
  action: 'initialize' | 'generate' | 'dispose';
  prompt?: string;
  maxNewTokens?: number;
}

interface FakeWorkerForTest {
  handlers: Map<string, (...args: unknown[]) => void>;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
  postMessage: (request: WorkerRequestForTest) => void;
  terminate: ReturnType<typeof vi.fn>;
}

type WorkerRequestHandler = (
  worker: FakeWorkerForTest,
  request: WorkerRequestForTest,
) => void;

const mocks = vi.hoisted(() => ({
  workers: [] as FakeWorkerForTest[],
  requests: [] as WorkerRequestForTest[],
  responses: [] as Array<{ text?: string; error?: string }>,
  onRequest: undefined as WorkerRequestHandler | undefined,
}));

vi.mock('node:worker_threads', () => ({
  Worker: class {
    handlers = new Map<string, (...args: unknown[]) => void>();
    terminate = vi.fn().mockResolvedValue(0);

    constructor() {
      mocks.workers.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    postMessage(request: WorkerRequestForTest) {
      mocks.requests.push(request);
      if (mocks.onRequest) {
        mocks.onRequest(this, request);
        return;
      }
      const response = mocks.responses.shift() ?? {};
      queueMicrotask(() => {
        this.handlers.get('message')?.({
          id: request.id,
          action: request.action,
          ...response,
        });
      });
    }
  },
}));

import {
  closeQwenModel,
  generateQwenText,
  getQwenModelCacheDirectory,
  initializeQwenModel,
  isQwenGenerationInProgress,
  QWEN_MAX_NEW_TOKENS,
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
} from '../../src/services/qwenModel.js';

describe('Qwen worker client', () => {
  beforeEach(() => {
    process.env.RAC_MODEL_CACHE_DIR = 'C:\\nonexistent-qwen-test-cache';
    mocks.workers.length = 0;
    mocks.requests.length = 0;
    mocks.responses.length = 0;
    mocks.onRequest = undefined;
  });

  afterEach(async () => {
    await closeQwenModel();
    delete process.env.RAC_MODEL_CACHE_DIR;
  });

  it('preloads the model once in a worker and generates without reloading', async () => {
    mocks.responses.push({}, { text: '0' });

    await initializeQwenModel();
    await expect(generateQwenText('Classify this name.')).resolves.toBe('0');

    expect(mocks.workers).toHaveLength(1);
    expect(mocks.requests.map(({ action }) => action)).toEqual([
      'initialize',
      'generate',
    ]);
    expect(mocks.requests[1]).toMatchObject({
      prompt: 'Classify this name.',
      maxNewTokens: QWEN_MAX_NEW_TOKENS,
    });
  });

  it('uses the configured external model cache directory', () => {
    process.env.RAC_MODEL_CACHE_DIR = 'C:\\local-model-cache';

    expect(getQwenModelCacheDirectory()).toBe('C:\\local-model-cache');
    expect(QWEN_MODEL_ID).toBe('huggingworld/Qwen3.5-4B-ONNX');
    expect(QWEN_MODEL_REVISION).toBe(
      '8e3760349b4480f1f1a0f2d2010e46c5863262f1',
    );
  });

  it('retries model generation after a worker-reported inference error', async () => {
    mocks.responses.push({}, { error: 'model unavailable' }, { text: '0' });

    await expect(generateQwenText('First attempt')).rejects.toThrow(
      'model unavailable',
    );
    await expect(generateQwenText('Retry attempt')).resolves.toBe('0');

    expect(
      mocks.requests.filter(({ action }) => action === 'initialize'),
    ).toHaveLength(1);
    expect(
      mocks.requests.filter(({ action }) => action === 'generate'),
    ).toHaveLength(2);
  });

  it('tracks an active generation until its worker response arrives', async () => {
    let respond: (() => void) | undefined;
    mocks.onRequest = (worker, request) => {
      if (request.action === 'generate') {
        respond = () => {
          worker.handlers.get('message')?.({
            id: request.id,
            action: request.action,
            text: '0',
          });
        };
        return;
      }
      queueMicrotask(() => {
        worker.handlers.get('message')?.({
          id: request.id,
          action: request.action,
        });
      });
    };

    const generation = generateQwenText('Slow generation');
    while (!respond) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(isQwenGenerationInProgress()).toBe(true);
    respond?.();
    await expect(generation).resolves.toBe('0');
    mocks.onRequest = undefined;
    expect(isQwenGenerationInProgress()).toBe(false);
  });

  it('disposes and terminates the worker on shutdown', async () => {
    mocks.responses.push({}, {});
    await initializeQwenModel();
    const worker = mocks.workers[0];

    await closeQwenModel();

    expect(mocks.requests.map(({ action }) => action)).toEqual([
      'initialize',
      'dispose',
    ]);
    expect(worker?.terminate).toHaveBeenCalledOnce();
  });

  it('terminates the worker without waiting for an active generation', async () => {
    mocks.onRequest = (worker, request) => {
      if (request.action === 'generate') {
        return;
      }
      queueMicrotask(() => {
        worker.handlers.get('message')?.({
          id: request.id,
          action: request.action,
        });
      });
    };

    const generation = generateQwenText('Generation interrupted by shutdown');
    while (!mocks.requests.some(({ action }) => action === 'generate')) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const worker = mocks.workers[0];
    expect(isQwenGenerationInProgress()).toBe(true);

    await closeQwenModel();
    await expect(generation).rejects.toThrow('closed before completing');

    expect(worker?.terminate).toHaveBeenCalledOnce();
    expect(isQwenGenerationInProgress()).toBe(false);
  });
});
