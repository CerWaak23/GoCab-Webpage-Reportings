import { NextResponse } from 'next/server';

// Module-level cache: persists across requests in the same server process.
// Acts as "last known good rate" when live APIs are unavailable.
let _lastKnownRate = 890;
let _lastFetchedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SOURCES = [
  {
    url: 'https://open.er-api.com/v6/latest/USD',
    extract: (data) => data?.rates?.CLP,
  },
  {
    url: 'https://api.frankfurter.app/latest?from=USD&to=CLP',
    extract: (data) => data?.rates?.CLP,
  },
];

export async function GET() {
  // Serve from in-memory cache if fresh enough
  if (_lastFetchedAt && Date.now() - _lastFetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(
      { rate: _lastKnownRate, source: 'cache', cached: true },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
  }

  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = src.extract(data);
      if (rate && rate > 0) {
        _lastKnownRate = Math.round(rate); // update last known good rate
        _lastFetchedAt = Date.now();
        return NextResponse.json(
          { rate: _lastKnownRate, source: src.url, cached: false },
          { headers: { 'Cache-Control': 'public, max-age=3600' } }
        );
      }
    } catch {
      // try next source
    }
  }

  // All sources failed — return last known rate (whatever was fetched before)
  return NextResponse.json(
    { rate: _lastKnownRate, source: 'last-known', cached: true },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
}
