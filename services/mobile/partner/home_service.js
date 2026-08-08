const mongoose = require('mongoose');
const { loadPartnerHomeOrders } = require('./home_orders_service');
const { loadPartnerHomeQuotes } = require('./home_quotes_service');
const { loadHomeCounts } = require('../common/home_counts_service');

const { fail, ok } = require('../../../utils/mobile_service_result');

const getPartnerHome = async (partnerId) => {
  try {
    if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
      return fail(401, 'Invalid token.');
    }

    const [quotes, orders, home_counts] = await Promise.all([
      loadPartnerHomeQuotes(partnerId),
      loadPartnerHomeOrders(partnerId),
      loadHomeCounts(),
    ]);

    return ok(200, {
      message: 'Home data fetched successfully.',
      data: {
        quotes,
        orders,
        home_counts,
      },
    });
  } catch (err) {
    console.error('mobile partner home', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  getPartnerHome,
};
