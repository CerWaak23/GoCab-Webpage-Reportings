/**
 * Núcleo de sesión — firma y verificación HMAC-SHA256 del token.
 *
 * Vive separado de session.js porque el middleware corre en el runtime Edge,
 * donde `next/headers` no existe. Este archivo no importa nada de Next, así que
 * lo pueden usar por igual el middleware, los Route Handlers y los Server
 * Components.
 */

const COOKIE_NAME = 'gocab_session';
const SESSION_DAYS = 7;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

// ── Crypto helpers (Edge + Node compatible, no Buffer) ───────────────────────

function toBase64url(buffer) {
  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// ── Token creation / verification ────────────────────────────────────────────

export async function createSessionToken(user) {
  const payload = JSON.stringify({
    email: user.email,
    name: user.name,
    role: user.role,
    isManager: user.isManager,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  });

  const payloadB64 = toBase64url(new TextEncoder().encode(payload));
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64url(sig)}`;
}

export async function verifySessionToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  try {
    const key = await getKey();
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadB64)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SESSION_SECONDS };
