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
};
