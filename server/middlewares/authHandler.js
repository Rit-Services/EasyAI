const jwt = require('jsonwebtoken');
const config = require('../config');
const { prisma } = require('../db/db');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('./asyncHandler');
const { can } = require('../utils/permissions');

// Verifies the JWT cookie, loads the user, and sets req.user + req.organizationId.
const authHandler = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[config.jwt.cookieName];
  if (!token) throw new ErrorResponse('Not authenticated', 401);

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new ErrorResponse('Session expired or invalid', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new ErrorResponse('User no longer exists', 401);

  req.user = user;
  req.organizationId = user.organizationId || null;
  next();
});

// requireRole('owner','admin') -> guard that runs after authHandler.
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
  if (!roles.includes(req.user.role)) {
    return next(new ErrorResponse('You do not have permission to perform this action', 403));
  }
  return next();
};

// requireOrg -> ensures the user has completed organization setup.
const requireOrg = (req, res, next) => {
  if (!req.organizationId) {
    return next(new ErrorResponse('Create your organization first', 409));
  }
  return next();
};

// requirePermission('members.manage') -> guard based on the permissions matrix.
const requirePermission = (action) => (req, res, next) => {
  if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
  if (!can(req.user.role, action)) {
    return next(new ErrorResponse('You do not have permission to perform this action', 403));
  }
  return next();
};

// requireProductionAccount -> blocks what a test account (no AVV) may not use:
// features that would bring real personal data into the platform.
const requireProductionAccount = asyncHandler(async (req, res, next) => {
  const org = req.organizationId
    ? await prisma.organization.findUnique({ where: { id: req.organizationId }, select: { accountType: true } })
    : null;
  if (org?.accountType === 'test') {
    throw new ErrorResponse('This is not available in a test account. Switch to production in Settings to use it.', 403);
  }
  next();
});

module.exports = { authHandler, requireRole, requireOrg, requirePermission, requireProductionAccount };
