import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), 'data', 'ai-cache');

export const cacheKey = (parts: unknown) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

export async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[ai] could not read the response cache, calling the model instead', err);
    }
    return undefined;
  }
}

export async function writeCache(key: string, value: unknown) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2));
  } catch (err) {
    console.error('[ai] could not write the response cache', err);
  }
}
