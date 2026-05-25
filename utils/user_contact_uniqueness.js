const mongoose = require('mongoose');
const User = require('../models/user');
const { escapeRegExp } = require('./string_helpers');

/** Trim and lowercase email for storage and duplicate checks (all user types). */
const normalizeUserEmail = (email) => String(email || '').trim().toLowerCase();

/** Trim phone for storage and duplicate checks (all user types). */
const normalizeUserPhone = (phone_number) => String(phone_number || '').trim();

/**
 * Find an active user (any type) with the same email (case-insensitive) or phone.
 * @param {{ email?: string, phone_number?: string, excludeUserId?: string|null }} params
 */
const findActiveUserWithContact = async ({ email, phone_number, excludeUserId = null }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedPhone = normalizeUserPhone(phone_number);

  const orConditions = [];
  if (normalizedPhone) {
    orConditions.push({ phone_number: normalizedPhone });
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
  const storedEmail =
    existingUser?.email != null ? normalizeUserEmail(existingUser.email) : '';
  const storedPhone = normalizeUserPhone(existingUser?.phone_number);

  if (normalizedPhone && storedPhone === normalizedPhone) {
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
  findActiveUserWithContact,
  contactConflictMessage,
  checkUserContactUniqueness,
};
