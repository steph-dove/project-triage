import { loadAiConfig } from './lib/ai/config';
import { db } from './lib/db';
import { loadWorkerConfig } from './lib/queue/config';
import { createEnrichmentProcessor } from './lib/queue/processors/enrich';
import { Worker } from './lib/queue/worker';

const config = loadWorkerConfig();
const ai = loadAiConfig();

const worker = new Worker(db, config, createEnrichmentProcessor(ai, config.maxAttempts));
worker.start();

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void worker
      .stop()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}
