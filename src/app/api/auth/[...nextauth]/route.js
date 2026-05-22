// NextAuth has been removed. This stub redirects old callback URLs to home.
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.redirect('https://gobillschile.lat');
}

export async function POST() {
  return NextResponse.json({ error: 'Not used' }, { status: 410 });
}
