-- Sesshush Enterprise — Triggers
-- Migration 003

-- Auto-update updated_at on users
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Auto-update updated_at on tenants
CREATE TRIGGER IF NOT EXISTS trg_tenants_updated_at
AFTER UPDATE ON tenants
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tenants SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Auto-update updated_at on settings
CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Prevent hard deletes on audit_logs
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'audit_logs rows cannot be deleted');
END;

-- Prevent updates on audit_logs
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'audit_logs rows cannot be modified');
END;
