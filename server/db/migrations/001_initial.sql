-- NoiseGate Enterprise — Initial Schema
-- Migration 001

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Tenants: Microsoft Entra ID organizations
CREATE TABLE IF NOT EXISTS tenants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  domain            TEXT,
  aad_tenant_id     TEXT    UNIQUE NOT NULL,
  client_id         TEXT,
  client_secret_enc TEXT,
  sync_enabled      INTEGER DEFAULT 1,
  sync_schedule     TEXT    DEFAULT '0 2 * * *',
  delta_token       TEXT,
  last_sync_at      TEXT,
  last_sync_status  TEXT,
  last_sync_count   INTEGER,
  status            TEXT    DEFAULT 'pending',
  error_message     TEXT,
  created_at        TEXT    DEFAULT (datetime('now')),
  updated_at        TEXT    DEFAULT (datetime('now')),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_aad_id ON tenants(aad_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name      TEXT    NOT NULL,
  given_name        TEXT,
  surname           TEXT,
  department        TEXT,
  job_title         TEXT,
  role              TEXT    NOT NULL DEFAULT 'user'
                      CHECK(role IN ('super_admin','admin','manager','user','read_only')),
  status            TEXT    NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active','disabled','invited','pending','removed')),
  auth_provider     TEXT    NOT NULL DEFAULT 'local'
                      CHECK(auth_provider IN ('local','microsoft')),
  microsoft_id      TEXT    UNIQUE,
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  password_hash     TEXT,
  invite_token      TEXT,
  invite_expires_at TEXT,
  api_key_hash      TEXT,
  last_login_at     TEXT,
  last_login_ip     TEXT,
  created_at        TEXT    DEFAULT (datetime('now')),
  updated_at        TEXT    DEFAULT (datetime('now')),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id  ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_ms_id      ON users(microsoft_id) WHERE microsoft_id IS NOT NULL;

-- Sessions: active login sessions
CREATE TABLE IF NOT EXISTS sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT    NOT NULL UNIQUE,
  access_token_jti  TEXT    NOT NULL UNIQUE,
  ip_address        TEXT,
  user_agent        TEXT,
  expires_at        TEXT    NOT NULL,
  last_used_at      TEXT    DEFAULT (datetime('now')),
  created_at        TEXT    DEFAULT (datetime('now')),
  revoked_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Commands: CLI-reported command executions
CREATE TABLE IF NOT EXISTS commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  session_label     TEXT,
  cli_session_id    TEXT,
  command           TEXT    NOT NULL,
  args              TEXT,
  original_bytes    INTEGER,
  compressed_bytes  INTEGER,
  original_tokens   INTEGER,
  compressed_tokens INTEGER,
  saved_tokens      INTEGER,
  duration_ms       REAL,
  exit_code         INTEGER,
  reported_at       TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commands_user_id      ON commands(user_id);
CREATE INDEX IF NOT EXISTS idx_commands_tenant_id    ON commands(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commands_command      ON commands(command);
CREATE INDEX IF NOT EXISTS idx_commands_reported_at  ON commands(reported_at);
CREATE INDEX IF NOT EXISTS idx_commands_session_id   ON commands(cli_session_id);

-- Analytics daily rollup
CREATE TABLE IF NOT EXISTS analytics_daily (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  date              TEXT    NOT NULL,
  commands_count    INTEGER DEFAULT 0,
  sessions_count    INTEGER DEFAULT 0,
  original_tokens   INTEGER DEFAULT 0,
  compressed_tokens INTEGER DEFAULT 0,
  saved_tokens      INTEGER DEFAULT 0,
  estimated_cost_usd REAL   DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_user_id   ON analytics_daily(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_tenant_id ON analytics_daily(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date      ON analytics_daily(date);

-- Audit logs (append-only)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  action        TEXT    NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  old_value     TEXT,
  new_value     TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  result        TEXT    DEFAULT 'success',
  error_message TEXT,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_id  ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

-- Sync jobs: history of Graph sync runs
CREATE TABLE IF NOT EXISTS sync_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type           TEXT    NOT NULL CHECK(type IN ('full','incremental')),
  status         TEXT    NOT NULL DEFAULT 'running'
                   CHECK(status IN ('running','success','partial','failed')),
  users_fetched  INTEGER DEFAULT 0,
  users_created  INTEGER DEFAULT 0,
  users_updated  INTEGER DEFAULT 0,
  users_disabled INTEGER DEFAULT 0,
  users_removed  INTEGER DEFAULT 0,
  error_message  TEXT,
  started_at     TEXT    DEFAULT (datetime('now')),
  completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_tenant_id  ON sync_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status     ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_started_at ON sync_jobs(started_at);

-- Settings: runtime key-value configuration
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  value       TEXT,
  description TEXT,
  updated_at  TEXT    DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('token_cost_per_1k',    '"0.003"',   'USD cost per 1000 tokens saved (for cost estimation)'),
  ('session_timeout_min',  '"480"',     'API session timeout in minutes (default 8 hours)'),
  ('data_retention_days',  '"365"',     'Days to retain raw command history'),
  ('smtp.host',            '""',        'SMTP server hostname'),
  ('smtp.port',            '"587"',     'SMTP server port'),
  ('smtp.user',            '""',        'SMTP username'),
  ('smtp.pass_enc',        '""',        'AES-256-GCM encrypted SMTP password'),
  ('smtp.from',            '""',        'From address for invite emails'),
  ('invite_expiry_hours',  '"72"',      'Invite link validity in hours'),
  ('registration_open',    '"false"',   'Allow self-registration (false = invite-only)');
