const express = require('express');
const app = express();

const ARCHIVE = 'https://archive.prod.nado.xyz/v1';
const SUFFIX = '64656661756c740000000000'; // "default" subaccount
const MAX_PAGES = 8; // 8 x 500 = up to 4,000 matches
const cache = new Map();

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.get('/api/stats', async (req, res) => {
  const addr = String(req.query.address || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid wallet address' });

  const hit = cache.get(addr);
  if (hit && Date.now() - hit.t < 60000) return res.json(hit.d);

  let idx = null, volume = 0n, pnl = 0n, fees = 0n, trades = 0, first = null, truncated = false, days = new Set();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const matches = { subaccounts: [addr + SUFFIX], limit: 500 };
      if (idx) matches.idx = idx;
      const r = await fetch(ARCHIVE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches }),
      });
      if (r.status === 429) return res.status(429).json({ error: 'Nado API rate limit, try again in a minute' });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || 'API error ' + r.status);

      const list = data.matches || [];
      const ts = {};
      for (const t of data.txs || []) ts[t.submission_idx] = Number(t.timestamp);

      for (const m of list) {
        const q = BigInt(m.quote_filled || 0);
        volume += q < 0n ? -q : q;
        pnl += BigInt(m.realized_pnl || 0);
        fees += BigInt(m.fee || 0);
        trades++;
        const t = ts[m.submission_idx];
        if (t) days.add(Math.floor(t / 86400));
        if (t && (first === null || t < first)) first = t;
      }

      if (list.length < 500) break;
      idx = (BigInt(list[list.length - 1].submission_idx) - 1n).toString();
      if (page === MAX_PAGES - 1) truncated = true;
    }
  } catch (e) {
    return res.status(502).json({ error: 'Could not load data: ' + e.message });
  }

  const n = (b) => Number(b) / 1e18;
  const d = { address: addr, trades, volume: n(volume), pnl: n(pnl), fees: n(fees), first, truncated, days: days.size };
  cache.set(addr, { t: Date.now(), d });
  res.json(d);
});

app.listen(process.env.PORT || 3000);
