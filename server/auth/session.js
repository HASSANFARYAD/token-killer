import { getDb } from '../db/index.js';
import { issueAccessToken, issueRefreshToken, hashRefreshToken } from './jwt.js';
import { config } from '../config.js';

export function createSession(user, { ipAddress, userAgent } = {}) {
  const db = getDb();
  const { token: accessToken, jti } = issueAccessToken(user);
  const { raw: refreshRaw, hash: refreshHash } = issueRefreshToken(user.id);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, access_token_jti, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, refreshHash, jti, ipAddress || null, userAgent || null, expiresAt.toISOString());

  db.prepare(`UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`)
    .run(ipAddress || null, user.id);

  return { accessToken, refreshToken: refreshRaw };
}

export function refreshSession(rawRefreshToken, { ipAddress, userAgent } = {}) {
  const db = getDb();
  const hash = hashRefreshToken(rawRefreshToken);

  const session = db.prepare(`
    SELECT s.*, u.id as uid, u.email, u.role, u.tenant_id, u.status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > datetime('now')
  `).get(hash);

  if (!session) return null;
  if (session.status === 'disabled' || session.status === 'removed') return null;

  // Rotate refresh token and access token
  const { token: accessToken, jti } = issueAccessToken({
    id: session.uid,
    email: session.email,
    role: session.role,
    tenant_id: session.tenant_id,
  });
  const { raw: newRaw, hash: newHash } = issueRefreshToken(session.uid);

  db.prepare(`
    UPDATE sessions
    SET token_hash = ?, access_token_jti = ?, last_used_at = datetime('now')
    WHERE id = ?
  `).run(newHash, jti, session.id);

  return {
    accessToken,
    refreshToken: newRaw,
    user: {
      id: session.uid,
      email: session.email,
      role: session.role,
      tenantId: session.tenant_id,
    },
  };
}

export function revokeSession(rawRefreshToken) {
  const db = getDb();
  const hash = hashRefreshToken(rawRefreshToken);
  db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).run(hash);
}

export function revokeAllUserSessions(userId) {
  getDb().prepare(`
    UPDATE sessions SET revoked_at = datetime('now')
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(userId);
}

export function cleanExpiredSessions() {
  getDb().prepare(`
    DELETE FROM sessions
    WHERE expires_at < datetime('now')
    OR revoked_at IS NOT NULL AND revoked_at < datetime('now', '-24 hours')
  `).run();
}

export function setTokenCookies(res, { accessToken, refreshToken }) {
  res.cookie(config.session.cookieName, refreshToken, {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return accessToken;
}

export function clearTokenCookies(res) {
  res.clearCookie(config.session.cookieName, { path: '/' });
}
