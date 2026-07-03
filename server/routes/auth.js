import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { createSession, refreshSession, revokeSession, setTokenCookies, clearTokenCookies } from '../auth/session.js';
import { getAuthCodeUrl, exchangeCode, extractUserFromIdToken } from '../auth/microsoft.js';
import { hashRefreshToken } from '../auth/jwt.js';
import { validate, schemas } from '../middleware/validation.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';
import { config } from '../config.js';

const router = Router();

// State + nonce store (in-memory, short-lived, production should use Redis or DB)
const pendingStates = new Map();

function makePending() {
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { nonce, createdAt: Date.now() });
  // Clean up states older than 10 minutes
  for (const [k, v] of pendingStates) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingStates.delete(k);
  }
  return { state, nonce };
}

// GET /api/auth/microsoft — redirect to Microsoft login
router.get('/microsoft', async (req, res) => {
  if (!config.microsoft.clientId) {
    return res.status(503).json({ error: 'Microsoft authentication is not configured' });
  }
  const { state, nonce } = makePending();
  try {
    const url = await getAuthCodeUrl({ state, nonce });
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build Microsoft login URL', detail: err.message });
  }
});

// GET /api/auth/microsoft/callback — handle OAuth callback
router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(error_description || error)}`);
  }

  const pending = pendingStates.get(state);
  if (!pending) {
    return res.redirect('/admin/login?error=Invalid+or+expired+state');
  }
  pendingStates.delete(state);

  try {
    const tokenResponse = await exchangeCode(code, { nonce: pending.nonce });
    const msUser = extractUserFromIdToken(tokenResponse.idTokenClaims);

    const db = getDb();
    let user = db.prepare(
      'SELECT * FROM users WHERE microsoft_id = ? OR (email = ? COLLATE NOCASE AND auth_provider = \'microsoft\')'
    ).get(msUser.microsoftId, msUser.email);

    if (!user) {
      // Auto-provision if this is the very first user (becomes super_admin)
      const userCount = db.prepare('SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL').get().n;
      const role = userCount === 0 ? 'super_admin' : 'user';

      const result = db.prepare(`
        INSERT INTO users (email, display_name, given_name, surname, microsoft_id, auth_provider, role, status)
        VALUES (?, ?, ?, ?, ?, 'microsoft', ?, 'active')
      `).run(msUser.email, msUser.displayName, msUser.givenName, msUser.surname, msUser.microsoftId, role);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      logAudit({ action: 'user.auto_provision', resourceType: 'user', resourceId: user.id, newValue: { email: user.email, role }, ip: req.ip });
    } else if (user.status === 'disabled') {
      return res.redirect('/admin/login?error=Account+is+disabled');
    } else {
      // Update profile fields from Microsoft
      db.prepare(`
        UPDATE users SET display_name = ?, given_name = ?, surname = ?, microsoft_id = ?, last_login_at = datetime('now'), last_login_ip = ?
        WHERE id = ?
      `).run(msUser.displayName, msUser.givenName, msUser.surname, msUser.microsoftId, req.ip, user.id);
    }

    const tokens = createSession(user, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    setTokenCookies(res, tokens);

    logAudit({ userId: user.id, tenantId: user.tenant_id, action: 'auth.login', resourceType: 'session', ip: req.ip, userAgent: req.headers['user-agent'] });
    res.redirect('/admin/dashboard');
  } catch (err) {
    res.redirect(`/admin/login?error=${encodeURIComponent(err.message)}`);
  }
});

// POST /api/auth/login — local email/password login
router.post('/login', authLimiter, validate(schemas.loginLocal), async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare(
    'SELECT * FROM users WHERE email = ? COLLATE NOCASE AND auth_provider = \'local\' AND deleted_at IS NULL'
  ).get(email);

  const valid = user && user.password_hash
    ? await bcrypt.compare(password, user.password_hash)
    : false;

  if (!valid) {
    logAudit({ action: 'auth.login_failed', resourceType: 'user', ip: req.ip, result: 'failure', errorMessage: `Failed login for ${email}` });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status === 'disabled') return res.status(403).json({ error: 'Account is disabled' });

  const tokens = createSession(user, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  const accessToken = setTokenCookies(res, tokens);

  logAudit({ userId: user.id, tenantId: user.tenant_id, action: 'auth.login', resourceType: 'session', ip: req.ip });
  res.json({ accessToken, user: publicUser(user) });
});

// POST /api/auth/refresh — rotate tokens using refresh token cookie
router.post('/refresh', (req, res) => {
  const raw = req.cookies?.[config.session.cookieName];
  if (!raw) return res.status(401).json({ error: 'No refresh token' });

  const result = refreshSession(raw, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  if (!result) {
    clearTokenCookies(res);
    return res.status(401).json({ error: 'Refresh token expired or revoked' });
  }

  setTokenCookies(res, { accessToken: result.accessToken, refreshToken: result.refreshToken });
  res.json({ accessToken: result.accessToken, user: result.user });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  const raw = req.cookies?.[config.session.cookieName];
  if (raw) revokeSession(raw);
  clearTokenCookies(res);
  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'auth.logout', ip: req.ip });
  res.json({ ok: true });
});

// GET /api/auth/me — current user info
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    status: u.status,
    tenant_id: u.tenant_id,
    last_login_at: u.last_login_at,
  };
}

export default router;
