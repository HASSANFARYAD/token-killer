import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

router.get('/', (req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch { /* */ }

  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    version: process.env.npm_package_version || '0.1.0',
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'ok' : 'error',
    ts: new Date().toISOString(),
  });
});

export default router;
