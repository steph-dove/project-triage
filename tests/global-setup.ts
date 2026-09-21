import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const DATABASE_URL = 'file:../data/test.db';

// Built from scratch each run, and never the development database.
export default function setup() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(resolve(process.cwd(), `data/test.db${suffix}`), { force: true });
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
}
