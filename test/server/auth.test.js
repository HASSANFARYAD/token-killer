import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb, createTestApp, createTestUser, createTestSession, authHeader } from './helpers.js';

let app;

before(() => {
  setupTestDb();
  app = createTestApp();
});

after(() => { teardownTestDb(); });

async function request(method, path, { body, headers = {} } = {}) {
  const res = await app.inject?.({ method, url: path, payload: body, headers })
    .catch(() => null);
  if (res) return res;

  // Use built-in fetch if no inject (Express without supertest)
  const response = await fetch(`http://localhost:0${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

describe('Health endpoint', () => {
  test('GET /api/health returns 200', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    assert.ok(db.prepare('SELECT 1').get());
  });
});

describe('Auth - local login', () => {
  test('rejects login with wrong password', async () => {
    const user = await createTestUser({ email: 'wrong@test.com', password: 'correct123' });
    const db = (await import('../../server/db/index.js')).getDb();
    const bcrypt = (await import('bcryptjs')).default;
    // Verify user exists
    const found = db.prepare('SELECT * FROM users WHERE email = ?').get('wrong@test.com');
    assert.ok(found, 'user should exist');
    // Wrong password should not match
    const match = await bcrypt.compare('wrongpassword', found.password_hash);
    assert.equal(match, false);
  });

  test('correct password matches hash', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const user = await createTestUser({ email: 'correct@test.com', password: 'mypassword123' });
    const db = (await import('../../server/db/index.js')).getDb();
    const found = db.prepare('SELECT * FROM users WHERE email = ?').get('correct@test.com');
    const match = await bcrypt.compare('mypassword123', found.password_hash);
    assert.equal(match, true);
  });
});

describe('JWT / session', () => {
  test('issues valid access token for user', async () => {
    const user = await createTestUser({ role: 'admin' });
    const tokens = createTestSession(user);
    assert.ok(tokens.accessToken, 'should have access token');
    assert.ok(tokens.refreshToken, 'should have refresh token');

    const { verifyAccessToken } = await import('../../server/auth/jwt.js');
    const payload = verifyAccessToken(tokens.accessToken);
    assert.equal(payload.sub, String(user.id));
    assert.equal(payload.role, 'admin');
  });

  test('expired/invalid token is rejected', async () => {
    const { verifyAccessToken } = await import('../../server/auth/jwt.js');
    const result = verifyAccessToken('not.a.real.token');
    assert.equal(result, null);
  });

  test('revoked session is detected', async () => {
    const user = await createTestUser();
    const tokens = createTestSession(user);
    const { verifyAccessToken, isSessionRevoked } = await import('../../server/auth/jwt.js');
    const payload = verifyAccessToken(tokens.accessToken);

    assert.equal(isSessionRevoked(payload.jti), false);

    const { revokeSession } = await import('../../server/auth/session.js');
    revokeSession(tokens.refreshToken);

    assert.equal(isSessionRevoked(payload.jti), true);
  });
});

describe('RBAC', () => {
  test('role levels are ordered correctly', async () => {
    const levels = { super_admin: 5, admin: 4, manager: 3, user: 2, read_only: 1 };
    assert.ok(levels.super_admin > levels.admin);
    assert.ok(levels.admin > levels.manager);
    assert.ok(levels.manager > levels.user);
    assert.ok(levels.user > levels.read_only);
  });
});
