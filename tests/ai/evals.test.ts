import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dumpEvals } from '../../lib/evals';

const db = new PrismaClient();
let dir: string;

async function intakeIn(title: string, enrichment: Record<string, unknown>, tags: string[] = []) {
  await db.intake.create({
    data: {
      title,
      description: 'Route planning is done by hand each morning in spreadsheets.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      enrichment: { create: enrichment },
      tags: { create: tags.map((label) => ({ label })) },
    },
  });
}

const readLines = async (path: string) =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

beforeEach(async () => {
  await db.intake.deleteMany();
  dir = await mkdtemp(join(tmpdir(), 'evals-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('dumpEvals', () => {
  it('writes one line per finished analysis, with the input, the raw body and the cost', async () => {
    await intakeIn(
      'Routing pilot',
      {
        state: 'READY',
        source: 'LLM',
        model: 'gpt-4o-mini',
        promptVersion: 'v3',
        attempts: 1,
        summary: 'A routing pilot.',
        risks: JSON.stringify(['Manual process']),
        rawResponse: '{"summary":"A routing pilot."}',
        latencyMs: 812,
        tokensIn: 410,
        tokensOut: 95,
      },
      ['routing', 'logistics', 'pilot'],
    );

    const { path, count } = await dumpEvals(db, dir, new Date('2026-09-20T21:30:05.123Z'));

    expect(count).toBe(1);
    expect(basename(path)).toBe('runs-2026-09-20T21-30-05Z.jsonl');

    const [line] = await readLines(path);
    expect(line).toMatchObject({
      input: { title: 'Routing pilot', industry: 'Logistics' },
      state: 'READY',
      source: 'LLM',
      model: 'gpt-4o-mini',
      promptVersion: 'v3',
      rawResponse: '{"summary":"A routing pilot."}',
      saved: {
        summary: 'A routing pilot.',
        tags: ['routing', 'logistics', 'pilot'],
        risks: ['Manual process'],
      },
      latencyMs: 812,
      tokensIn: 410,
      tokensOut: 95,
    });
  });

  it('keeps fallbacks and hard failures, and leaves out work still in flight', async () => {
    await intakeIn('Fell back', {
      state: 'READY',
      source: 'FALLBACK',
      rawResponse: '{"fallbackReason":"upstream 503"}',
    });
    await intakeIn('Failed', { state: 'FAILED', error: 'OpenAI rejected the request with 401' });
    await intakeIn('Queued', { state: 'PENDING' });
    await intakeIn('Running', { state: 'PROCESSING' });

    const { path, count } = await dumpEvals(db, dir);
    const titles = (await readLines(path)).map((l) => l.input.title).sort();

    expect(count).toBe(2);
    expect(titles).toEqual(['Failed', 'Fell back']);
  });

  it('does not let one bad risks column sink the whole dump', async () => {
    await intakeIn('Legacy row', { state: 'READY', risks: 'not json' });

    const { path } = await dumpEvals(db, dir);
    const [line] = await readLines(path);

    expect(line.saved.risks).toEqual([]);
  });

  it('writes an empty file rather than failing when there is nothing to dump', async () => {
    const { path, count } = await dumpEvals(db, dir);

    expect(count).toBe(0);
    expect(await readFile(path, 'utf8')).toBe('');
  });
});
