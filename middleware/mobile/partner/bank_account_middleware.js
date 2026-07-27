const mongoose = require('mongoose');
const User = require('../../../models/user');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');

const PARTNER_VERIFICATION_STATUS_APPROVED = 2;
const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
const BANK_IFSC_CODE_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const RESTRICTED_UNTIL_APPROVED_MESSAGE =
  'Catalog, services, and bank details can only be updated after your account is verified and approved.';

const BANK_ACCOUNT_BODY_FIELDS = [
  'bank_name',
  'branch_name',
  'account_holder_name',
  'account_name',
  'account_number',
  'ifsc_code',
  'is_primary',
  'primary_bank_account',
];

const isPresentFieldValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

const parseOptionalBoolean = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

const getMissingBankAccountFields = (item) => {
  const missing = [];
  if (!isPresentFieldValue(item?.bank_name)) missing.push('Bank name is required.');
  if (!isPresentFieldValue(item?.branch_name)) missing.push('Branch name is required.');
  if (!isPresentFieldValue(item?.account_holder_name) && !isPresentFieldValue(item?.account_name)) {
    missing.push('Account holder name is required.');
  }
  if (!isPresentFieldValue(item?.account_number)) missing.push('Account number is required.');
  if (!isPresentFieldValue(item?.ifsc_code)) missing.push('IFSC code is required.');
  return missing;
};

const validateBankAccountFormatFields = (item, res, indexLabel = '') => {
  const prefix = indexLabel ? `${indexLabel} ` : '';
  const accountNumber = String(item?.account_number ?? '').trim();
  if (!BANK_ACCOUNT_NUMBER_REGEX.test(accountNumber)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: `${prefix}Account number must be 9 to 18 digits only.`,
    });
    return false;
  }
  const ifscCode = String(item?.ifsc_code ?? '').trim().toUpperCase();
  if (!BANK_IFSC_CODE_REGEX.test(ifscCode)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: `${prefix}Invalid IFSC code format.`,
    });
    return false;
  }
  return true;
};

const assertApprovedPartner = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.user?.id))) {
    res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid token.',
    });
    return false;
  }

  const partner = await User.findOne({
    _id: req.user.id,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  }).select('verification_status');

  if (!partner) {
    res.status(404).json({
      success: false,
      status: 404,
      message: 'Partner not found.',
    });
    return false;
  }

  if (Number(partner.verification_status) !== PARTNER_VERIFICATION_STATUS_APPROVED) {
    res.status(403).json({
      success: false,
      status: 403,
      message: RESTRICTED_UNTIL_APPROVED_MESSAGE,
    });
    return false;
  }

  return true;
};

const partnerBankAccountApprovedMiddleware = async (req, res, next) => {
  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) return;
    return next();
  } catch (err) {
    console.error('partnerBankAccountApprovedMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const partnerValidateBankAccountIdMiddleware = (req, res, next) => {
  const id = req.params.id != null ? String(req.params.id).trim() : '';
  if (!id || !OBJECT_ID_HEX_24.test(id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid bank account id.',
    });
  }
  return next();
};

const rejectDisallowedBankAccountFields = (req, res) => {
  for (const key of Object.keys(req.body || {})) {
    if (!BANK_ACCOUNT_BODY_FIELDS.includes(key)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: `Field "${key}" is not allowed on this endpoint.`,
      });
      return false;
    }
  }
  return true;
};

const partnerCreateBankAccountMiddleware = async (req, res, next) => {
  if (!rejectDisallowedBankAccountFields(req, res)) return;

  const missing = getMissingBankAccountFields(req.body);
  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: missing[0],
    });
  }

  if (!validateBankAccountFormatFields(req.body, res)) {
    return;
  }

  const parsedPrimary = parseOptionalBoolean(
    req.body.is_primary ?? req.body.primary_bank_account
  );
  if (parsedPrimary === null) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'is_primary must be true or false.',
    });
  }

  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) return;
    return next();
  } catch (err) {
    console.error('partnerCreateBankAccountMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const partnerUpdateBankAccountMiddleware = async (req, res, next) => {
  if (!rejectDisallowedBankAccountFields(req, res)) return;

  const hasAnyField = BANK_ACCOUNT_BODY_FIELDS.some((key) => req.body[key] !== undefined);
  if (!hasAnyField) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'At least one bank account field is required.',
    });
  }

  const candidate = {
    bank_name: req.body.bank_name,
    branch_name: req.body.branch_name,
    account_holder_name: req.body.account_holder_name ?? req.body.account_name,
    account_number: req.body.account_number,
    ifsc_code: req.body.ifsc_code,
  };

  if (
    candidate.bank_name !== undefined &&
    !isPresentFieldValue(candidate.bank_name)
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Bank name is required.',
    });
  }
  if (
    candidate.branch_name !== undefined &&
    !isPresentFieldValue(candidate.branch_name)
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Branch name is required.',
    });
  }
  if (
    candidate.account_holder_name !== undefined &&
    !isPresentFieldValue(candidate.account_holder_name)
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account holder name is required.',
    });
  }
  if (
    candidate.account_number !== undefined &&
    !isPresentFieldValue(candidate.account_number)
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account number is required.',
    });
  }
  if (candidate.ifsc_code !== undefined && !isPresentFieldValue(candidate.ifsc_code)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'IFSC code is required.',
    });
  }

  if (candidate.account_number !== undefined) {
    const accountNumber = String(candidate.account_number).trim();
    if (!BANK_ACCOUNT_NUMBER_REGEX.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Account number must be 9 to 18 digits only.',
      });
    }
  }
  if (candidate.ifsc_code !== undefined) {
    const ifscCode = String(candidate.ifsc_code).trim().toUpperCase();
    if (!BANK_IFSC_CODE_REGEX.test(ifscCode)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid IFSC code format.',
      });
    }
  }

  const parsedPrimary = parseOptionalBoolean(
    req.body.is_primary ?? req.body.primary_bank_account
  );
  if (parsedPrimary === null) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'is_primary must be true or false.',
    });
  }

  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) return;
    return next();
  } catch (err) {
    console.error('partnerUpdateBankAccountMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  partnerBankAccountApprovedMiddleware,
  partnerValidateBankAccountIdMiddleware,
  partnerCreateBankAccountMiddleware,
  partnerUpdateBankAccountMiddleware,
};
