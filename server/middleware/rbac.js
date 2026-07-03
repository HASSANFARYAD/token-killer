const ROLE_LEVELS = {
  super_admin: 5,
  admin: 4,
  manager: 3,
  user: 2,
  read_only: 1,
};

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

export function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Insufficient permissions. Minimum role required: ${minRole}`,
      });
    }
    next();
  };
}

export function requireSameTenantOrAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const isSuperAdmin = req.user.role === 'super_admin';
  if (isSuperAdmin) return next();

  const targetTenantId = parseInt(req.params.tenantId || req.body?.tenantId, 10);
  if (targetTenantId && req.user.tenant_id !== targetTenantId) {
    return res.status(403).json({ error: 'Access denied to this tenant' });
  }
  next();
}

export function requireSelfOrAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const targetUserId = parseInt(req.params.userId || req.params.id, 10);
  const isSelf = req.user.id === targetUserId;
  const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

// Scope all DB queries to the current user's tenant (unless super_admin)
export function scopeToTenant(req, res, next) {
  if (req.user?.role === 'super_admin') {
    req.tenantFilter = null; // no filter — sees all
  } else {
    req.tenantFilter = req.user?.tenant_id || -1;
  }
  next();
}
