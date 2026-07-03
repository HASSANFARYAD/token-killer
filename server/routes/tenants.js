import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole, requireSameTenantOrAdmin } from '../middleware/rbac.js';
import { validate, schemas } from '../middleware/validation.js';
import { logAudit } from '../middleware/audit.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { acquireClientCredentialToken } from '../auth/microsoft.js';
import { startSync } from '../services/userSync.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

// GET /api/tenants
router.get('/', requireMinRole('admin'), (req, res) => {
  const db = getDb();
  const isSuperAdmin = req.user.role === 'super_admin';
  const tenants = isSuperAdmin
    ? db.prepare('SELECT * FROM v_tenant_totals').all()
    : db.prepare('SELECT * FROM v_tenant_totals WHERE id = ?').all(req.user.tenant_id);
  res.json({ data: tenants });
});

// GET /api/tenants/:id
router.get('/:id', requireMinRole('admin'), requireSameTenantOrAdmin, (req, res) => {
  const db = getDb();
  const tenant = db.prepare(`
    SELECT t.*, COUNT(DISTINCT u.id) as user_count
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
    WHERE t.id = ?
    GROUP BY t.id
  `).get(parseInt(req.params.id, 10));

  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  // Never expose encrypted secret
  delete tenant.client_secret_enc;
  res.json(tenant);
});

// POST /api/tenants
router.post('/', requireMinRole('super_admin'), validate(schemas.createTenant), async (req, res) => {
  const { name, domain, aad_tenant_id, client_id, client_secret, sync_enabled, sync_schedule } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM tenants WHERE aad_tenant_id = ?').get(aad_tenant_id);
  if (existing) return res.status(409).json({ error: 'A tenant with this Azure AD Tenant ID already exists' });

  let secretEnc = null;
  if (client_secret) {
    secretEnc = encrypt(client_secret);
  }

  const result = db.prepare(`
    INSERT INTO tenants (name, domain, aad_tenant_id, client_id, client_secret_enc, sync_enabled, sync_schedule, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(name, domain || null, aad_tenant_id, client_id, secretEnc, sync_enabled ? 1 : 0, sync_schedule, req.user.id);

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(result.lastInsertRowid);
  delete tenant.client_secret_enc;
  logAudit({ userId: req.user.id, action: 'tenant.create', resourceType: 'tenant', resourceId: tenant.id, newValue: { name, domain, aad_tenant_id }, ip: req.ip });
  res.status(201).json(tenant);
});

// PUT /api/tenants/:id
router.put('/:id', requireMinRole('super_admin'), validate(z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).optional(),
  client_id: z.string().uuid().optional(),
  client_secret: z.string().min(1).max(512).optional(),
  sync_enabled: z.boolean().optional(),
  sync_schedule: z.string().max(64).optional(),
})), async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.domain !== undefined) updates.domain = req.body.domain;
  if (req.body.client_id !== undefined) updates.client_id = req.body.client_id;
  if (req.body.client_secret !== undefined) updates.client_secret_enc = encrypt(req.body.client_secret);
  if (req.body.sync_enabled !== undefined) updates.sync_enabled = req.body.sync_enabled ? 1 : 0;
  if (req.body.sync_schedule !== undefined) updates.sync_schedule = req.body.sync_schedule;

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tenants SET ${fields} WHERE id = ?`).run(...Object.values(updates), tenantId);

  logAudit({ userId: req.user.id, action: 'tenant.update', resourceType: 'tenant', resourceId: tenantId, ip: req.ip });
  const updated = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  delete updated.client_secret_enc;
  res.json(updated);
});

// DELETE /api/tenants/:id
router.delete('/:id', requireMinRole('super_admin'), (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);
  logAudit({ userId: req.user.id, action: 'tenant.delete', resourceType: 'tenant', resourceId: tenantId, oldValue: { name: tenant.name }, ip: req.ip });
  res.json({ ok: true });
});

// POST /api/tenants/:id/validate — test tenant credentials
router.post('/:id/validate', requireMinRole('admin'), async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (!tenant.client_secret_enc) return res.status(400).json({ error: 'No client secret configured' });

  try {
    const secret = decrypt(tenant.client_secret_enc);
    await acquireClientCredentialToken(tenant.aad_tenant_id, tenant.client_id, secret);

    db.prepare("UPDATE tenants SET status = 'connected', error_message = NULL WHERE id = ?").run(tenantId);
    logAudit({ userId: req.user.id, action: 'tenant.validate', resourceType: 'tenant', resourceId: tenantId, result: 'success', ip: req.ip });
    res.json({ ok: true, status: 'connected' });
  } catch (err) {
    const msg = err.message || 'Validation failed';
    db.prepare("UPDATE tenants SET status = 'error', error_message = ? WHERE id = ?").run(msg, tenantId);
    logAudit({ userId: req.user.id, action: 'tenant.validate', resourceType: 'tenant', resourceId: tenantId, result: 'failure', errorMessage: msg, ip: req.ip });
    res.status(400).json({ ok: false, error: msg });
  }
});

// POST /api/tenants/:id/sync — trigger user sync
router.post('/:id/sync', requireMinRole('admin'), async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (tenant.status !== 'connected') return res.status(400).json({ error: 'Tenant is not connected. Validate credentials first.' });

  const type = req.body?.type === 'full' ? 'full' : 'incremental';
  const jobResult = db.prepare(`
    INSERT INTO sync_jobs (tenant_id, triggered_by, type) VALUES (?, ?, ?)
  `).run(tenantId, req.user.id, type);

  const jobId = jobResult.lastInsertRowid;
  logAudit({ userId: req.user.id, action: 'tenant.sync_triggered', resourceType: 'tenant', resourceId: tenantId, newValue: { type }, ip: req.ip });

  // Run sync in background (non-blocking)
  startSync(tenantId, jobId, type).catch((err) => {
    db.prepare("UPDATE sync_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?").run(err.message, jobId);
  });

  res.json({ ok: true, job_id: jobId, type });
});

// GET /api/tenants/:id/sync/status
router.get('/:id/sync/status', requireMinRole('admin'), (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const jobs = getDb().prepare(`
    SELECT j.*, u.email AS triggered_by_email
    FROM sync_jobs j
    LEFT JOIN users u ON u.id = j.triggered_by
    WHERE j.tenant_id = ?
    ORDER BY j.started_at DESC
    LIMIT 10
  `).all(tenantId);
  res.json({ data: jobs });
});

export default router;
