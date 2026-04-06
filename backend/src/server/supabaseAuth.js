import jwt from 'jsonwebtoken';
import crypto from 'crypto';

let cachedPublicKey = null;

async function getSupabasePublicKey() {
  if (cachedPublicKey) return cachedPublicKey;

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error('SUPABASE_URL env var required for ES256 JWT verification');

  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);

  const { keys } = await res.json();
  const key = keys[0];

  cachedPublicKey = crypto.createPublicKey({ key, format: 'jwk' });
  console.log('[Auth] Cached Supabase ES256 public key');
  return cachedPublicKey;
}

export async function verifySupabaseToken(token) {
  // Prefer ES256 via JWKS if SUPABASE_URL is set
  if (process.env.SUPABASE_URL) {
    const publicKey = await getSupabasePublicKey();
    return jwt.verify(token, publicKey, { algorithms: ['ES256'] });
  }

  // Fallback: HS256 with SUPABASE_JWT_SECRET
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is configured');
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}
