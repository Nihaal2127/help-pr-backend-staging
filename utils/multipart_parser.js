const parseJSONField = (req, fieldName) => {
    const value = req.body[fieldName];
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      req.body[fieldName] = JSON.parse(trimmed);
    } catch (error) {
      // Keep original value so existing validators can return a consistent error.
    }
  };
  
  const parseBooleanField = (req, fieldName) => {
    const value = req.body[fieldName];
    if (typeof value !== "string") return;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") req.body[fieldName] = true;
    if (normalized === "false") req.body[fieldName] = false;
  };
  
  const parseNumberField = (req, fieldName) => {
    const value = req.body[fieldName];
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed)) {
      req.body[fieldName] = parsed;
    }
  };
  
  module.exports = {
    parseJSONField,
    parseBooleanField,
    parseNumberField,
  };
  