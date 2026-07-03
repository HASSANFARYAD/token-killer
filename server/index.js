import { createApp } from './app.js';
import { initDb, closeDb } from './db/index.js';
import { config } from './config.js';
import { logger } from './middleware/logger.js';
import { cleanExpiredSessions } from './auth/session.js';

const warnings = config.validate();
for (const w of warnings) logger.warn('[config] ' + w);

// Initialize database
initDb(config.dbPath);
logger.info('[db] Database ready', { path: config.dbPath });

// Clean expired sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  logger.info('[server] NoiseGate Enterprise Server started', {
    host: config.host,
    port: config.port,
    env: config.env,
    admin: `http://localhost:${config.port}/admin/dashboard`,
  });
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`[server] Received ${signal}, shutting down`);
  server.close(() => {
    closeDb();
    logger.info('[server] Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('[fatal] Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
