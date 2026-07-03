import { createApp } from '../../server/app.js';
import { initDb, closeDb } from '../../server/db/index.js';
import { createSession } from '../../server/auth/session.js';
import { getDb } from '../../server/db/index.js';
import bcrypt from 'bcryptjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let testDbPath;

export function setupTestDb() {
  testDbPath = path.join(os.tmpdir(), `sesshush-server-test-${Date.now()}.db`);
  process.env.RTK_DB_PATH = testDbPath;
  process.env.RTK_JWT_SECRET = 'test-secret-do-not-use-in-production';
  process.env.RTK_ENCRYPTION_KEY = 'a'.repeat(64);
  return initDb(testDbPath);
}

export function teardownTestDb() {
  closeDb();
  try { fs.unlinkSync(testDbPath); } catch { /* */ }
}

export function createTestApp() {
  return createApp();
}

export async function createTestUser(overrides = {}) {
  const db = getDb();
  const hash = overrides.password ? await bcrypt.hash(overrides.password, 4) : null;
  const result = db.prepare(`
    INSERT INTO users (email, display_name, role, status, auth_provider, password_hash, tenant_id)
    VALUES (?, ?, ?, 'active', 'local', ?, ?)
  `).run(
    overrides.email || `test-${Date.now()}@example.com`,
    overrides.display_name || 'Test User',
    overrides.role || 'user',
    hash,
    overrides.tenant_id || null
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

export function createTestSession(user) {
  return createSession(user, { ipAddress: '127.0.0.1', userAgent: 'test' });
}

export function authHeader(tokens) {
  return { Authorization: `Bearer ${tokens.accessToken}` };
}
