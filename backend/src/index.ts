import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { MAX_BODY_SIZE, PORT } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import analyzeRouter from './routes/analyze.js';
import { closeChecker } from './services/checker.js';

const app = express();

app.use(
  cors({
    origin: 'http://localhost:5173',
    methods: ['POST', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(analyzeRouter);
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);

const server = createServer(app);
let isShuttingDown = false;

server.on('error', (error: Error) => {
  console.error('Backend server error:', error);
  process.exitCode = 1;
});

server.listen(PORT, () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    const { address: host, port } = address;
    console.log(`Backend server listening at http://${host}:${port}`);
  }
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down backend server.`);

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
    console.error('Failed to close backend HTTP server:', error);
    shutdownFailed = true;
  }

  try {
    await closeChecker();
  } catch (error) {
    console.error('Failed to close accessibility checker:', error);
    shutdownFailed = true;
  }

  if (shutdownFailed) {
    process.exitCode = 1;
  }
}

function handleSignal(signal: NodeJS.Signals): void {
  void shutdown(signal).catch((error: unknown) => {
    console.error('Unexpected error during backend shutdown:', error);
    process.exitCode = 1;
  });
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
