// NextAuth has been removed. This stub prevents 500 errors on old callback URLs.
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.redirect(new URL('/', process.env.NEXTAUTH_URL || 'https://go-cab-webpage-reportings.vercel.app'));
}

export async function POST() {
  return NextResponse.json({ error: 'Not used' }, { status: 410 });
}
