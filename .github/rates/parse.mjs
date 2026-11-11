const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

function parseDay(s, fallbackYear) {
  const m = /([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const year = m[3] ? +m[3] : fallbackYear;
  if (!month || !year) return null;
  return { y: year, m: month, d: +m[2] };
}

const money = (s) => {
  const m = /\$?\s*(\d+(?:\.\d+)?)/.exec(s ?? '');
  return m ? parseFloat(m[1]) : 0;
};

/** DOL's "Fuel tax refunds" page → rate periods, newest first. */
export function parseRatesHtml(html, DOMParser) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const t = /Rates \(per gallon\):\s*(.+)$/i.exec(clean(h.textContent));
    if (!t) continue;
    const [a, b] = t[1].split(/\s+to\s+|\s*[–—-]\s*/);
    const end = b && parseDay(b);
    const start = end && parseDay(a, end.y);
    if (!end || !start) continue;
    if (start.y === end.y && start.m > end.m) start.y -= 1;

    let table = h.nextElementSibling;
    while (table && table.tagName.toUpperCase() !== 'TABLE') table = table.nextElementSibling;
    if (!table) continue;

    const rows = new Map();
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td')].map((td) => clean(td.textContent));
      if (cells.length) rows.set(cells[0].toLowerCase(), cells.slice(1));
    }
    const get = (prefix, col) => {
      for (const [k, v] of rows) if (k.startsWith(prefix)) return money(v[col]);
      return 0;
    };
    const useLabel = [...rows.keys()].find((k) => k.startsWith('net use')) ?? '';
    const pct = /rate of\s*([\d.]+)\s*%/.exec(useLabel);
    const fuel = (col) => ({
      stateTax: get('state fuel tax', col),
      useTax: get('net use', col),
      coastalFee: get('coastal protection', col),
      avgCost: get('dol average cost', col) || null,
      federalTax: get('federal fuel tax', col),
      salesTaxRate: pct ? parseFloat(pct[1]) / 100 : undefined,
    });
    const gas = fuel(0);
    if (!gas.stateTax) continue;
    out.push({
      start: `${start.y}-${pad(start.m)}-${pad(start.d)}`,
      end: `${end.y}-${pad(end.m)}-${pad(end.d)}`,
      gas,
      diesel: fuel(1),
    });
  }
  return out.sort((x, y) => y.start.localeCompare(x.start));
}
