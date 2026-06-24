const mongoose = require('mongoose');
const User = require('../models/user');
const { escapeRegExp } = require('./string_helpers');

/** Trim and lowercase email for storage and duplicate checks (all user types). */
const normalizeUserEmail = (email) => String(email || '').trim().toLowerCase();

/** Trim phone and normalize to a consistent E.164-style value for storage and lookup. */
const normalizeUserPhone = (phone_number) => {
  let p = String(phone_number || '').trim().replace(/[\s-]/g, '');
  if (!p) return '';

  if (p.startsWith('+')) {
    return p;
  }
  if (/^91[6-9]\d{9}$/.test(p)) {
    return `+${p}`;
  }
  if (/^[6-9]\d{9}$/.test(p)) {
    return `+91${p}`;
  }
  return p;
};

/** Match legacy rows saved before canonical phone normalization. */
const getPhoneLookupVariants = (phone_number) => {
  const canonical = normalizeUserPhone(phone_number);
  const variants = new Set();
  if (!canonical) return [];

  variants.add(canonical);

  if (canonical.startsWith('+91') && canonical.length === 13) {
    const national = canonical.slice(3);
    const withoutPlus = canonical.slice(1);
    variants.add(national);
    variants.add(withoutPlus);
    variants.add(`91${national}`);
  }

  return [...variants].filter(Boolean);
};

/**
 * Find an active user (any type) with the same email (case-insensitive) or phone.
 * @param {{ email?: string, phone_number?: string, excludeUserId?: string|null }} params
 */
const findActiveUserWithContact = async ({ email, phone_number, excludeUserId = null }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedPhone = normalizeUserPhone(phone_number);

  const orConditions = [];
  if (normalizedPhone) {
    const phoneVariants = getPhoneLookupVariants(normalizedPhone);
    orConditions.push({ phone_number: { $in: phoneVariants } });
  }
  if (normalizedEmail) {
    orConditions.push({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
    });
  }
  if (orConditions.length === 0) {
    return null;
  }

  const filter = { deleted_at: null, $or: orConditions };
  if (excludeUserId != null && mongoose.Types.ObjectId.isValid(String(excludeUserId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(excludeUserId) };
  }

  return User.findOne(filter).select('email phone_number').lean();
};

const contactConflictMessage = (existingUser, { email, phone_number }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = new Set(getPhoneLookupVariants(normalizedPhone));
  const storedEmail =
    existingUser?.email != null ? normalizeUserEmail(existingUser.email) : '';
  const storedPhone = normalizeUserPhone(existingUser?.phone_number);

  if (normalizedPhone && (phoneVariants.has(storedPhone) || storedPhone === normalizedPhone)) {
    return 'Phone number already exists.';
  }
  if (normalizedEmail && storedEmail === normalizedEmail) {
    return 'Email already exists.';
  }
  return 'Email or phone number already exists.';
};

/**
 * Ensure email/phone are not used by another active user (any type: admin, partner, employee, customer, etc.).
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
const checkUserContactUniqueness = async ({ email, phone_number, excludeUserId = null }) => {
  const existingUser = await findActiveUserWithContact({
    email,
    phone_number,
    excludeUserId,
  });
  if (!existingUser) {
    return { ok: true };
  }
  return {
    ok: false,
    message: contactConflictMessage(existingUser, { email, phone_number }),
  };
};

module.exports = {
  normalizeUserEmail,
  normalizeUserPhone,
  getPhoneLookupVariants,
  findActiveUserWithContact,
  contactConflictMessage,
  checkUserContactUniqueness,
};
