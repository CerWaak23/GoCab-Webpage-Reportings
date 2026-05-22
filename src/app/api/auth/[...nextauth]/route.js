// NextAuth has been removed. This stub redirects old callback URLs to home.
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.redirect('https://go-cab-webpage-reportings.vercel.app');
}

export async function POST() {
  return NextResponse.json({ error: 'Not used' }, { status: 410 });
}
