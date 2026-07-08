const mongoose = require("mongoose");
const Order = require("../../../models/order");
const OrderService = require("../../../models/order_services");
const User = require("../../../models/user");
const Service = require("../../../models/service");
const PartnerServiceRating = require("../../../models/partner_service_rating");
const { ORDER_STATUS_COMPLETED } = require("../../../enum/order_status_enum");
const { safeNotifyOrderReviewReceived } = require("../../../src/modules/notifications/services/domainHooks");

const { fail, ok } = require('../../../utils/mobile_service_result');

const normalizeRating = (value) => {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  return Math.round(rating * 10) / 10;
};

const normalizeReview = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const pickOrderServiceForReview = async (order, serviceItemIdRaw) => {
  const lineIds = (order.service_items || []).map((id) => String(id));
  let targetLineId = null;

  if (serviceItemIdRaw !== undefined && serviceItemIdRaw !== null && String(serviceItemIdRaw).trim() !== "") {
    const raw = String(serviceItemIdRaw).trim();
    if (!mongoose.Types.ObjectId.isValid(raw)) {
      return fail(400, "Invalid service_items_id.");
    }
    if (!lineIds.includes(raw)) {
      return fail(404, "Service line not found on this order.");
    }
    targetLineId = raw;
  } else if (lineIds.length === 1) {
    targetLineId = lineIds[0];
  } else {
    return fail(400, "service_items_id is required when order has multiple services.");
  }

  const line = await OrderService.findOne({
    _id: targetLineId,
    order_id: order._id,
    deleted_at: null,
  });

  if (!line) {
    return fail(404, "Order service not found.");
  }
  return ok(200, line);
};

const recalcAverage = (total, count) => {
  if (!(count > 0)) return 0;
  return Math.round((total / count) * 100) / 100;
};

const applyAggregateDelta = async (model, filter, { deltaTotal, deltaCount, setOnInsert }) => {
  const now = new Date();
  const updateDoc = {
    $inc: {
      rating_total: deltaTotal,
      rating_count: deltaCount,
    },
    $set: {
      updated_at: now,
    },
  };
  if (setOnInsert) {
    updateDoc.$setOnInsert = {
      ...setOnInsert,
      created_at: now,
      deleted_at: null,
    };
  }

  const updated = await model.findOneAndUpdate(filter, updateDoc, {
    new: true,
    upsert: Boolean(setOnInsert),
  });
  if (!updated) return;

  const safeCount = Math.max(0, Number(updated.rating_count) || 0);
  const safeTotal = Math.max(0, Number(updated.rating_total) || 0);
  const avg = recalcAverage(safeTotal, safeCount);
  await model.updateOne(
    { _id: updated._id },
    {
      $set: {
        rating_total: safeTotal,
        rating_count: safeCount,
        average_rating: avg,
        updated_at: now,
      },
    }
  );
};

const submitOrderReview = async (customerId, orderId, payload = {}) => {
  try {
    if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(401, "Invalid token.");
    }
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return fail(400, "Invalid order id.");
    }

    const rating = normalizeRating(payload.rating);
    if (rating === null) {
      return fail(409, "rating must be a number between 1 and 5.");
    }
    const review_text = normalizeReview(payload.review_text);

    const order = await Order.findOne({
      _id: orderId,
      user_id: new mongoose.Types.ObjectId(String(customerId)),
      deleted_at: null,
    });
    if (!order) {
      return fail(404, "Order not found.");
    }

    if (order.order_status !== ORDER_STATUS_COMPLETED) {
      return fail(409, "You can review only completed orders.");
    }

    const lineResult = await pickOrderServiceForReview(order, payload.service_items_id);
    if (!lineResult.ok) return lineResult;
    const serviceLine = lineResult.data;

    if (serviceLine.service_status !== ORDER_STATUS_COMPLETED) {
      return fail(409, "You can review only completed services.");
    }
    if (!serviceLine.partner_id || !serviceLine.service_id) {
      return fail(409, "Service line is missing partner/service details.");
    }

    const oldRating = Number(serviceLine.rating) > 0 ? Number(serviceLine.rating) : 0;
    const isNewReview = oldRating <= 0;
    const deltaTotal = rating - oldRating;
    const deltaCount = isNewReview ? 1 : 0;

    serviceLine.rating = rating;
    serviceLine.review_text = review_text;
    serviceLine.reviewed_at = new Date();
    serviceLine.updated_at = new Date();
    await serviceLine.save();

    if (deltaTotal !== 0 || deltaCount !== 0) {
      await applyAggregateDelta(
        User,
        { _id: serviceLine.partner_id, deleted_at: null },
        { deltaTotal, deltaCount }
      );
      await applyAggregateDelta(
        Service,
        { _id: serviceLine.service_id, deleted_at: null },
        { deltaTotal, deltaCount }
      );
      await applyAggregateDelta(
        PartnerServiceRating,
        { partner_id: serviceLine.partner_id, service_id: serviceLine.service_id, deleted_at: null },
        {
          deltaTotal,
          deltaCount,
          setOnInsert: {
            partner_id: serviceLine.partner_id,
            service_id: serviceLine.service_id,
          },
        }
      );
    }

    if (isNewReview && serviceLine.partner_id) {
      void safeNotifyOrderReviewReceived({
        order,
        partnerUserId: serviceLine.partner_id,
        actorUserId: customerId,
      });
    }

    return ok(200, {
      message: isNewReview ? "Review submitted successfully." : "Review updated successfully.",
      record: {
        order_id: order._id,
        service_items_id: serviceLine._id,
        rating: serviceLine.rating,
        review_text: serviceLine.review_text,
        reviewed_at: serviceLine.reviewed_at,
        partner_id: serviceLine.partner_id,
        service_id: serviceLine.service_id,
      },
    });
  } catch (error) {
    console.error("mobile user submit order review", error.message);
    return fail(500, "Internal server error.");
  }
};

module.exports = {
  submitOrderReview,
};
