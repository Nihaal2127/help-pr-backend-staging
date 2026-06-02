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

module.exports = {
  mapRatingSummary,
};
