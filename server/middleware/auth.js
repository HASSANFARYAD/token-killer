import { verifyAccessToken, isSessionRevoked } from '../auth/jwt.js';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import crypto from 'node:crypto';

export function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  if (isSessionRevoked(payload.jti)) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  const db = getDb();
  const user = db.prepare(
    'SELECT id, email, display_name, role, status, tenant_id FROM users WHERE id = ? AND deleted_at IS NULL'
  ).get(parseInt(payload.sub, 10));

  if (!user) return res.status(401).json({ error: 'User not found' });
  if (user.status === 'disabled' || user.status === 'removed') {
    return res.status(403).json({ error: 'Account is disabled' });
  }

  req.user = user;
  req.jti = payload.jti;
  next();
}

export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const db = getDb();
  // API keys are bcrypt-hashed. For performance, do a fast SHA-256 pre-check first.
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const user = db.prepare(
    'SELECT id, email, role, tenant_id, status FROM users WHERE api_key_hash = ? AND deleted_at IS NULL'
  ).get(keyHash);

  if (!user) return res.status(401).json({ error: 'Invalid API key' });
  if (user.status === 'disabled' || user.status === 'removed') {
    return res.status(403).json({ error: 'Account is disabled' });
  }

  req.user = user;
  req.isApiKeyAuth = true;
  next();
}

export function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return next();
  const payload = verifyAccessToken(token);
  if (payload && !isSessionRevoked(payload.jti)) {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, email, display_name, role, status, tenant_id FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(parseInt(payload.sub, 10));
    if (user && user.status === 'active') req.user = user;
  }
  next();
}

function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
