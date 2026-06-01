const mongoose = require('mongoose');

const serializeHistoryValue = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (value && value._id && mongoose.Types.ObjectId.isValid(value._id)) {
    return String(value._id);
  }
  return value;
};

const valuesAreEqual = (oldValue, newValue) =>
  JSON.stringify(serializeHistoryValue(oldValue)) ===
  JSON.stringify(serializeHistoryValue(newValue));

const buildHistoryChange = (field, oldValue, newValue) => {
  if (valuesAreEqual(oldValue, newValue)) return null;
  return {
    field,
    old_value: serializeHistoryValue(oldValue),
    new_value: serializeHistoryValue(newValue),
  };
};

const appendQuoteHistory = (quote, { actorId, actorRole, eventType, changes = [], notes = '' }) => {
  if (!Array.isArray(quote.history)) {
    quote.history = [];
  }
  quote.history.push({
    event_type: eventType,
    actor_id: actorId ? new mongoose.Types.ObjectId(String(actorId)) : null,
    actor_role: actorRole || 'system',
    actor_name: '',
    actor_unique_id: '',
    changes: (changes || []).filter(Boolean),
    notes: notes ? String(notes).trim() : '',
    at: new Date(),
  });
};

module.exports = {
  buildHistoryChange,
  appendQuoteHistory,
};
