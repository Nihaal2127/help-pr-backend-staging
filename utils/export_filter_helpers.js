const mongoose = require('mongoose');
const { fieldLabel } = require('./field_labels');

const pickParam = (params, ...keys) => {
  for (const key of keys) {
    const raw = params[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return raw;
    }
  }
  return null;
};

/** When a filter param is present but not a valid ObjectId, return a 409 message. */
const validateOptionalObjectIdParams = (params, keys) => {
  for (const key of keys) {
    const raw = pickParam(params, key);
    if (!raw) continue;
    if (!mongoose.Types.ObjectId.isValid(String(raw).trim())) {
      return {
        ok: false,
        message: `${fieldLabel(key)} must be a valid MongoDB ObjectId.`,
      };
    }
  }
  return { ok: true };
};

module.exports = {
  pickParam,
  validateOptionalObjectIdParams,
};
