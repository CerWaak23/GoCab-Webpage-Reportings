import { NextResponse } from 'next/server';
import { COOKIE_CONDUCTOR } from '@/lib/sesion-conductor';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_CONDUCTOR, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
