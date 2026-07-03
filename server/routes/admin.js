import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validation.js';
import { logAudit } from '../middleware/audit.js';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth, requireMinRole('admin'));

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const isSuperAdmin = req.user.role === 'super_admin';
  const tenantWhere = isSuperAdmin ? '' : 'AND tenant_id = ' + (req.user.tenant_id || -1);
  const userTenantWhere = isSuperAdmin ? '' : 'AND u.tenant_id = ' + (req.user.tenant_id || -1);

  const users = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
      COUNT(CASE WHEN status = 'disabled' THEN 1 END) AS disabled,
      COUNT(CASE WHEN status = 'invited' THEN 1 END) AS invited
    FROM users WHERE deleted_at IS NULL ${userTenantWhere}
  `).get();

  const tenants = isSuperAdmin
    ? db.prepare("SELECT COUNT(*) AS total, COUNT(CASE WHEN status='connected' THEN 1 END) AS connected FROM tenants").get()
    : { total: 1, connected: req.user.tenant_id ? 1 : 0 };

  const tokenStats = db.prepare(`
    SELECT
      COALESCE(SUM(commands_count), 0)     AS total_commands,
      COALESCE(SUM(sessions_count), 0)     AS total_sessions,
      COALESCE(SUM(saved_tokens), 0)       AS total_saved_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd
    FROM analytics_daily WHERE 1=1 ${tenantWhere}
  `).get();

  const topUsers = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.department,
           COALESCE(SUM(a.saved_tokens), 0) AS saved_tokens,
           COALESCE(SUM(a.commands_count), 0) AS commands_count
    FROM users u
    JOIN analytics_daily a ON a.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND a.date >= date('now', '-30 days')
      ${userTenantWhere}
    GROUP BY u.id
    ORDER BY saved_tokens DESC
    LIMIT 5
  `).all();

  const recentActivity = db.prepare(`
    SELECT a.date, SUM(a.saved_tokens) AS saved_tokens, SUM(a.commands_count) AS commands
    FROM analytics_daily a
    WHERE a.date >= date('now', '-14 days') ${tenantWhere}
    GROUP BY a.date
    ORDER BY a.date ASC
  `).all();

  res.json({
    users,
    tenants,
    tokens: tokenStats,
    top_users: topUsers,
    recent_activity: recentActivity,
  });
});

// GET /api/admin/audit
router.get('/audit', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (req.user.role !== 'super_admin') {
    conditions.push('l.tenant_id = ?');
    params.push(req.user.tenant_id);
  }
  if (req.query.action) { conditions.push('l.action LIKE ?'); params.push(`%${req.query.action}%`); }
  if (req.query.user_id) { conditions.push('l.user_id = ?'); params.push(parseInt(req.query.user_id, 10)); }
  if (req.query.from) { conditions.push("l.created_at >= ?"); params.push(req.query.from); }
  if (req.query.to) { conditions.push("l.created_at <= ?"); params.push(req.query.to + 'T23:59:59'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT l.*, u.email AS user_email, u.display_name AS user_name
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ${where}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_logs l ${where}`).get(...params);
  res.json({ data: rows, total, page, limit });
});

// GET /api/admin/settings
router.get('/settings', requireMinRole('super_admin'), (req, res) => {
  const settings = getDb().prepare(
    "SELECT key, value, description, updated_at FROM settings WHERE key NOT LIKE '%.pass_enc'"
  ).all();
  res.json({ data: settings });
});

// PUT /api/admin/settings/:key
router.put('/settings/:key', requireMinRole('super_admin'), validate(z.object({ value: z.any() })), (req, res) => {
  const { key } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'Setting not found' });

  db.prepare('UPDATE settings SET value = ?, updated_by = ? WHERE key = ?')
    .run(JSON.stringify(req.body.value), req.user.id, key);

  logAudit({ userId: req.user.id, action: 'settings.update', resourceType: 'settings', resourceId: key, oldValue: existing.value, newValue: req.body.value, ip: req.ip });
  res.json({ ok: true });
});

// GET /api/admin/backup — stream SQLite DB file
router.get('/backup', requireMinRole('super_admin'), (req, res) => {
  const dbPath = config.dbPath;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="sesshush-backup-${new Date().toISOString().slice(0, 10)}.db"`);
  createReadStream(dbPath).pipe(res);
});

export default router;
