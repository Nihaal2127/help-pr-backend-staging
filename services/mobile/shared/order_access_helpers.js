const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { fail, ok } = require('../../../utils/mobile_service_result');

const assertValidCallerObjectId = (callerId) => {
  if (!callerId || !mongoose.Types.ObjectId.isValid(String(callerId))) {
    return fail(401, 'Invalid token.');
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(String(callerId)) };
};

const loadCustomerOrder = async (customerId, orderId) => {
  const callerResult = assertValidCallerObjectId(customerId);
  if (!callerResult.ok) {
    return callerResult;
  }
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    return fail(400, 'Invalid order id.');
  }

  const order = await Order.findOne({
    _id: orderId,
    user_id: callerResult.oid,
    deleted_at: null,
  });

  if (!order) {
    return fail(404, 'Order not found.');
  }

  return ok(200, { order });
};

const loadPartnerOrder = async (partnerId, orderId) => {
  const callerResult = assertValidCallerObjectId(partnerId);
  if (!callerResult.ok) {
    return callerResult;
  }
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    return fail(400, 'Invalid order id.');
  }

  const order = await Order.findOne({
    _id: orderId,
    partner_id: callerResult.oid,
    deleted_at: null,
  });

  if (!order) {
    return fail(404, 'Order not found.');
  }

  return ok(200, { order });
};

module.exports = {
  assertValidCallerObjectId,
  loadCustomerOrder,
  loadPartnerOrder,
};
