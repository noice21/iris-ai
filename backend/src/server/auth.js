import { verifySupabaseToken } from './supabaseAuth.js';

export function buildAuthHook() {
  const cloudMode = process.env.CLOUD_MODE === 'true';
  const serviceKey = process.env.SERVICE_API_KEY;

  return async function authHook(request, reply) {
    if (!cloudMode) return;

    // Allow service-to-service calls with a static key
    const incomingKey = (request.headers['x-api-key'] ?? '').trim();
    const storedKey = (serviceKey ?? '').trim();
    console.log(`[Auth] x-api-key check: stored=${storedKey.length} incoming=${incomingKey.length} match=${storedKey && incomingKey === storedKey}`);
    if (storedKey && incomingKey === storedKey) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization token' });
    }

    try {
      const token = authHeader.slice(7);
      const payload = await verifySupabaseToken(token);
      request.user = { id: payload.sub, email: payload.email };
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  };
}
