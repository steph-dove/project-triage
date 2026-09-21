import { db } from './lib/db';
import { loadWorkerConfig } from './lib/queue/config';
import { stubProcessor } from './lib/queue/processors/stub';
import { Worker } from './lib/queue/worker';

const worker = new Worker(db, loadWorkerConfig(), stubProcessor);
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
