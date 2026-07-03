import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireApiKey } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { cliLimiter } from '../middleware/rateLimit.js';

const router = Router();
const COST_PER_1K = 0.003;

// POST /api/cli/report — CLI reports a command execution
router.post('/report', cliLimiter, requireApiKey, validate(schemas.reportCli), (req, res) => {
  const { session_id, session_label, command, args, original_bytes, compressed_bytes,
          original_tokens, compressed_tokens, saved_tokens, duration_ms, exit_code } = req.body;

  const db = getDb();
  const costRate = parseFloat(getSetting(db, 'token_cost_per_1k') || COST_PER_1K);

  db.prepare(`
    INSERT INTO commands
      (user_id, tenant_id, session_label, cli_session_id, command, args,
       original_bytes, compressed_bytes, original_tokens, compressed_tokens, saved_tokens,
       duration_ms, exit_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, req.user.tenant_id, session_label || null, session_id || null,
    command, args || null,
    original_bytes, compressed_bytes, original_tokens, compressed_tokens, saved_tokens,
    duration_ms || null, exit_code ?? null
  );

  // Upsert daily rollup
  const today = new Date().toISOString().slice(0, 10);
  const costUsd = (saved_tokens / 1000) * costRate;
  db.prepare(`
    INSERT INTO analytics_daily (user_id, tenant_id, date, commands_count, sessions_count, original_tokens, compressed_tokens, saved_tokens, estimated_cost_usd)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      commands_count    = commands_count + 1,
      sessions_count    = sessions_count + CASE WHEN excluded.sessions_count > 0 THEN 1 ELSE 0 END,
      original_tokens   = original_tokens   + excluded.original_tokens,
      compressed_tokens = compressed_tokens + excluded.compressed_tokens,
      saved_tokens      = saved_tokens      + excluded.saved_tokens,
      estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd
  `).run(req.user.id, req.user.tenant_id, today, session_id ? 1 : 0, original_tokens, compressed_tokens, saved_tokens, costUsd);

  res.json({ ok: true });
});

// GET /api/cli/status — CLI polls for its own session stats
router.get('/status', cliLimiter, requireApiKey, (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id;

  const sessionStats = sessionId
    ? db.prepare(`
        SELECT COUNT(*) AS runs,
               COALESCE(SUM(original_tokens), 0)   AS originalTokens,
               COALESCE(SUM(compressed_tokens), 0) AS compressedTokens,
               COALESCE(SUM(saved_tokens), 0)      AS savedTokens
        FROM commands WHERE user_id = ? AND cli_session_id = ?
      `).get(req.user.id, sessionId)
    : { runs: 0, originalTokens: 0, compressedTokens: 0, savedTokens: 0 };

  const totalStats = db.prepare(`
    SELECT COALESCE(SUM(commands_count), 0) AS runs,
           COALESCE(SUM(original_tokens), 0)   AS originalTokens,
           COALESCE(SUM(compressed_tokens), 0) AS compressedTokens,
           COALESCE(SUM(saved_tokens), 0)      AS savedTokens
    FROM analytics_daily WHERE user_id = ?
  `).get(req.user.id);

  function pct(saved, original) {
    return original > 0 ? parseFloat(((saved / original) * 100).toFixed(1)) : 0;
  }

  res.json({
    session: {
      runs: sessionStats.runs,
      savedTokens: sessionStats.savedTokens,
      originalTokens: sessionStats.originalTokens,
      compressedTokens: sessionStats.compressedTokens,
      savedPercent: pct(sessionStats.savedTokens, sessionStats.originalTokens),
    },
    total: {
      runs: totalStats.runs,
      savedTokens: totalStats.savedTokens,
      originalTokens: totalStats.originalTokens,
      compressedTokens: totalStats.compressedTokens,
      savedPercent: pct(totalStats.savedTokens, totalStats.originalTokens),
    },
  });
});

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export default router;
