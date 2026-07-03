import { config } from '../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.logLevel] ?? 2;

function log(level, message, meta = {}) {
  if ((LEVELS[level] ?? 99) > currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  if (level === 'error') {
    process.stderr.write(JSON.stringify(entry) + '\n');
  } else {
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

export const logger = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    logger.info('http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: req.ip,
    });
  });
  next();
}
