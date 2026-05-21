const User = require('../../../models/user');

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 50;
const MIN_USER_AGE_YEARS = 18;
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
/** Local part: letters, digits, . _ - only; domain with TLD (min 2 letters). */
const EMAIL_REGEX = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

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

module.exports = {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
};
