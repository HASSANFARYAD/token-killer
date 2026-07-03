import { getDb } from '../db/index.js';
import { fetchAllUsers, fetchDeltaUsers, normalizeGraphUser } from './graph.js';
import { logger } from '../middleware/logger.js';

export async function startSync(tenantId, jobId, type = 'incremental') {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error('Tenant not found');

  const stats = { fetched: 0, created: 0, updated: 0, disabled: 0, removed: 0 };

  try {
    let graphUsers;
    let newDeltaToken = null;

    if (type === 'full' || !tenant.delta_token) {
      graphUsers = await fetchAllUsers(tenant);
    } else {
      const result = await fetchDeltaUsers(tenant, tenant.delta_token);
      graphUsers = result.users;
      newDeltaToken = result.deltaToken;
    }

    stats.fetched = graphUsers.length;
    logger.info('[sync] fetched graph users', { tenantId, count: stats.fetched, type });

    const { withTransaction } = await import('../db/index.js');
    const syncUsers = () => withTransaction(() => {
      if (type === 'full') {
        // Mark all existing synced users as candidates for removal check
        db.prepare("UPDATE users SET status = 'removed' WHERE tenant_id = ? AND auth_provider = 'microsoft'").run(tenantId);
      }

      for (const rawUser of graphUsers) {
        const u = normalizeGraphUser(rawUser);
        if (!u.email) continue;

        // Check for removal (Graph delta returns @removed annotation)
        if (rawUser['@removed']) {
          db.prepare("UPDATE users SET status = 'removed' WHERE microsoft_id = ? AND tenant_id = ?").run(u.microsoft_id, tenantId);
          stats.removed++;
          continue;
        }

        const existing = db.prepare(
          'SELECT * FROM users WHERE (microsoft_id = ? OR (email = ? COLLATE NOCASE)) AND tenant_id = ?'
        ).get(u.microsoft_id, u.email, tenantId);

        if (existing) {
          const newStatus = !u.account_enabled ? 'disabled' : (existing.status === 'removed' ? 'active' : existing.status);
          db.prepare(`
            UPDATE users SET display_name = ?, given_name = ?, surname = ?, department = ?,
              job_title = ?, microsoft_id = ?, status = ?, email = ?
            WHERE id = ?
          `).run(u.display_name, u.given_name, u.surname, u.department, u.job_title, u.microsoft_id, newStatus, u.email, existing.id);

          if (!u.account_enabled && existing.status === 'active') stats.disabled++;
          else stats.updated++;
        } else {
          db.prepare(`
            INSERT INTO users (email, display_name, given_name, surname, department, job_title,
              microsoft_id, auth_provider, tenant_id, role, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'microsoft', ?, 'user', ?)
          `).run(u.email, u.display_name, u.given_name, u.surname, u.department, u.job_title,
                 u.microsoft_id, tenantId, u.account_enabled ? 'active' : 'disabled');
          stats.created++;
        }
      }
    });

    syncUsers();


    // Update tenant delta token and sync metadata
    db.prepare(`
      UPDATE tenants SET delta_token = ?, last_sync_at = datetime('now'), last_sync_status = 'success',
        last_sync_count = ?, status = 'connected', error_message = NULL
      WHERE id = ?
    `).run(newDeltaToken || tenant.delta_token, stats.fetched, tenantId);

    db.prepare(`
      UPDATE sync_jobs SET status = 'success', users_fetched = ?, users_created = ?,
        users_updated = ?, users_disabled = ?, users_removed = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(stats.fetched, stats.created, stats.updated, stats.disabled, stats.removed, jobId);

    logger.info('[sync] complete', { tenantId, jobId, ...stats });
    return stats;
  } catch (err) {
    db.prepare(`
      UPDATE sync_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?
    `).run(err.message, jobId);
    db.prepare("UPDATE tenants SET last_sync_status = 'failed', error_message = ? WHERE id = ?").run(err.message, tenantId);
    throw err;
  }
}
