process.env.RAC_ENABLE_QWEN_ASSESSMENTS = '1';
if (process.env.RAC_LOG_ANALYSIS === undefined) {
  process.env.RAC_LOG_ANALYSIS = '1';
}

const { initializeQwenModel, QWEN_MODEL_ID, QWEN_MODEL_REVISION } =
  await import('./services/qwenModel.js');

await import('./index.js');

console.log(
  `Loading local Qwen model ${QWEN_MODEL_ID} at revision ${QWEN_MODEL_REVISION}...`,
);
void initializeQwenModel()
  .then(() => {
    console.log('Local Qwen model is ready for contextual assessments.');
  })
  .catch((error: unknown) => {
    console.error(
      'Local Qwen model failed to load. IBM accessibility analysis remains available; check model cache/network settings before retrying.',
      error,
    );
  });
