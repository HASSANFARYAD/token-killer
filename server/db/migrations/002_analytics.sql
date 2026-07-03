-- NoiseGate Enterprise — Analytics Views
-- Migration 002

-- Aggregated view: per-user totals across all time
CREATE VIEW IF NOT EXISTS v_user_totals AS
SELECT
  u.id,
  u.email,
  u.display_name,
  u.given_name,
  u.surname,
  u.department,
  u.job_title,
  u.role,
  u.status,
  u.auth_provider,
  u.tenant_id,
  u.last_login_at,
  u.created_at,
  COALESCE(SUM(a.commands_count), 0)    AS total_commands,
  COALESCE(SUM(a.sessions_count), 0)    AS total_sessions,
  COALESCE(SUM(a.original_tokens), 0)   AS total_original_tokens,
  COALESCE(SUM(a.compressed_tokens), 0) AS total_compressed_tokens,
  COALESCE(SUM(a.saved_tokens), 0)      AS total_saved_tokens,
  COALESCE(SUM(a.estimated_cost_usd), 0) AS total_cost_usd,
  MAX(a.date)                            AS last_active_date
FROM users u
LEFT JOIN analytics_daily a ON a.user_id = u.id
WHERE u.deleted_at IS NULL
GROUP BY u.id;

-- Aggregated view: per-tenant totals
CREATE VIEW IF NOT EXISTS v_tenant_totals AS
SELECT
  t.id,
  t.name,
  t.domain,
  t.status,
  t.last_sync_at,
  t.last_sync_status,
  COUNT(DISTINCT CASE WHEN u.status = 'active'   THEN u.id END) AS active_users,
  COUNT(DISTINCT CASE WHEN u.status = 'disabled' THEN u.id END) AS disabled_users,
  COUNT(DISTINCT u.id)                                           AS total_users,
  COALESCE(SUM(a.commands_count), 0)     AS total_commands,
  COALESCE(SUM(a.saved_tokens), 0)       AS total_saved_tokens,
  COALESCE(SUM(a.estimated_cost_usd), 0) AS total_cost_usd
FROM tenants t
LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
LEFT JOIN analytics_daily a ON a.tenant_id = t.id
GROUP BY t.id;

-- Top users by saved tokens (last 30 days)
CREATE VIEW IF NOT EXISTS v_top_users_30d AS
SELECT
  u.id,
  u.email,
  u.display_name,
  u.department,
  u.tenant_id,
  COALESCE(SUM(a.saved_tokens), 0)       AS saved_tokens,
  COALESCE(SUM(a.commands_count), 0)     AS commands_count,
  COALESCE(SUM(a.estimated_cost_usd), 0) AS cost_usd
FROM users u
JOIN analytics_daily a ON a.user_id = u.id
WHERE a.date >= date('now', '-30 days')
  AND u.deleted_at IS NULL
GROUP BY u.id
ORDER BY saved_tokens DESC;
