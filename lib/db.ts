import { PrismaClient } from '@prisma/client';

// Several worker processes plus the web process share one SQLite file; without WAL they
// serialise on a single writer lock and start returning SQLITE_BUSY under load. Both pragmas
// go through $queryRawUnsafe because a PRAGMA assignment returns a row, which Prisma rejects
// on the execute path.
const applyPragmas = async (client: PrismaClient) => {
  // Persistent — stored in the database file itself, so setting it once per database is enough.
  const [{ journal_mode: mode }] =
    await client.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode=WAL;');
  if (mode !== 'wal') {
    console.error(`[db] journal_mode is "${mode}", not WAL — expect SQLITE_BUSY under load`);
  }

  // Per-connection, and matches Prisma's own default — set explicitly so a change in that
  // default does not quietly remove the thing keeping writers from failing fast.
  await client.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
};

const createClient = () => {
  const client = new PrismaClient();
  // Fire-and-forget: queries queue behind this anyway, and throwing here would take down module
  // initialisation rather than surfacing at a call site anyone can act on.
  void applyPragmas(client).catch((err) => {
    console.error('[db] failed to apply SQLite pragmas — expect SQLITE_BUSY under load', err);
  });
  return client;
};

// Next.js dev hot-reloads modules; without the global, every reload leaks a connection pool
// until SQLite runs out of file handles.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
