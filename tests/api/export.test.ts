import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/intakes/export.csv/route';
import { BOM, csvCell, toCsv } from '../../lib/csv';
import { db as appDb } from '../../lib/db';

const db = new PrismaClient();

// Just enough of RFC 4180 to read back what the export writes. Kept here rather than in lib so
// the test does not grade the code with the code's own understanding of the format.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      cell += ch;
    }
  }

  return rows;
}

async function exported() {
  const response = await GET();
  // Not response.text(): UTF-8 decoding drops a leading BOM, which would hide a missing one.
  const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
  return { response, body, rows: parseCsv(body.slice(BOM.length)) };
}

async function intake(title: string, description: string, extra: Record<string, unknown> = {}) {
  return db.intake.create({
    data: {
      title,
      description,
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      ...extra,
    },
  });
}

async function seedMany(count: number) {
  // Same createdAt for all of them, so only the id tiebreak keeps the cursor honest.
  const createdAt = new Date();
  await db.intake.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      title: `Intake ${i}`,
      description: 'A description long enough to be realistic.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      status: i % 2 === 0 ? 'NEW' : 'DECLINED',
      createdAt,
    })),
  });
}

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('csvCell', () => {
  it('quotes every text cell, doubling the quotes inside', () => {
    expect(csvCell('Logistics')).toBe('"Logistics"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell(null)).toBe('');
  });

  it('keeps a semicolon inside its cell, so a semicolon locale cannot split it', () => {
    expect(csvCell("x;=1+cmd|' /C calc'!A0")).toBe(`"x;=1+cmd|' /C calc'!A0"`);
  });

  it('defuses a cell Excel would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('@sum')).toBe(`"'@sum"`);
    expect(csvCell('\t=1')).toBe(`"'\t=1"`);
  });

  it('does not touch a negative number', () => {
    expect(csvCell(-5)).toBe('-5');
  });

  it('ends every record with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"\r\n');
  });
});

describe('GET /api/intakes/export.csv', () => {
  it('names the download, marks it as CSV, and starts with the BOM', async () => {
    const { response, body } = await exported();

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="intakes-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(body.startsWith(BOM)).toBe(true);
  });

  it('round-trips a description with a comma, a quote and a newline', async () => {
    const description = 'Routes are planned by hand, "badly",\nand re-planned at noon.';
    await intake('Warehouse routing', description);

    const { rows } = await exported();

    expect(rows).toHaveLength(2);
    expect(rows[1][rows[0].indexOf('description')]).toBe(description);
  });

  it('exports every intake across batches, each exactly once', async () => {
    await seedMany(1_203);

    const { rows } = await exported();
    const ids = rows.slice(1).map((row) => row[0]);

    expect(ids).toHaveLength(1_203);
    expect(new Set(ids).size).toBe(1_203);
  });

  it('closes cleanly when the last batch is exactly full', async () => {
    await seedMany(1_000);

    const { rows } = await exported();

    expect(rows).toHaveLength(1_001);
    expect(rows.every((row) => row.length === rows[0].length)).toBe(true);
  });

  it('exports just the header when there is nothing to export', async () => {
    const { rows } = await exported();

    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('id');
  });

  it('fails the download, not truncates it, when a batch errors partway', async () => {
    await seedMany(501);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const findMany = appDb.intake.findMany.bind(appDb.intake);
    let calls = 0;
    const spy = vi.spyOn(appDb.intake, 'findMany').mockImplementation(((args: never) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error('database is locked')) : findMany(args);
    }) as never);

    // Erroring the stream is what makes the browser mark the download failed; a clean close
    // here would save 500 rows as if they were the whole file.
    await expect(new Response((await GET()).body).text()).rejects.toThrow('database is locked');
    expect(calls).toBe(2);

    spy.mockRestore();
    errors.mockRestore();
  });

  it('writes the analysis alongside the intake, without the provider error', async () => {
    const created = await intake('Churn model', 'A description long enough to be realistic.', {
      enrichment: {
        create: {
          state: 'READY',
          source: 'LLM',
          summary: 'Predict churn.',
          risks: JSON.stringify(['No labelled data', 'Tight timeline']),
          error: 'provider said something it should not have',
        },
      },
      tags: { create: [{ label: 'retention' }, { label: 'data-science' }] },
    });

    const { rows } = await exported();
    const record = Object.fromEntries(rows[0].map((key, i) => [key, rows[1][i]]));

    expect(record).toMatchObject({
      id: created.id,
      analysis_state: 'READY',
      analysis_source: 'LLM',
      summary: 'Predict churn.',
      tags: 'data-science; retention',
      risks: 'No labelled data; Tight timeline',
    });
    expect(rows.flat().join()).not.toContain('should not have');
  });

  it('exports risks as stored when they are not a JSON list', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const risks of ['not json', '{"a":1}']) {
      await intake(risks, 'A description long enough to be realistic.', {
        enrichment: { create: { state: 'READY', risks } },
      });
    }

    const { rows } = await exported();
    const at = rows[0].indexOf('risks');

    expect(rows.slice(1).map((row) => row[at]).sort()).toEqual(['not json', '{"a":1}']);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it('stops quietly when the download is cancelled mid-batch', async () => {
    await intake('Warehouse routing', 'A description long enough to be realistic.');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const reader = (await GET()).body!.getReader();
    await reader.read();
    // Cancel while the first batch query is still in flight.
    const pending = reader.read();
    await reader.cancel();
    await pending.catch(() => {});
    await new Promise((r) => setTimeout(r, 50));

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
