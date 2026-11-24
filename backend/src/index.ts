import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { MAX_BODY_SIZE, PORT, ALLOWED_ORIGINS } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { analyzeRateLimiter, analyzeSourceRateLimiter, projectIntakeRateLimiter } from './middleware/rateLimit.js';
import analyzeRouter from './routes/analyze.js';
import analyzeSourceRouter from './routes/analyzeSource.js';
import projectIntakeRouter from './routes/projectIntake.js';
import aiRouter from './routes/ai.js';
import { closeChecker } from './services/checker.js';
import logger from './logger.js';

const app = express();

app.use(requestIdMiddleware);
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use('/api/analyze', analyzeRateLimiter);
app.use('/api/analyze-source', analyzeSourceRateLimiter);
app.use('/api/project-intake', projectIntakeRateLimiter);
app.use(analyzeRouter);
app.use(analyzeSourceRouter);
app.use(projectIntakeRouter);
app.use(aiRouter);
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);

const server = createServer(app);
let isShuttingDown = false;

server.on('error', (error: Error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Backend server error');
  process.exitCode = 1;
});

server.listen(PORT, () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    const { address: host, port } = address;
    logger.info({ host, port }, `Backend server listening at http://${host}:${port}`);
  }
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down backend server');

  let shutdownFailed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to close backend HTTP server');
    shutdownFailed = true;
  }

  try {
    await closeChecker();
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to close accessibility checker');
    shutdownFailed = true;
  }

  if (shutdownFailed) {
    process.exitCode = 1;
  }
}

function handleSignal(signal: NodeJS.Signals): void {
  void shutdown(signal).catch((error: unknown) => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Unexpected error during backend shutdown');
    process.exitCode = 1;
  });
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
