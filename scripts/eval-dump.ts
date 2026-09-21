import { resolve } from 'node:path';
import { db } from '../lib/db';
import { dumpEvals } from '../lib/evals';

dumpEvals(db, resolve(process.cwd(), 'evals'))
  .then(({ path, count }) => console.log(`Wrote ${count} run(s) to ${path}`))
  .catch((err) => {
    console.error('[eval:dump] failed', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
