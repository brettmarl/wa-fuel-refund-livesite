import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { parseRatesHtml } from './parse.mjs';

const SOURCE = 'https://dol.wa.gov/vehicles-and-boats/prorate-and-fuel-tax/fuel-tax/fuel-tax-refunds';
const FILE = process.argv[2] ?? 'rates.json';

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

const res = await fetch(SOURCE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wafuelrefund-rates/1.0; +https://www.wafuelrefund.com)' } });
if (!res.ok) fail(`DOL page returned HTTP ${res.status}`);
const found = parseRatesHtml(await res.text(), DOMParser);
if (!found.length) fail('No rate tables found on the DOL page. Its layout may have changed.');

for (const p of found) {
  const where = `${p.start} to ${p.end}`;
  if (!validDate(p.start) || !validDate(p.end) || p.start > p.end) fail(`Bad dates: ${where}`);
  for (const fuel of ['gas', 'diesel']) {
    const r = p[fuel];
    if (!(r.stateTax >= 0.2 && r.stateTax <= 2)) fail(`${fuel} state tax ${r.stateTax} looks wrong (${where})`);
    if (!(r.avgCost > 1 && r.avgCost < 20)) fail(`${fuel} average cost ${r.avgCost} looks wrong (${where})`);
  }
}

const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { periods: [] };
const oldPeriods = Array.isArray(old.periods) ? old.periods : [];
const earliest = found[found.length - 1].start;
const periods = [...found, ...oldPeriods.filter((p) => p.end < earliest)].sort((a, b) => b.start.localeCompare(a.start));

for (let i = 1; i < periods.length; i++) {
  const newer = periods[i - 1];
  const older = periods[i];
  if (older.end >= newer.start) fail(`Overlapping periods: ${older.start}..${older.end} and ${newer.start}..${newer.end}`);
  if (nextDay(older.end) !== newer.start) console.warn(`::warning::Gap between ${older.end} and ${newer.start}`);
}
if (oldPeriods.length && periods[0].end < oldPeriods[0].end) fail(`Newest period now ends ${periods[0].end}, before the published ${oldPeriods[0].end}`);

const now = new Date().toISOString();
const changed = JSON.stringify(periods) !== JSON.stringify(oldPeriods);
// keep keys added by hand (minAppVersion: builds older than it can't file)
const out = { ...old, source: SOURCE, checkedAt: now, changedAt: changed ? now : (old.changedAt ?? now), periods };
writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
console.log(changed ? `Rates changed: ${periods.length} periods, newest ${periods[0].start} to ${periods[0].end}` : 'Rates unchanged');
