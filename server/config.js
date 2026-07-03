import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Required environment variable ${key} is not set`);
  return value;
}

function optional(key, defaultValue) {
  return process.env[key] || defaultValue;
}

function optionalInt(key, defaultValue) {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : defaultValue;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: optionalInt('PORT', 3000),
  host: optional('HOST', '0.0.0.0'),

  dbPath: optional('NOISEGATE_DB_PATH', optional('RTK_DB_PATH', path.join(__dirname, '../data/noisegate.db'))),

  // Must be 64 hex chars (32 bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKey: process.env.NOISEGATE_ENCRYPTION_KEY || process.env.RTK_ENCRYPTION_KEY || null,

  jwt: {
    secret: optional('NOISEGATE_JWT_SECRET', optional('RTK_JWT_SECRET', 'change-me-in-production-use-random-32-chars')),
    accessExpiresIn: optional('NOISEGATE_JWT_ACCESS_EXPIRES', optional('RTK_JWT_ACCESS_EXPIRES', '15m')),
    refreshExpiresIn: optional('NOISEGATE_JWT_REFRESH_EXPIRES', optional('RTK_JWT_REFRESH_EXPIRES', '7d')),
    issuer: optional('NOISEGATE_JWT_ISSUER', optional('RTK_JWT_ISSUER', 'noisegate')),
  },

  session: {
    cookieName: optional('NOISEGATE_COOKIE_NAME', optional('RTK_COOKIE_NAME', 'noisegate_session')),
    secure: optional('NODE_ENV', 'development') === 'production',
    sameSite: optional('NOISEGATE_COOKIE_SAMESITE', optional('RTK_COOKIE_SAMESITE', 'strict')),
  },

  microsoft: {
    clientId: optional('NOISEGATE_MS_CLIENT_ID', optional('RTK_MS_CLIENT_ID', '')),
    clientSecret: optional('NOISEGATE_MS_CLIENT_SECRET', optional('RTK_MS_CLIENT_SECRET', '')),
    tenantId: optional('NOISEGATE_MS_TENANT_ID', optional('RTK_MS_TENANT_ID', 'common')),
    redirectUri: optional('NOISEGATE_MS_REDIRECT_URI', optional('RTK_MS_REDIRECT_URI', 'http://localhost:3000/api/auth/microsoft/callback')),
    scopes: ['openid', 'profile', 'email', 'User.Read'],
  },

  rateLimit: {
    windowMs: optionalInt('NOISEGATE_RATE_LIMIT_WINDOW_MS', optionalInt('RTK_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000)),
    max: optionalInt('NOISEGATE_RATE_LIMIT_MAX', optionalInt('RTK_RATE_LIMIT_MAX', 100)),
    authMax: optionalInt('NOISEGATE_RATE_LIMIT_AUTH_MAX', optionalInt('RTK_RATE_LIMIT_AUTH_MAX', 10)),
  },

  baseUrl: optional('NOISEGATE_BASE_URL', optional('RTK_BASE_URL', 'http://localhost:3000')),

  logLevel: optional('NOISEGATE_LOG_LEVEL', optional('RTK_LOG_LEVEL', 'info')),

  isProduction() {
    return this.env === 'production';
  },

  validate() {
    const warnings = [];
    if (this.jwt.secret === 'change-me-in-production-use-random-32-chars') {
      warnings.push('NOISEGATE_JWT_SECRET is using the default insecure value. Set a random secret in production.');
    }
    if (!this.encryptionKey) {
      warnings.push('NOISEGATE_ENCRYPTION_KEY is not set. Tenant client secrets cannot be stored securely.');
    }
    if (this.isProduction() && !this.session.secure) {
      warnings.push('Cookies are not marked Secure. Set NODE_ENV=production to enable.');
    }
    return warnings;
  },
};
