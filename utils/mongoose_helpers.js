const mongoose = require("mongoose");

const isMongoObjectIdHex = (value) =>
  /^[a-fA-F0-9]{24}$/.test(String(value).trim());

/**
 * Build optional Mongo filter fields from query string ObjectIds.
 * @param {object} query - req.query
 * @param {string[]} keys - e.g. ['user_id', 'partner_id']
 */
const buildObjectIdQueryFilters = (query, keys) => {
  const filter = {};
  for (const key of keys) {
    const raw = query[key];
    if (raw !== undefined && raw !== null && mongoose.Types.ObjectId.isValid(raw)) {
      filter[key] = new mongoose.Types.ObjectId(raw);
    }
  }
  return filter;
};

module.exports = {
  isMongoObjectIdHex,
  buildObjectIdQueryFilters,
};
