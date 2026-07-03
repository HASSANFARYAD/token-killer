import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb, createTestUser } from './helpers.js';

before(() => {
  process.env.RTK_ENCRYPTION_KEY = 'a'.repeat(64);
  setupTestDb();
});
after(() => { teardownTestDb(); });

describe('Analytics daily rollup', () => {
  test('upserts daily record correctly', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    const user = await createTestUser();

    const today = new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO analytics_daily (user_id, date, commands_count, saved_tokens, estimated_cost_usd)
      VALUES (?, ?, 1, 100, 0.0003)
      ON CONFLICT(user_id, date) DO UPDATE SET
        commands_count = commands_count + 1,
        saved_tokens = saved_tokens + excluded.saved_tokens
    `).run(user.id, today);

    db.prepare(`
      INSERT INTO analytics_daily (user_id, date, commands_count, saved_tokens, estimated_cost_usd)
      VALUES (?, ?, 1, 200, 0.0006)
      ON CONFLICT(user_id, date) DO UPDATE SET
        commands_count = commands_count + 1,
        saved_tokens = saved_tokens + excluded.saved_tokens
    `).run(user.id, today);

    const row = db.prepare('SELECT * FROM analytics_daily WHERE user_id = ? AND date = ?').get(user.id, today);
    assert.equal(row.commands_count, 2, 'should have 2 commands after two inserts');
    assert.equal(row.saved_tokens, 300, 'should sum saved_tokens correctly');
  });

  test('unique constraint per user+date', async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    const user = await createTestUser();
    const date = '2025-01-01';

    db.prepare("INSERT INTO analytics_daily (user_id, date, commands_count) VALUES (?, ?, 1)").run(user.id, date);
    assert.throws(
      () => db.prepare("INSERT INTO analytics_daily (user_id, date, commands_count) VALUES (?, ?, 2)").run(user.id, date),
      { message: /UNIQUE constraint failed/ }
    );
  });
});

describe('Crypto service', () => {
  test('encrypts and decrypts correctly', async () => {
    const { encrypt, decrypt } = await import('../../server/services/crypto.js');
    const plaintext = 'my-secret-value-12345';
    const ciphertext = encrypt(plaintext);
    assert.notEqual(ciphertext, plaintext);
    assert.ok(ciphertext.includes(':'), 'format should be iv:tag:data');
    const decrypted = decrypt(ciphertext);
    assert.equal(decrypted, plaintext);
  });

  test('different encryptions of same value produce different ciphertext', async () => {
    const { encrypt } = await import('../../server/services/crypto.js');
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    assert.notEqual(a, b, 'IV randomness should produce different ciphertext each time');
  });

  test('rejects tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('../../server/services/crypto.js');
    const ct = encrypt('original');
    const tampered = ct.slice(0, -4) + 'beef';
    assert.throws(() => decrypt(tampered));
  });
});

describe('Export CSV', () => {
  test('produces valid CSV with header', async () => {
    const { exportCsv } = await import('../../server/services/export.js');
    const rows = [
      { email: 'a@example.com', tokens: 1000 },
      { email: 'b,test@example.com', tokens: 2000 },
    ];
    const csv = exportCsv(rows, ['email', 'tokens']);
    assert.ok(csv.startsWith('email,tokens\n'));
    assert.ok(csv.includes('"b,test@example.com"'), 'should quote values containing commas');
  });

  test('handles empty rows', async () => {
    const { exportCsv } = await import('../../server/services/export.js');
    const csv = exportCsv([], ['a', 'b']);
    assert.equal(csv.trim(), 'a,b');
  });
});
