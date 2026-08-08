const UserHomeCounts = require('../../../models/user_home_counts');

const loadHomeCounts = async () => {
  const row = await UserHomeCounts.findOne({ deleted_at: null })
    .select('total_distance_travelled served consulted captured')
    .lean();

  return {
    total_distance_travelled: row?.total_distance_travelled ?? 0,
    served: row?.served ?? 0,
    consulted: row?.consulted ?? 0,
    captured: row?.captured ?? 0,
  };
};

module.exports = {
  loadHomeCounts,
};
