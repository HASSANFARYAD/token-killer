import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole, scopeToTenant } from '../middleware/rbac.js';
import { validateQuery, schemas } from '../middleware/validation.js';
import { exportCsv } from '../services/export.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

const analyticsQuery = schemas.dateRange.extend({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  tenant_id: z.coerce.number().int().positive().optional(),
});

function tenantClause(req) {
  if (req.tenantFilter === null) return { clause: '', params: [] };
  return { clause: 'AND a.tenant_id = ?', params: [req.tenantFilter] };
}

// GET /api/analytics/overview
router.get('/overview', requireMinRole('manager'), scopeToTenant, validateQuery(analyticsQuery), (req, res) => {
  const { from, to } = req.query;
  const db = getDb();
  const { clause, params } = tenantClause(req);

  const where = [
    from ? `a.date >= '${from}'` : null,
    to ? `a.date <= '${to}'` : null,
    clause || null,
  ].filter(Boolean).join(' AND ');

  const fullWhere = where ? `WHERE ${where}` : '';

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT a.user_id)          AS active_users,
      COALESCE(SUM(a.commands_count), 0) AS total_commands,
      COALESCE(SUM(a.sessions_count), 0) AS total_sessions,
      COALESCE(SUM(a.original_tokens), 0)   AS original_tokens,
      COALESCE(SUM(a.saved_tokens), 0)      AS saved_tokens,
      COALESCE(SUM(a.estimated_cost_usd), 0) AS cost_usd
    FROM analytics_daily a
    ${fullWhere}
  `).get(...params);

  const userCount = db.prepare(`SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL${req.tenantFilter !== null ? ' AND tenant_id = ?' : ''}`).get(...(req.tenantFilter !== null ? [req.tenantFilter] : []));

  res.json({ ...totals, total_users: userCount.n });
});

// GET /api/analytics/trends
router.get('/trends', requireMinRole('manager'), scopeToTenant, validateQuery(analyticsQuery), (req, res) => {
  const { from, to, granularity } = req.query;
  const db = getDb();
  const { clause, params } = tenantClause(req);

  const groupFormat = granularity === 'month'
    ? "strftime('%Y-%m', a.date)"
    : granularity === 'week'
    ? "strftime('%Y-W%W', a.date)"
    : 'a.date';

  const conditions = [
    from ? `a.date >= '${from}'` : null,
    to ? `a.date <= '${to}'` : null,
    clause || null,
  ].filter(Boolean);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      ${groupFormat} AS period,
      COALESCE(SUM(a.commands_count), 0)     AS commands,
      COALESCE(SUM(a.saved_tokens), 0)       AS saved_tokens,
      COALESCE(SUM(a.estimated_cost_usd), 0) AS cost_usd,
      COUNT(DISTINCT a.user_id)              AS active_users
    FROM analytics_daily a
    ${where}
    GROUP BY ${groupFormat}
    ORDER BY period ASC
  `).all(...params);

  res.json({ data: rows, granularity });
});

// GET /api/analytics/users
router.get('/users', requireMinRole('manager'), scopeToTenant, validateQuery(
  analyticsQuery.extend({ sort: z.enum(['saved_tokens', 'commands_count', 'cost_usd']).default('saved_tokens') }).merge(schemas.pagination)
), (req, res) => {
  const { from, to, page, limit, sort } = req.query;
  const db = getDb();
  const offset = (page - 1) * limit;
  const { clause, params } = tenantClause(req);

  const conditions = [
    from ? `a.date >= '${from}'` : null,
    to ? `a.date <= '${to}'` : null,
    clause || null,
  ].filter(Boolean);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      u.id, u.email, u.display_name, u.department, u.role, u.tenant_id,
      COALESCE(SUM(a.commands_count), 0)     AS commands_count,
      COALESCE(SUM(a.sessions_count), 0)     AS sessions_count,
      COALESCE(SUM(a.saved_tokens), 0)       AS saved_tokens,
      COALESCE(SUM(a.estimated_cost_usd), 0) AS cost_usd
    FROM users u
    LEFT JOIN analytics_daily a ON a.user_id = u.id
    ${where ? where.replace('a.tenant_id', 'u.tenant_id') : ''}
    WHERE u.deleted_at IS NULL
    GROUP BY u.id
    ORDER BY ${sort} DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: rows });
});

// GET /api/analytics/users/:id
router.get('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, email, display_name, department, role FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const daily = db.prepare(`
    SELECT date, commands_count, sessions_count, saved_tokens, estimated_cost_usd
    FROM analytics_daily
    WHERE user_id = ? AND date >= date('now', '-90 days')
    ORDER BY date ASC
  `).all(userId);

  const totals = db.prepare(`
    SELECT COALESCE(SUM(commands_count), 0) AS total_commands,
           COALESCE(SUM(sessions_count), 0) AS total_sessions,
           COALESCE(SUM(saved_tokens), 0) AS total_saved_tokens,
           COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
           MIN(date) AS first_active, MAX(date) AS last_active
    FROM analytics_daily WHERE user_id = ?
  `).get(userId);

  const byCommand = db.prepare(`
    SELECT command, COUNT(*) as runs, SUM(saved_tokens) as saved_tokens
    FROM commands WHERE user_id = ?
    GROUP BY command ORDER BY saved_tokens DESC LIMIT 10
  `).all(userId);

  res.json({ user, daily, totals, by_command: byCommand });
});

// GET /api/analytics/teams
router.get('/teams', requireMinRole('manager'), scopeToTenant, validateQuery(analyticsQuery), (req, res) => {
  const { from, to } = req.query;
  const db = getDb();
  const { clause, params } = tenantClause(req);

  const conditions = [
    'u.department IS NOT NULL',
    from ? `a.date >= '${from}'` : null,
    to ? `a.date <= '${to}'` : null,
    clause || null,
  ].filter(Boolean);
  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT
      u.department,
      COUNT(DISTINCT u.id)                   AS user_count,
      COALESCE(SUM(a.commands_count), 0)     AS commands_count,
      COALESCE(SUM(a.saved_tokens), 0)       AS saved_tokens,
      COALESCE(SUM(a.estimated_cost_usd), 0) AS cost_usd
    FROM users u
    LEFT JOIN analytics_daily a ON a.user_id = u.id
    ${where}
    GROUP BY u.department
    ORDER BY saved_tokens DESC
  `).all(...params);

  res.json({ data: rows });
});

// GET /api/analytics/commands
router.get('/commands', requireMinRole('manager'), scopeToTenant, (req, res) => {
  const db = getDb();
  const tenantWhere = req.tenantFilter !== null ? 'WHERE tenant_id = ?' : '';
  const params = req.tenantFilter !== null ? [req.tenantFilter] : [];

  const rows = db.prepare(`
    SELECT command,
           COUNT(*) AS total_runs,
           SUM(saved_tokens) AS total_saved,
           AVG(saved_tokens) AS avg_saved,
           AVG(duration_ms)  AS avg_duration_ms
    FROM commands
    ${tenantWhere}
    GROUP BY command
    ORDER BY total_saved DESC
  `).all(...params);

  res.json({ data: rows });
});

// GET /api/analytics/export
router.get('/export', requireMinRole('admin'), scopeToTenant, validateQuery(
  analyticsQuery.extend({ format: z.enum(['csv']).default('csv') })
), async (req, res) => {
  const { from, to, format } = req.query;
  const db = getDb();
  const { clause, params } = tenantClause(req);

  const conditions = [from ? `a.date >= '${from}'` : null, to ? `a.date <= '${to}'` : null, clause].filter(Boolean);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT u.email, u.display_name, u.department, u.role,
           a.date, a.commands_count, a.sessions_count, a.saved_tokens, a.estimated_cost_usd
    FROM analytics_daily a
    JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.date DESC, u.email ASC
  `).all(...params);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sesshush-analytics-${Date.now()}.csv"`);
  res.send(exportCsv(rows, ['email', 'display_name', 'department', 'role', 'date', 'commands_count', 'sessions_count', 'saved_tokens', 'estimated_cost_usd']));
});

export default router;
