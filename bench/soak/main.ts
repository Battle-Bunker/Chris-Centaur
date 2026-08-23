/**
 * Scenario dispatcher for the V3 soak lane. Every scenario writes a CSV of raw
 * per-turn samples plus a one-line summary to stdout; nothing here asserts —
 * the numbers are the report.
 */

import * as fs from 'fs';
import * as path from 'path';

const OUT = path.resolve(__dirname, 'out');

export function writeCsv(name: string, rows: ReadonlyArray<Record<string, unknown>>): string {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.csv`);
  if (rows.length === 0) {
    fs.writeFileSync(file, '');
    return file;
  }
  const cols = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => String(row[c])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

export const argOf = (key: string, fallback: number): number => {
  const hit = process.argv.slice(3).find((a) => a.startsWith(`${key}=`));
  return hit === undefined ? fallback : Number(hit.slice(key.length + 1));
};

export const flagOf = (key: string): boolean =>
  process.argv.slice(3).some((a) => a === key || a === `${key}=1` || a === `${key}=true`);

async function dispatch(): Promise<void> {
  const scenario = process.argv[2] ?? 'soak';
  const mod = await import(`./scenarios/${scenario}`);
  await (mod.main as () => Promise<void>)();
}

void dispatch().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
