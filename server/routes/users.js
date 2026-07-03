import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole, requireSelfOrAdmin, scopeToTenant } from '../middleware/rbac.js';
import { validate, validateQuery, schemas } from '../middleware/validation.js';
import { logAudit } from '../middleware/audit.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

// GET /api/users
router.get('/', requireMinRole('admin'), scopeToTenant, validateQuery(
  schemas.pagination.merge(schemas.dateRange).extend({
    search: z.string().max(100).optional(),
    role: z.enum(['super_admin', 'admin', 'manager', 'user', 'read_only']).optional(),
    status: z.enum(['active', 'disabled', 'invited', 'pending', 'removed']).optional(),
    tenant_id: z.coerce.number().int().positive().optional(),
    sort: z.enum(['email', 'display_name', 'role', 'status', 'created_at', 'last_login_at', 'total_saved_tokens']).default('display_name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
  })
), (req, res) => {
  const { page, limit, search, role, status, tenant_id, sort, dir } = req.query;
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = ['u.deleted_at IS NULL'];
  const params = [];

  if (req.tenantFilter !== null) {
    conditions.push('u.tenant_id = ?');
    params.push(req.tenantFilter);
  } else if (tenant_id) {
    conditions.push('u.tenant_id = ?');
    params.push(tenant_id);
  }
  if (search) {
    conditions.push('(u.email LIKE ? OR u.display_name LIKE ? OR u.department LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (role) { conditions.push('u.role = ?'); params.push(role); }
  if (status) { conditions.push('u.status = ?'); params.push(status); }

  const where = conditions.join(' AND ');

  // Allow sorting on aggregated column
  const sortClause = sort === 'total_saved_tokens'
    ? `COALESCE(SUM(a.saved_tokens), 0) ${dir.toUpperCase()}`
    : `u.${sort} ${dir.toUpperCase()}`;

  const rows = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.given_name, u.surname, u.department, u.job_title,
           u.role, u.status, u.auth_provider, u.tenant_id, u.last_login_at, u.created_at,
           COALESCE(SUM(a.saved_tokens), 0)   AS total_saved_tokens,
           COALESCE(SUM(a.commands_count), 0) AS total_commands
    FROM users u
    LEFT JOIN analytics_daily a ON a.user_id = u.id
    WHERE ${where}
    GROUP BY u.id
    ORDER BY ${sortClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM users u WHERE ${where}`).get(...params);

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// GET /api/users/:id
router.get('/:id', requireSelfOrAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.given_name, u.surname, u.department, u.job_title,
           u.role, u.status, u.auth_provider, u.microsoft_id, u.tenant_id,
           u.last_login_at, u.last_login_ip, u.created_at, u.updated_at,
           t.name AS tenant_name
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = ? AND u.deleted_at IS NULL
  `).get(parseInt(req.params.id, 10));

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/users — create user
router.post('/', requireMinRole('admin'), validate(schemas.createUser), async (req, res) => {
  const db = getDb();
  const { email, display_name, given_name, surname, department, job_title, role, tenant_id, send_invite } = req.body;

  // Enforce tenant scoping
  if (req.user.role !== 'super_admin' && tenant_id && tenant_id !== req.user.tenant_id) {
    return res.status(403).json({ error: 'Cannot create user in another tenant' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const inviteHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
  const inviteExpires = new Date();
  inviteExpires.setHours(inviteExpires.getHours() + 72);

  const result = db.prepare(`
    INSERT INTO users (email, display_name, given_name, surname, department, job_title, role, status,
                       auth_provider, tenant_id, invite_token, invite_expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'invited', 'local', ?, ?, ?, ?)
  `).run(email, display_name, given_name || null, surname || null, department || null, job_title || null,
         role, tenant_id || req.user.tenant_id || null, inviteHash,
         inviteExpires.toISOString(), req.user.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'user.create', resourceType: 'user', resourceId: user.id, newValue: { email, role }, ip: req.ip });

  res.status(201).json({
    user: publicUser(user),
    inviteLink: send_invite ? `${process.env.NOISEGATE_BASE_URL || process.env.RTK_BASE_URL || 'http://localhost:3000'}/admin/accept-invite?token=${inviteToken}` : undefined,
  });
});

// PUT /api/users/:id
router.put('/:id', requireSelfOrAdmin, validate(schemas.updateUser), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Managers cannot change roles of admins/super_admins
  if (!['super_admin', 'admin'].includes(req.user.role) && req.body.role) {
    return res.status(403).json({ error: 'Insufficient permissions to change roles' });
  }

  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'user.update', resourceType: 'user', resourceId: userId, oldValue: publicUser(user), newValue: req.body, ip: req.ip });
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', requireMinRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare("UPDATE users SET deleted_at = datetime('now'), status = 'removed' WHERE id = ?").run(userId);
  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'user.delete', resourceType: 'user', resourceId: userId, oldValue: { email: user.email }, ip: req.ip });
  res.json({ ok: true });
});

// POST /api/users/:id/deactivate
router.post('/:id/deactivate', requireMinRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });

  const db = getDb();
  db.prepare("UPDATE users SET status = 'disabled' WHERE id = ? AND deleted_at IS NULL").run(userId);
  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'user.deactivate', resourceType: 'user', resourceId: userId, ip: req.ip });
  res.json({ ok: true });
});

// POST /api/users/:id/activate
router.post('/:id/activate', requireMinRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const db = getDb();
  db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND deleted_at IS NULL").run(userId);
  logAudit({ userId: req.user.id, tenantId: req.user.tenant_id, action: 'user.activate', resourceType: 'user', resourceId: userId, ip: req.ip });
  res.json({ ok: true });
});

// POST /api/users/:id/regenerate-api-key
router.post('/:id/regenerate-api-key', requireSelfOrAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const rawKey = `rtkk_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  getDb().prepare('UPDATE users SET api_key_hash = ? WHERE id = ?').run(keyHash, userId);
  logAudit({ userId: req.user.id, action: 'user.api_key_regenerated', resourceType: 'user', resourceId: userId, ip: req.ip });
  res.json({ api_key: rawKey });
});

// POST /api/auth/accept-invite — set password on invite
router.post('/accept-invite', validate(z.object({
  token: z.string().min(64).max(64),
  password: schemas.password,
})), async (req, res) => {
  const { token, password } = req.body;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const db = getDb();
  const user = db.prepare(
    "SELECT * FROM users WHERE invite_token = ? AND invite_expires_at > datetime('now') AND status = 'invited'"
  ).get(tokenHash);

  if (!user) return res.status(400).json({ error: 'Invalid or expired invite link' });

  const hash = await bcrypt.hash(password, 12);
  db.prepare("UPDATE users SET password_hash = ?, status = 'active', invite_token = NULL, invite_expires_at = NULL WHERE id = ?").run(hash, user.id);

  res.json({ ok: true, message: 'Password set. You can now log in.' });
});

function publicUser(u) {
  return {
    id: u.id, email: u.email, display_name: u.display_name, given_name: u.given_name,
    surname: u.surname, department: u.department, job_title: u.job_title,
    role: u.role, status: u.status, auth_provider: u.auth_provider,
    tenant_id: u.tenant_id, last_login_at: u.last_login_at, created_at: u.created_at,
  };
}

export default router;
