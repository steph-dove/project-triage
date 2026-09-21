// Local convenience only: production scales the standalone worker entrypoint instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.WORKER_IN_PROCESS !== 'true') return;

  const [{ db }, { loadWorkerConfig }, { stubProcessor }, { Worker }] = await Promise.all([
    import('./lib/db'),
    import('./lib/queue/config'),
    import('./lib/queue/processors/stub'),
    import('./lib/queue/worker'),
  ]);

  new Worker(db, loadWorkerConfig(), stubProcessor).start();
}
