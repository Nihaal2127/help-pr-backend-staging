const mongoose = require('mongoose');
const { loadPartnerHomeOrders } = require('./home_orders_service');
const { loadPartnerHomeQuotes } = require('./home_quotes_service');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const getPartnerHome = async (partnerId) => {
  try {
    if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
      return fail(401, 'Invalid token.');
    }

    const [quotes, orders] = await Promise.all([
      loadPartnerHomeQuotes(partnerId),
      loadPartnerHomeOrders(partnerId),
    ]);

    return ok(200, {
      message: 'Home data fetched successfully.',
      data: {
        quotes,
        orders,
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
