const mongoose = require("mongoose");
const User = require("../models/user");

const getCallerId = (req) =>
  (req && req.user && (req.user.id || req.user._id)) || null;

const loadCaller = async (req) => {
  const callerId = getCallerId(req);
  if (!callerId || !mongoose.Types.ObjectId.isValid(callerId)) {
    return { ok: false, status: 401, message: "Access denied. Invalid token." };
  }

  const caller = await User.findOne({ _id: callerId, deleted_at: null })
    .select("type franchise_id")
    .lean();

  if (!caller) {
    return { ok: false, status: 401, message: "User not found." };
  }

  return { ok: true, caller, callerId };
};

module.exports = {
  getCallerId,
  loadCaller,
};
