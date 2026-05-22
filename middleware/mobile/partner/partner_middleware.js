const mongoose = require('mongoose');
const User = require('../../../models/user');
const {
  parseJSONField,
  parseOptionalDateField,
  trimOptionalStringField,
} = require('../../../utils/multipart_parser');

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 50;
const MIN_USER_AGE_YEARS = 18;
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
/** Local part: letters, digits, . _ - only; domain with TLD (min 2 letters). */
const EMAIL_REGEX = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const PARTNER_PROFILE_IMAGE_MAX_BYTES = 512 * 1024;
const USER_TYPE_PARTNER = 2;

const ADMIN_ONLY_BODY_FIELDS = [
  'is_verified',
  'is_active',
  'is_blocked',
  'verification_status',
  'verification_id',
  'verified_at',
  'rejected_reasone',
  'verification_rejection_reason',
  'type',
  'registration_type',
  'is_from_web',
  'created_by_id',
  'franchise_id',
  'accessible_screens',
  'chat',
  'is_business',
];

const isValidGender = (value) => {
  const g = String(value).trim().toLowerCase();
  return g === 'male' || g === 'female' || g === 'other' || g === 'others';
};

const normalizeGender = (value) => {
  const g = String(value).trim().toLowerCase();
  if (g === 'others') return 'other';
  return g;
};

const hasPartnerCatalogFields = (body) =>
  body.partner_services !== undefined ||
  body.partner_categories !== undefined ||
  body.service_ids !== undefined;

const parsePartnerCatalogFields = (req) => {
  parseJSONField(req, 'partner_services');
  parseJSONField(req, 'partner-services');
  parseJSONField(req, 'partner_categories');
  parseJSONField(req, 'category_ids');
  parseJSONField(req, 'service_ids');
  parseJSONField(req, 'service_names');
  parseJSONField(req, 'service_descriptions');
  parseJSONField(req, 'service_prices');
  parseJSONField(req, 'service_taxes');
  parseJSONField(req, 'service_payment_types');
  parseJSONField(req, 'service_minimum_deposits');
  parseJSONField(req, 'partner_documents');
  parseJSONField(req, 'bank_account');
  parseJSONField(req, 'partner_subscription');
  const partnerServicesAlias = req.body['partner-services'];
  if (
    partnerServicesAlias !== undefined &&
    partnerServicesAlias !== null &&
    (!Array.isArray(req.body.partner_services) || req.body.partner_services.length === 0)
  ) {
    req.body.partner_services = partnerServicesAlias;
  }
};

const validatePartnerCatalogPayload = (req, res) => {
  if (req.body.partner_services !== undefined && !Array.isArray(req.body.partner_services)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'partner_services must be an array.',
    });
    return false;
  }
  if (req.body.partner_categories !== undefined && !Array.isArray(req.body.partner_categories)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'partner_categories must be an array.',
    });
    return false;
  }
  return true;
};

const calculateAgeFromBirthDate = (birthDate) => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
};

const validateDateOfBirth = (dobRaw, res) => {
  if (
    dobRaw === undefined ||
    dobRaw === null ||
    (typeof dobRaw === 'string' && dobRaw.trim() === '')
  ) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Date of birth is required.',
    });
    return null;
  }

  const birthDate = dobRaw instanceof Date ? dobRaw : new Date(dobRaw);
  if (Number.isNaN(birthDate.getTime())) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Date of birth must be a valid date.',
    });
    return null;
  }

  if (calculateAgeFromBirthDate(birthDate) < MIN_USER_AGE_YEARS) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Not applicable for individuals below 18 years of age.',
    });
    return null;
  }

  return birthDate;
};

const validatePersonName = (name, res) => {
  const trimmed = String(name).trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    res.status(400).json({
      success: false,
      status: 400,
      message: `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters.`,
    });
    return null;
  }
  return trimmed;
};

const partnerRegisterMiddleware = async (req, res, next) => {
  const { name, email, phone_number, password, date_of_birth } = req.body;

  if (!name || String(name).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Name is required.',
    });
  }
  const validatedName = validatePersonName(name, res);
  if (validatedName === null) return;
  req.body.name = validatedName;

  if (!email || String(email).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.',
    });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.',
    });
  }
  req.body.email = normalizedEmail;

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  const normalizedPhone = String(phone_number || '').trim();
  if (!normalizedPhone) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Phone number is required.',
    });
  }
  if (!phoneRegex.test(normalizedPhone)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid phone number format.',
    });
  }
  req.body.phone_number = normalizedPhone;

  const validatedDob = validateDateOfBirth(date_of_birth, res);
  if (validatedDob === null) return;
  req.body.date_of_birth = validatedDob;

  if (!password || String(password).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password is required.',
    });
  }
  if (!PASSWORD_REGEX.test(String(password))) {
    return res.status(400).json({
      success: false,
      status: 400,
      message:
        'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.',
    });
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ phone_number: normalizedPhone }, { email: normalizedEmail }],
      deleted_at: null,
    })
      .select('email phone_number')
      .lean();

    if (existingUser) {
      let message = 'Email or phone number already exists.';
      if (existingUser.phone_number === normalizedPhone) {
        message = 'Phone number already exists.';
      } else if (existingUser.email === normalizedEmail) {
        message = 'Email already exists.';
      }
      return res.status(409).json({
        success: false,
        status: 409,
        message,
      });
    }
  } catch (err) {
    console.error('partnerRegisterMiddleware duplicate check', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }

  next();
};

const partnerLoginMiddleware = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || String(email).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.',
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.',
    });
  }
  req.body.email = normalizedEmail;

  if (!password || String(password).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password is required.',
    });
  }

  next();
};

const partnerRequireMultipartMiddleware = (req, res, next) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Content-Type must be multipart/form-data.',
    });
  }
  return next();
};

const partnerProfileImageSizeMiddleware = (req, res, next) => {
  const img = req.files?.image?.[0] || req.file;
  if (!img) return next();
  const size =
    typeof img.size === 'number' && !Number.isNaN(img.size)
      ? img.size
      : Buffer.isBuffer(img.buffer)
        ? img.buffer.length
        : null;
  if (size === null) return next();
  if (size > PARTNER_PROFILE_IMAGE_MAX_BYTES) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Profile image must be 512 KB or smaller.',
    });
  }
  return next();
};

const partnerUpdateMiddleware = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    const partner = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type').lean();
    if (!partner || Number(partner.type) !== USER_TYPE_PARTNER) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'Only partner accounts can use this endpoint.',
      });
    }
  } catch (err) {
    console.error('partnerUpdateMiddleware auth', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }

  ADMIN_ONLY_BODY_FIELDS.forEach((key) => {
    delete req.body[key];
  });

  parsePartnerCatalogFields(req);
  parseOptionalDateField(req, 'date_of_birth');
  trimOptionalStringField(req, 'experience');

  if (hasPartnerCatalogFields(req.body) && !validatePartnerCatalogPayload(req, res)) {
    return;
  }

  const { name, email, phone_number, password, state_id, city_id, area_id, date_of_birth, gender } =
    req.body;

  if (name !== undefined) {
    if (String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Name is required.',
      });
    }
    const validatedName = validatePersonName(name, res);
    if (validatedName === null) return;
    req.body.name = validatedName;
  }

  if (email !== undefined) {
    if (String(email).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Email is required.',
      });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid email format.',
      });
    }
    req.body.email = normalizedEmail;
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (phone_number !== undefined) {
    const normalizedPhone = String(phone_number).trim();
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Phone number is required.',
      });
    }
    if (!phoneRegex.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid phone number format.',
      });
    }
    req.body.phone_number = normalizedPhone;
  }

  if (date_of_birth !== undefined) {
    const validatedDob = validateDateOfBirth(date_of_birth, res);
    if (validatedDob === null) return;
    req.body.date_of_birth = validatedDob;
  }

  if (gender !== undefined) {
    if (gender === null || String(gender).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Gender is required.',
      });
    }
    if (!isValidGender(gender)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'gender must be "male", "female", or "other".',
      });
    }
    req.body.gender = normalizeGender(gender);
  }

  if (state_id !== undefined && state_id !== null && String(state_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(state_id))) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid state id.',
      });
    }
  }

  if (city_id !== undefined && city_id !== null && String(city_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(city_id))) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid city id.',
      });
    }
  }

  if (area_id !== undefined && area_id !== null && String(area_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(area_id))) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid area id.',
      });
    }
  }

  if (password !== undefined && password !== null && String(password).trim() !== '') {
    if (!PASSWORD_REGEX.test(String(password))) {
      return res.status(400).json({
        success: false,
        status: 400,
        message:
          'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.',
      });
    }
    const confirmPassword = req.body.confirm_password;
    if (
      confirmPassword === undefined ||
      confirmPassword === null ||
      String(confirmPassword).trim() === ''
    ) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Confirm password is required when password is provided.',
      });
    }
    if (String(password) !== String(confirmPassword)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Password and confirm password do not match.',
      });
    }
  }

  const partnerId = String(req.user.id);
  const orConditions = [];
  if (email !== undefined && EMAIL_REGEX.test(req.body.email)) {
    orConditions.push({ email: req.body.email });
  }
  if (phone_number !== undefined && phoneRegex.test(req.body.phone_number)) {
    orConditions.push({ phone_number: req.body.phone_number });
  }
  if (orConditions.length > 0 && mongoose.Types.ObjectId.isValid(partnerId)) {
    try {
      const existingUser = await User.findOne({
        $or: orConditions,
        deleted_at: null,
        _id: { $ne: new mongoose.Types.ObjectId(partnerId) },
      })
        .select('email phone_number')
        .lean();
      if (existingUser) {
        let message = 'Email or phone number already exists.';
        if (phone_number !== undefined && existingUser.phone_number === req.body.phone_number) {
          message = 'Phone number already exists.';
        } else if (email !== undefined && existingUser.email === req.body.email) {
          message = 'Email already exists.';
        }
        return res.status(409).json({
          success: false,
          status: 409,
          message,
        });
      }
    } catch (err) {
      console.error('partnerUpdateMiddleware duplicate check', err.message);
      return res.status(500).json({
        success: false,
        status: 500,
        message: 'Internal server error.',
      });
    }
  }

  next();
};

module.exports = {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
  partnerUpdateMiddleware,
  partnerProfileImageSizeMiddleware,
  partnerRequireMultipartMiddleware,
};
