import './env.js';
if (process.env.RAC_LOG_ANALYSIS === undefined) {
  process.env.RAC_LOG_ANALYSIS = '1';
}

await import('./index.js');

console.log(
  'Contextual AI providers are disabled while the six-model migration is pending; IBM analysis remains available.',
);
