// Descriptions come from a public form and this file opens in Excel, where a cell starting with
// one of these runs as a formula. A leading apostrophe makes it text; it is the OWASP advice.
const FORMULA_START = /^[=+\-@\t\r]/;

export const BOM = '﻿';

// Every text cell is quoted, not only the ones with a comma in: Excel in a semicolon locale
// splits an unquoted cell on ';', and the half after it gets no formula guard.
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

// CRLF between records, as RFC 4180 has it. Newlines inside a quoted cell stay as they are.
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
