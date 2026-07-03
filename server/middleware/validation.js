import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    req.query = result.data;
    next();
  };
}

// Shared schemas
export const schemas = {
  email: z.string().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.enum(['super_admin', 'admin', 'manager', 'user', 'read_only']),
  status: z.enum(['active', 'disabled', 'invited', 'pending', 'removed']),

  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),

  dateRange: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),

  createUser: z.object({
    email: z.string().email().max(255).toLowerCase(),
    display_name: z.string().min(1).max(255),
    given_name: z.string().max(128).optional(),
    surname: z.string().max(128).optional(),
    department: z.string().max(255).optional(),
    job_title: z.string().max(255).optional(),
    role: z.enum(['super_admin', 'admin', 'manager', 'user', 'read_only']).default('user'),
    tenant_id: z.number().int().positive().optional(),
    send_invite: z.boolean().default(true),
  }),

  updateUser: z.object({
    display_name: z.string().min(1).max(255).optional(),
    given_name: z.string().max(128).optional(),
    surname: z.string().max(128).optional(),
    department: z.string().max(255).optional(),
    job_title: z.string().max(255).optional(),
    role: z.enum(['super_admin', 'admin', 'manager', 'user', 'read_only']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  }),

  loginLocal: z.object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1),
  }),

  createTenant: z.object({
    name: z.string().min(1).max(255),
    domain: z.string().max(255).optional(),
    aad_tenant_id: z.string().uuid(),
    client_id: z.string().uuid(),
    client_secret: z.string().min(1).max(512),
    sync_enabled: z.boolean().default(true),
    sync_schedule: z.string().max(64).default('0 2 * * *'),
  }),

  reportCli: z.object({
    session_id: z.string().max(255).optional(),
    session_label: z.string().max(255).optional(),
    command: z.string().max(128),
    args: z.string().max(500).optional(),
    original_bytes: z.number().int().min(0),
    compressed_bytes: z.number().int().min(0),
    original_tokens: z.number().int().min(0),
    compressed_tokens: z.number().int().min(0),
    saved_tokens: z.number().int().min(0),
    duration_ms: z.number().min(0).optional(),
    exit_code: z.number().int().optional(),
  }),
};
