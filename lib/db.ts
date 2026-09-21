import { PrismaClient } from '@prisma/client';

// $queryRawUnsafe, not $executeRawUnsafe: a PRAGMA assignment returns a row and Prisma rejects
// that on the execute path, so the obvious spelling fails and leaves WAL off.
const applyPragmas = async (client: PrismaClient) => {
  const [{ journal_mode: mode }] =
    await client.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode=WAL;');
  if (mode !== 'wal') {
    console.error(`[db] journal_mode is "${mode}", not WAL — expect SQLITE_BUSY under load`);
  }

  await client.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
};

const createClient = () => {
  const client = new PrismaClient();
  // Throwing here would take down module init rather than surfacing at a call site.
  void applyPragmas(client).catch((err) => {
    console.error('[db] failed to apply SQLite pragmas — expect SQLITE_BUSY under load', err);
  });
  return client;
};

// Without the global, every hot reload leaks a connection pool.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
