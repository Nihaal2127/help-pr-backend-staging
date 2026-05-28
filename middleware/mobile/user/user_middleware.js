const crypto = require('crypto');
const mongoose = require('mongoose');
const Otp = require('../../../models/otp');
const User = require('../../../models/user');
const { validatePhoneNumber } = require('../../../validator/form_validator');
const {
  normalizeUserEmail,
  normalizeUserPhone,
  checkUserContactUniqueness,
} = require('../../../utils/user_contact_uniqueness');
const { isValidGender, normalizeGender } = require('../../../enum/gender_enum');
const { parseOptionalDateField } = require('../../../utils/multipart_parser');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');

const MIN_USER_AGE_YEARS = 18;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 50;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_PROFILE_IMAGE_MAX_BYTES = 512 * 1024;

const MOBILE_USER_ALLOWED_UPDATE_FIELDS = new Set([
  'name',
  'phone_number',
  'email',
  'date_of_birth',
  'gender',
]);

const calculateAgeFromBirthDate = (birthDate) => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
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

const validateAndNormalizePhone = (req, res) => {
  const { phone_number } = req.body;
  const phoneResult = validatePhoneNumber(phone_number);
  if (phoneResult.valid === false) {
    res.status(400).json({
      success: false,
      status: 400,
      message: phoneResult.message,
    });
    return null;
  }
  const normalized = normalizeUserPhone(phone_number);
  req.body.phone_number = normalized;
  return normalized;
};

const rateLimitSendOtp = async (req, res, next) => {
  const normalized = validateAndNormalizePhone(req, res);
  if (!normalized) return;

  try {
    const existingOtp = await Otp.findOne({
      phone_number: normalized,
      expiresAt: { $gt: new Date() },
    });

    if (existingOtp) {
      return res.status(429).json({
        success: false,
        status: 429,
        message:
          'An OTP has already been sent to this phone number. Please wait before requesting again.',
      });
    }

    next();
  } catch (error) {
    console.error('mobile user send-otp rate limit', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during OTP request validation.',
    });
  }
};

const validateVerifyOtp = async (req, res, next) => {
  const normalized = validateAndNormalizePhone(req, res);
  if (!normalized) return;

  const { otp } = req.body;
  if (otp === undefined || otp === null || String(otp).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'OTP is required.',
    });
  }

  try {
    const hashedOtp = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    const otpEntry = await Otp.findOne({ phone_number: normalized, otp: hashedOtp });

    if (!otpEntry) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid OTP.',
      });
    }

    if (otpEntry.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'OTP has expired.',
      });
    }

    req.validOtp = otpEntry;
    next();
  } catch (error) {
    console.error('mobile user verify-otp validation', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during OTP validation.',
    });
  }
};

const userRequireMultipartMiddleware = (req, res, next) => {
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

const userProfileImageSizeMiddleware = (req, res, next) => {
  const img = req.files?.profile_photo?.[0];
  if (!img) return next();
  const size =
    typeof img.size === 'number' && !Number.isNaN(img.size)
      ? img.size
      : Buffer.isBuffer(img.buffer)
        ? img.buffer.length
        : null;
  if (size === null) return next();
  if (size > USER_PROFILE_IMAGE_MAX_BYTES) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Profile photo must be 512 KB or smaller.',
    });
  }
  return next();
};

const userUpdateMiddleware = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Access denied. No token provided.',
    });
  }

  if (Number(req.user.type) !== USER_TYPE_CUSTOMER) {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'This account is not a customer. Use the correct app to update profile.',
    });
  }

  const hasProfilePhoto = Boolean(req.files?.profile_photo?.[0]);
  const hasAllowedField =
    hasProfilePhoto ||
    [...MOBILE_USER_ALLOWED_UPDATE_FIELDS].some((field) => req.body[field] !== undefined);
  if (!hasAllowedField) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'At least one profile field is required to update.',
    });
  }

  parseOptionalDateField(req, 'date_of_birth');

  const existingCustomer = await User.findOne({
    _id: req.user.id,
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  })
    .select('name email gender')
    .lean();

  if (!existingCustomer) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: 'Customer not found.',
    });
  }

  const { name, email, phone_number, date_of_birth, gender } = req.body;

  const finalName = name !== undefined ? String(name).trim() : String(existingCustomer.name || '').trim();
  const finalEmail =
    email !== undefined ? String(email).trim() : String(existingCustomer.email || '').trim();
  const finalGender =
    gender !== undefined ? String(gender).trim() : String(existingCustomer.gender || '').trim();

  if (!finalName) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Name is required.',
    });
  }
  if (!finalEmail) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.',
    });
  }
  if (!finalGender) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Gender is required.',
    });
  }

  if (name !== undefined) {
    if (name === null || String(name).trim() === '') {
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
    if (email === null || String(email).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Email is required.',
      });
    }
    if (!EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid email format.',
      });
    }
    req.body.email = normalizeUserEmail(email);
  }

  if (phone_number !== undefined) {
    const phoneResult = validatePhoneNumber(phone_number);
    if (phoneResult.valid === false) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: phoneResult.message,
      });
    }
    req.body.phone_number = normalizeUserPhone(phone_number);
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

  const customerId = String(req.user.id);
  if (mongoose.Types.ObjectId.isValid(customerId)) {
    const contactEmail = email !== undefined ? req.body.email : undefined;
    const contactPhone = phone_number !== undefined ? req.body.phone_number : undefined;
    if (contactEmail !== undefined || contactPhone !== undefined) {
      try {
        const uniqueness = await checkUserContactUniqueness({
          email: contactEmail,
          phone_number: contactPhone,
          excludeUserId: customerId,
        });
        if (!uniqueness.ok) {
          return res.status(409).json({
            success: false,
            status: 409,
            message: uniqueness.message,
          });
        }
      } catch (err) {
        console.error('mobile user update duplicate check', err.message);
        return res.status(500).json({
          success: false,
          status: 500,
          message: 'Internal server error.',
        });
      }
    }
  }

  next();
};

module.exports = {
  rateLimitSendOtp,
  validateVerifyOtp,
  userRequireMultipartMiddleware,
  userProfileImageSizeMiddleware,
  userUpdateMiddleware,
};
