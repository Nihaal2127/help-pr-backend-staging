const mongoose = require("mongoose");
const User = require("../models/user");
const Franchise = require("../models/franchise");
const { USER_TYPE_ADMIN } = require("../constants/user_types");

const resolveCallerFranchiseId = async (caller, callerId) => {
  if (caller.franchise_id) {
    return caller.franchise_id;
  }
  if (Number(caller.type) === USER_TYPE_ADMIN) {
    const franchise = await Franchise.findOne({
      admin_id: callerId,
      deleted_at: null,
    })
      .select("_id")
      .lean();
    return franchise?._id || null;
  }
  return null;
};

const parseOptionalFranchiseQuery = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, oid: null };
  }
  const s = String(raw).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) {
    return { ok: false, status: 409, message: "Invalid franchise id." };
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const emptyFranchiseFilter = () => ({
  franchise_id: { $in: [] },
});

const nullOrMissingFranchiseClause = () => ({
  $or: [{ franchise_id: null }, { franchise_id: { $exists: false } }],
});

/**
 * User ids tied to a franchise (employees, partners, franchise admin on Franchise.admin_id).
 */
const fetchFranchiseMemberUserIds = async (franchiseOid) => {
  const franchise = await Franchise.findOne({
    _id: franchiseOid,
    deleted_at: null,
  })
    .select("admin_id")
    .lean();

  const orClauses = [{ franchise_id: franchiseOid }];
  if (franchise?.admin_id) {
    orClauses.push({ _id: franchise.admin_id });
  }

  const users = await User.find({
    deleted_at: null,
    $or: orClauses,
  })
    .select("_id")
    .lean();

  return users.map((u) => u._id);
};

module.exports = {
  resolveCallerFranchiseId,
  parseOptionalFranchiseQuery,
  emptyFranchiseFilter,
  nullOrMissingFranchiseClause,
  fetchFranchiseMemberUserIds,
};
