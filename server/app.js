import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestLogger } from './middleware/logger.js';
import { defaultLimiter } from './middleware/rateLimit.js';
import { config } from './config.js';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import tenantsRouter from './routes/tenants.js';
import analyticsRouter from './routes/analytics.js';
import adminRouter from './routes/admin.js';
import cliRouter from './routes/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Trust proxy for correct IP in rate limiting / logs
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.tailwindcss.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'cdn.jsdelivr.net'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(defaultLimiter);

  // Serve admin portal static files
  app.use('/admin', express.static(path.join(__dirname, 'portal'), {
    index: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Portal HTML routes — serve the right page for each URL
  const portalPages = {
    '/admin': 'index.html',
    '/admin/': 'index.html',
    '/admin/login': 'login.html',
    '/admin/dashboard': 'dashboard.html',
    '/admin/users': 'users.html',
    '/admin/users/:id': 'user-detail.html',
    '/admin/tenants': 'tenants.html',
    '/admin/analytics': 'analytics.html',
    '/admin/audit': 'audit.html',
    '/admin/settings': 'settings.html',
    '/admin/accept-invite': 'accept-invite.html',
  };

  for (const [route, file] of Object.entries(portalPages)) {
    app.get(route, (req, res) => {
      res.sendFile(path.join(__dirname, 'portal', file));
    });
  }

  // API routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tenants', tenantsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/cli', cliRouter);

  // Root redirect
  app.get('/', (req, res) => res.redirect('/admin/dashboard'));

  // 404 for unknown API routes
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = config.isProduction() && status === 500
      ? 'Internal server error'
      : err.message || 'Internal server error';

    if (status >= 500) {
      console.error('[error]', err.stack || err.message);
    }

    res.status(status).json({ error: message });
  });

  return app;
}
