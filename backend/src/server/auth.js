import jwt from 'jsonwebtoken';

export function buildAuthHook() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const cloudMode = process.env.CLOUD_MODE === 'true';

  return async function authHook(request, reply) {
    if (!cloudMode) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization token' });
    }

    try {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      request.user = { id: payload.sub, email: payload.email };
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  };
}
