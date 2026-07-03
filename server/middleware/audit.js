import { getDb } from '../db/index.js';

export function auditLog(action, resourceType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const success = res.statusCode < 400;
      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO audit_logs
            (user_id, tenant_id, action, resource_type, resource_id,
             new_value, ip_address, user_agent, result, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user?.id || null,
          req.user?.tenant_id || null,
          action,
          resourceType || null,
          extractResourceId(req, body),
          success ? JSON.stringify(sanitize(body)) : null,
          req.ip,
          req.headers['user-agent'] || null,
          success ? 'success' : 'failure',
          success ? null : (body?.error || String(body))
        );
      } catch {
        // Never let audit logging break the response
      }
      return originalJson(body);
    };
    next();
  };
}

export function logAudit({ userId, tenantId, action, resourceType, resourceId, oldValue, newValue, ip, userAgent, result = 'success', errorMessage } = {}) {
  try {
    getDb().prepare(`
      INSERT INTO audit_logs
        (user_id, tenant_id, action, resource_type, resource_id,
         old_value, new_value, ip_address, user_agent, result, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId || null,
      tenantId || null,
      action,
      resourceType || null,
      resourceId !== undefined ? String(resourceId) : null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ip || null,
      userAgent || null,
      result,
      errorMessage || null
    );
  } catch {
    // Silently fail — never break the main request
  }
}

function extractResourceId(req, body) {
  return req.params?.id || req.params?.userId || body?.id || null;
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const key of ['password', 'password_hash', 'client_secret', 'api_key', 'token', 'invite_token']) {
    if (key in out) out[key] = '[REDACTED]';
  }
  return out;
}
