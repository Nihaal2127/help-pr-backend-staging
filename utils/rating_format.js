const mongoose = require('mongoose');
const OrderService = require('../models/order_services');

const EMPTY_SUBMITTED_RATING = Object.freeze({
  rating: 0,
  average_rating: 0,
  rating_count: 0,
});

const roundRatingAverage = (total, count) => {
  if (!(count > 0)) return 0;
  return Math.round((Number(total) / count) * 100) / 100;
};

/**
 * Normalize rating rollup fields for API responses.
 */
const mapRatingSummary = (doc) => {
  const count = Math.max(0, Number(doc?.rating_count) || 0);
  const average = count > 0 ? Number(doc?.average_rating) || 0 : 0;
  return {
    average_rating: Math.round(average * 100) / 100,
    rating_count: count,
  };
};

/**
 * Average of ratings a customer submitted on order-service lines (`rating > 0`).
 * Customer `user.average_rating` is not rolled up on review submit (partner is), so list/detail compute this from lines.
 */
const buildCustomerSubmittedRatingMap = async (userIds) => {
  const oids = [
    ...new Set(
      (userIds || [])
        .filter((id) => id != null && mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id)),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const map = new Map();
  if (oids.length === 0) return map;

  const rows = await OrderService.aggregate([
    {
      $match: {
        user_id: { $in: oids },
        deleted_at: null,
        rating: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$user_id',
        rating_total: { $sum: '$rating' },
        rating_count: { $sum: 1 },
      },
    },
  ]);

  for (const row of rows) {
    const count = Math.max(0, Number(row.rating_count) || 0);
    const avg = roundRatingAverage(row.rating_total, count);
    map.set(String(row._id), {
      rating: avg,
      average_rating: avg,
      rating_count: count,
    });
  }
  return map;
};

const getCustomerSubmittedRating = (map, userId) =>
  map?.get(String(userId)) || { ...EMPTY_SUBMITTED_RATING };

/** Partner-level rating fields for mobile API cards and embedded partner refs. */
const attachPartnerRatingFields = (doc) => {
  const ratings = mapRatingSummary(doc);
  return {
    ...ratings,
    ratings,
  };
};

/** Per-service rating fields (partner-specific + global service rollups). */
const attachServiceRatingFields = (partnerRow, globalRow) => {
  const partnerRatings = mapRatingSummary(partnerRow);
  const globalRatings = mapRatingSummary(globalRow);
  return {
    ...partnerRatings,
    ratings: partnerRatings,
    partner_service_average_rating: partnerRatings.average_rating,
    partner_service_rating_count: partnerRatings.rating_count,
    service_average_rating: globalRatings.average_rating,
    service_rating_count: globalRatings.rating_count,
  };
};

module.exports = {
  mapRatingSummary,
  attachPartnerRatingFields,
  attachServiceRatingFields,
  buildCustomerSubmittedRatingMap,
  getCustomerSubmittedRating,
  EMPTY_SUBMITTED_RATING,
};
