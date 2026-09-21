import type { Worker } from './lib/queue/worker';

// Hot reload calls register() again, and a second worker would race the first for claims.
const globalForWorker = globalThis as unknown as { triageWorker?: Worker };

// Local convenience only: production scales the standalone worker entrypoint instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.WORKER_IN_PROCESS !== 'true') return;
  if (globalForWorker.triageWorker) return;

  const [{ db }, { loadAiConfig }, { loadWorkerConfig }, { createEnrichmentProcessor }, { Worker }] =
    await Promise.all([
      import('./lib/db'),
      import('./lib/ai/config'),
      import('./lib/queue/config'),
      import('./lib/queue/processors/enrich'),
      import('./lib/queue/worker'),
    ]);

  const config = loadWorkerConfig();
  const worker = new Worker(
    db,
    config,
    createEnrichmentProcessor(loadAiConfig(), config.maxAttempts),
  );
  globalForWorker.triageWorker = worker;
  worker.start();

  // Next owns the exit, so this only has to hand the claims back before it happens.
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void worker.stop();
    });
  }
}
