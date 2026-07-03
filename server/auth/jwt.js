import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

export function generateJti() {
  return crypto.randomBytes(16).toString('hex');
}

export function issueAccessToken(user) {
  const jti = generateJti();
  const payload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    tenantId: user.tenant_id || null,
    jti,
  };
  const token = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.jwt.issuer,
  });
  return { token, jti };
}

export function issueRefreshToken(userId, sessionId) {
  const raw = crypto.randomBytes(40).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer });
  } catch {
    return null;
  }
}

export function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function isSessionRevoked(jti) {
  const db = getDb();
  const session = db.prepare(
    'SELECT revoked_at FROM sessions WHERE access_token_jti = ?'
  ).get(jti);
  if (!session) return true;
  return session.revoked_at !== null;
}
