import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { E2E_DATABASE_URL, E2E_ENV } from './env';

const ROOT = resolve(__dirname, '../..');

export const db = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });

export const INTAKE = {
  title: 'Freight demand forecasting',
  description:
    'We want to forecast freight demand across twenty depots. The current spreadsheet model is maintained by one analyst.',
  budgetRange: '$50k-100k',
  timeline: '6 weeks',
  industry: 'Logistics',
};

// A real worker process, the same entrypoint `npm run worker` runs, so the specs cover the
// queue as deployed rather than an in-process shortcut.
export class WorkerProcess {
  private child?: ChildProcess;

  async start(env: Record<string, string> = {}) {
    await this.stop();

    const child = spawn(resolve(ROOT, 'node_modules/.bin/tsx'), ['worker.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...E2E_ENV,
        WORKER_POLL_MS: '100',
        WORKER_HEARTBEAT_MS: '1000',
        WORKER_DRAIN_MS: '2000',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    let output = '';
    await new Promise<void>((ready, fail) => {
      const timer = setTimeout(() => fail(new Error(`worker did not start:\n${output}`)), 15_000);
      const onData = (chunk: Buffer) => {
        output += chunk;
        if (/\] up, concurrency/.test(output)) {
          clearTimeout(timer);
          ready();
        }
      };
      child.stdout!.on('data', onData);
      child.stderr!.on('data', onData);
      child.once('exit', (code) => {
        clearTimeout(timer);
        fail(new Error(`worker exited with ${code} before starting:\n${output}`));
      });
    });
  }

  // SIGTERM, so it drains and hands back anything in flight the way a deploy would.
  async stop() {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((done) => {
      child.once('exit', () => done());
      child.kill('SIGTERM');
    });
  }
}

// A click before React hydrates is lost (a Link does nothing, a form submits natively), so wait
// until every control has a fiber.
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await waitForHydration(page);
}

export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const controls = document.querySelectorAll('main a, main button');
    return (
      controls.length > 0 &&
      [...controls].every((el) => Object.keys(el).some((key) => key.startsWith('__reactFiber')))
    );
  });
}

export async function resetDatabase() {
  // Events and tags cascade from the intake.
  await db.intake.deleteMany();
}

export async function seedIntakes(count: number, overrides: { status?: string } = {}) {
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    await db.intake.create({
      data: {
        ...INTAKE,
        title: `Seeded intake ${i}`,
        status: overrides.status ?? 'NEW',
        createdAt: new Date(now - (count - i) * 60_000),
        // Already analysed, so nothing on the page is waiting on a worker.
        enrichment: {
          create: {
            state: 'READY',
            source: 'LLM',
            summary: `Summary for intake ${i}.`,
            risks: '[]',
          },
        },
        tags: { create: [{ label: 'seeded' }] },
      },
    });
  }
}

export const test = base.extend<{ worker: WorkerProcess; freshDatabase: void }>({
  // A fixture rather than a beforeEach here: a hook in an imported module only registers for
  // the first spec file that loads it.
  freshDatabase: [
    async ({}, provide) => {
      await resetDatabase();
      await provide();
    },
    { auto: true },
  ],
  worker: async ({}, provide) => {
    const worker = new WorkerProcess();
    await provide(worker);
    await worker.stop();
  },
});

export { expect };
