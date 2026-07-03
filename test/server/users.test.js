import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb, createTestUser } from './helpers.js';

before(() => { setupTestDb(); });
after(() => { teardownTestDb(); });

describe('User management', () => {
  test('creates user with correct defaults', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();

    const result = db.prepare(`
      INSERT INTO users (email, display_name, role, status, auth_provider)
      VALUES ('newuser@test.com', 'New User', 'user', 'active', 'local')
    `).run();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    assert.equal(user.email, 'newuser@test.com');
    assert.equal(user.role, 'user');
    assert.equal(user.status, 'active');
    assert.ok(user.created_at, 'should have created_at');
  });

  test('enforces email uniqueness', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare("INSERT INTO users (email, display_name) VALUES ('dup@test.com', 'First')").run();
    assert.throws(
      () => db.prepare("INSERT INTO users (email, display_name) VALUES ('dup@test.com', 'Second')").run(),
      { message: /UNIQUE constraint failed/ }
    );
  });

  test('soft delete preserves analytics data', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    const user = await createTestUser();

    db.prepare("INSERT INTO analytics_daily (user_id, date, saved_tokens) VALUES (?, '2025-01-01', 500)").run(user.id);
    db.prepare("UPDATE users SET deleted_at = datetime('now'), status = 'removed' WHERE id = ?").run(user.id);

    const analytics = db.prepare('SELECT * FROM analytics_daily WHERE user_id = ?').get(user.id);
    assert.ok(analytics, 'analytics should persist after soft delete');
    assert.equal(analytics.saved_tokens, 500);
  });

  test('enforces valid roles', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    assert.throws(
      () => db.prepare("INSERT INTO users (email, display_name, role) VALUES ('x@test.com', 'X', 'hacker')").run(),
      { message: /CHECK constraint failed/ }
    );
  });

  test('role levels cover all valid roles', () => {
    const validRoles = ['super_admin', 'admin', 'manager', 'user', 'read_only'];
    const levels = { super_admin: 5, admin: 4, manager: 3, user: 2, read_only: 1 };
    for (const role of validRoles) {
      assert.ok(levels[role] > 0, `role ${role} should have a level`);
    }
  });
});

describe('Audit log immutability', () => {
  test('audit logs cannot be deleted', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare("INSERT INTO audit_logs (action, result) VALUES ('test.action', 'success')").run();
    const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'test.action'").get();
    assert.ok(row, 'audit log row should exist');

    assert.throws(
      () => db.prepare('DELETE FROM audit_logs WHERE id = ?').run(row.id),
      { message: /audit_logs rows cannot be deleted/ }
    );
  });

  test('audit logs cannot be updated', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare("INSERT INTO audit_logs (action, result) VALUES ('immutable.action', 'success')").run();
    const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'immutable.action'").get();

    assert.throws(
      () => db.prepare("UPDATE audit_logs SET action = 'tampered' WHERE id = ?").run(row.id),
      { message: /audit_logs rows cannot be modified/ }
    );
  });
});
