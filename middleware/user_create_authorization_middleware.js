const mongoose = require('mongoose');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const { parseNumberField } = require('../utils/multipart_parser');

/** Same resolution as user list: user.franchise_id, else franchise where caller is admin_id. */
async function resolveCallerFranchiseId(caller, userId) {
  if (caller?.franchise_id) {
    return caller.franchise_id;
  }
  if (Number(caller?.type) === USER_TYPE_ADMIN && userId) {
    const franchise = await Franchise.findOne({
      admin_id: userId,
      deleted_at: null,
    })
      .select('_id')
      .lean();
    return franchise?._id ?? null;
  }
  return null;
}

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_USER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

/**
 * After authMiddleware: only privileged roles may create users; Admin/Employee are limited
 * to partner, employee, and end-user types and must scope partners/employees to their franchise.
 */
const authorizeUserCreate = async (req, res, next) => {
  try {
    parseNumberField(req, 'type');
    const targetType = Number(req.body.type);
    if (!Number.isInteger(targetType) || targetType < 1 || targetType > 6) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User type is require.',
      });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Access denied. No token provided.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid token.',
      });
    }

    const caller = await User.findOne({ _id: req.user.id, deleted_at: null })
      .select('type franchise_id')
      .lean();

    if (!caller) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid token.',
      });
    }

    const callerType = Number(caller.type);

    if (callerType === USER_TYPE_PARTNER || callerType === USER_TYPE_USER) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'You are not allowed to create users.',
      });
    }

    if (callerType === USER_TYPE_SUPER_ADMIN || callerType === USER_TYPE_STAFF) {
      return next();
    }

    if (callerType === USER_TYPE_ADMIN || callerType === USER_TYPE_EMPLOYEE) {
      const allowedTargets = [USER_TYPE_PARTNER, USER_TYPE_EMPLOYEE, USER_TYPE_USER];
      if (!allowedTargets.includes(targetType)) {
        return res.status(403).json({
          success: false,
          status: 403,
          message: 'You are not allowed to create this user type.',
        });
      }

      if (targetType === USER_TYPE_PARTNER || targetType === USER_TYPE_EMPLOYEE) {
        const effectiveFranchiseId = await resolveCallerFranchiseId(caller, req.user.id);
        if (!effectiveFranchiseId) {
          return res.status(403).json({
            success: false,
            status: 403,
            message:
              'Your account is not linked to a franchise. You cannot create partners or employees.',
          });
        }
        const rawFranchise = req.body.franchise_id;
        const hasPayloadFranchise =
          rawFranchise !== undefined &&
          rawFranchise !== null &&
          String(rawFranchise).trim() !== '' &&
          mongoose.Types.ObjectId.isValid(String(rawFranchise));
        if (
          hasPayloadFranchise &&
          String(rawFranchise) !== String(effectiveFranchiseId)
        ) {
          return res.status(403).json({
            success: false,
            status: 403,
            message: 'You can only assign users to your own franchise.',
          });
        }
        req.body.franchise_id = effectiveFranchiseId;
      }

      return next();
    }

    return res.status(403).json({
      success: false,
      status: 403,
      message: 'You are not allowed to create users.',
    });
  } catch (err) {
    console.error('authorizeUserCreate', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = { authorizeUserCreate };
