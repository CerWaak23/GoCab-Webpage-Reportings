import { NextResponse } from 'next/server';

const FALLBACK_RATE = 920; // fallback if all sources fail

export async function GET() {
  // Try multiple free sources in order
  const sources = [
    {
      url: 'https://open.er-api.com/v6/latest/USD',
      extract: (data) => data?.rates?.CLP,
    },
    {
      url: 'https://api.frankfurter.app/latest?from=USD&to=CLP',
      extract: (data) => data?.rates?.CLP,
    },
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        next: { revalidate: 3600 }, // cache 1 hour server-side
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = src.extract(data);
      if (rate && rate > 0) {
        return NextResponse.json(
          { rate: Math.round(rate), source: src.url, cached: false },
          { headers: { 'Cache-Control': 'public, max-age=3600' } }
        );
      }
    } catch {
      // try next source
    }
  }

  // All sources failed — return fallback
  return NextResponse.json(
    { rate: FALLBACK_RATE, source: 'fallback', cached: false },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
}
