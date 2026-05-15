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

  /** ISO or date-like string → Date; empty string → null; invalid → leave unchanged. */
  const parseOptionalDateField = (req, fieldName) => {
    const value = req.body[fieldName];
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim() === "") {
      req.body[fieldName] = null;
      return;
    }
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) return;
      req.body[fieldName] = null;
      return;
    }
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) req.body[fieldName] = d;
  };

  const trimOptionalStringField = (req, fieldName) => {
    const v = req.body[fieldName];
    if (v === undefined || v === null) return;
    if (typeof v === "number") {
      req.body[fieldName] = String(v);
      return;
    }
    if (typeof v === "string") {
      const t = v.trim();
      req.body[fieldName] = t === "" ? null : t;
    }
  };

  module.exports = {
    parseJSONField,
    parseBooleanField,
    parseNumberField,
    parseOptionalDateField,
    trimOptionalStringField,
  };
  