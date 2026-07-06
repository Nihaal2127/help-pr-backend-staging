const mongoose = require('mongoose');
const User = require('../../../models/user');
const State = require('../../../models/state');
const City = require('../../../models/city');
const Area = require('../../../models/area');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const {
  parseJSONField,
  parseOptionalDateField,
  trimOptionalStringField,
} = require('../../../utils/multipart_parser');
const { fieldLabel } = require('../../../utils/field_labels');
const {
  normalizeUserEmail,
  normalizeUserPhone,
  checkUserContactUniqueness,
} = require('../../../utils/user_contact_uniqueness');

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 50;
const MIN_USER_AGE_YEARS = 18;
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
/** Local part: letters, digits, . _ - only; domain with TLD (min 2 letters). */
const EMAIL_REGEX = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
const BANK_IFSC_CODE_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PARTNER_PROFILE_IMAGE_MAX_BYTES = 512 * 1024;
const USER_TYPE_PARTNER = 2;
const PARTNER_VERIFICATION_STATUS_APPROVED = 2;

const PARTNER_DOCUMENT_FILE_FIELDS = [
  'vehicle_registration',
  'police_verification_certificate',
  'pan_card',
  'driving_license',
  'aadhar_card',
];

const AADHAR_CARD_FIELD = 'aadhar_card';

const hasPartnerDocumentFileUpload = (files) =>
  PARTNER_DOCUMENT_FILE_FIELDS.some((field) => files?.[field]?.[0]);

const isPresentBodyValue = (value) => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

/** Profile / catalog / bank fields in the body, or profile image file. */
const hasBasicUpdatePayload = (req) => {
  if (req.files?.image?.[0]) return true;
  const body = req.body || {};
  for (const key of PARTNER_BASIC_BODY_KEYS) {
    if (isPresentBodyValue(body[key])) return true;
  }
  return false;
};

/** Aadhar required only when at least one verification document file is uploaded. */
const requiresAadharCardFile = (req) => hasPartnerDocumentFileUpload(req.files);

const validateAadharCardFileRequired = (req, res) => {
  if (!req.files?.[AADHAR_CARD_FIELD]?.[0]) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Aadhar card is required.',
    });
    return false;
  }
  return true;
};

const validateProfileImageRequired = (req, res) => {
  if (!req.files?.image?.[0]) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Profile photo is required.',
    });
    return false;
  }
  return true;
};

const PARTNER_PROFILE_PHOTO_REQUIRED_BODY_KEYS = new Set([
  'gender',
  'experience',
  'state_id',
  'city_id',
  'area_id',
  'pincode',
  'address',
]);

const requiresProfilePhotoForUpdate = (req) => {
  const body = req.body || {};
  for (const key of PARTNER_PROFILE_PHOTO_REQUIRED_BODY_KEYS) {
    if (isPresentBodyValue(body[key])) return true;
  }
  return false;
};

const hasExistingProfilePhoto = (partner) => {
  const url = partner?.profile_url;
  return typeof url === 'string' && url.trim() !== '';
};

const PARTNER_UPDATE_SECTION = {
  ALL: 'all',
  BASIC: 'basic-details',
  DOCUMENTS: 'documents',
  BANKS: 'bank-accounts',
};

const PARTNER_BASIC_BODY_KEYS = new Set([
  'name',
  'email',
  'phone_number',
  'password',
  'confirm_password',
  'date_of_birth',
  'gender',
  'experience',
  'address',
  'state_id',
  'city_id',
  'area_id',
  'pincode',
  'profile_url',
  'device_token',
  'address_id',
  'address_status',
  'add_new_address',
  'is_additional_address',
  'contact_name',
  'contact_number',
  'partner_services',
  'partner-services',
  'partner_categories',
  'category_ids',
  'service_ids',
  'service_names',
  'service_descriptions',
  'service_prices',
  'service_taxes',
  'service_payment_types',
  'service_minimum_deposits',
]);

const PARTNER_BANK_BODY_KEYS = new Set([
  'bank_account',
  'bank_name',
  'branch_name',
  'account_holder_name',
  'account_name',
  'account_number',
  'ifsc_code',
  'primary_bank_account',
  'is_primary',
]);

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
  const partnerServicesAlias = req.body['partner-services'];
  if (
    partnerServicesAlias !== undefined &&
    partnerServicesAlias !== null &&
    (!Array.isArray(req.body.partner_services) || req.body.partner_services.length === 0)
  ) {
    req.body.partner_services = partnerServicesAlias;
  }
};

const parsePartnerBasicFields = (req) => {
  parsePartnerCatalogFields(req);
  parseJSONField(req, 'bank_account');
  parseOptionalDateField(req, 'date_of_birth');
  trimOptionalStringField(req, 'experience');
};

const parsePartnerDocumentFields = (_req) => {};

const parsePartnerBankFields = (req) => {
  parseJSONField(req, 'bank_account');
};

const rejectForeignPartnerUpdateFields = (req, res, section) => {
  if (section === PARTNER_UPDATE_SECTION.ALL) return true;

  let allowedBody = PARTNER_BASIC_BODY_KEYS;
  const allowedFiles = new Set();
  if (section === PARTNER_UPDATE_SECTION.BASIC) {
    allowedFiles.add('image');
  } else if (section === PARTNER_UPDATE_SECTION.DOCUMENTS) {
    allowedBody = new Set();
    for (const f of PARTNER_DOCUMENT_FILE_FIELDS) allowedFiles.add(f);
  } else if (section === PARTNER_UPDATE_SECTION.BANKS) {
    allowedBody = PARTNER_BANK_BODY_KEYS;
  }

  for (const key of Object.keys(req.body || {})) {
    if (!allowedBody.has(key)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: `Field "${key}" is not allowed on this update endpoint.`,
      });
      return false;
    }
  }

  const files = req.files || {};
  for (const key of Object.keys(files)) {
    if (!allowedFiles.has(key)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: `File "${key}" is not allowed on this update endpoint.`,
      });
      return false;
    }
  }

  return true;
};

const validatePartnerCatalogPayload = (req, res) => {
  if (req.body.partner_services !== undefined && !Array.isArray(req.body.partner_services)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('partner_services')} must be an array.`,
    });
    return false;
  }
  if (req.body.partner_categories !== undefined && !Array.isArray(req.body.partner_categories)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('partner_categories')} must be an array.`,
    });
    return false;
  }
  return true;
};

const parsePartnerNestedObject = (value) => {
  if (value === undefined || value === null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const pickPartnerUpdateValue = (req, keys) => {
  const bank = parsePartnerNestedObject(req.body.bank_account);
  for (const key of keys) {
    for (const source of [req.body, bank]) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return null;
};

const isPresentFieldValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

/** Step 1: exactly 24 hex chars (empty / wrong length / non-hex fail here). */
const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

const isEmptyCatalogId = (value) =>
  value === undefined || value === null || String(value).trim() === '';

const isValidCatalogObjectId = (value) => OBJECT_ID_HEX_24.test(String(value).trim());

const getCategoryStep1Error = (categoryId) => {
  if (isEmptyCatalogId(categoryId) || !isValidCatalogObjectId(categoryId)) {
    return 'Category is required.';
  }
  return null;
};

const getServiceStep1Error = (serviceId) => {
  if (isEmptyCatalogId(serviceId) || !isValidCatalogObjectId(serviceId)) {
    return 'Service is required.';
  }
  return null;
};

const respondPartnerCatalogValidationErrors = (res, messages) => {
  res.status(400).json({
    success: false,
    status: 400,
    message: (Array.isArray(messages) && messages[0]) || 'Validation failed.',
  });
  return false;
};

const hasPartnerCatalogPayload = (body) =>
  body.partner_services !== undefined ||
  body.partner_categories !== undefined ||
  body.service_ids !== undefined ||
  body.category_ids !== undefined ||
  body.service_descriptions !== undefined ||
  body.service_prices !== undefined;

const parseJsonIfString = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const hasBankPayload = (body) =>
  body.bank_account !== undefined ||
  body.bank_name !== undefined ||
  body.branch_name !== undefined ||
  body.account_holder_name !== undefined ||
  body.account_name !== undefined ||
  body.account_number !== undefined ||
  body.ifsc_code !== undefined;

const hasNonEmptyPartnerCatalogPayload = (body) => {
  if (body.partner_categories !== undefined) {
    const categories = Array.isArray(body.partner_categories)
      ? body.partner_categories
      : parseJsonIfString(body.partner_categories, []);
    if (Array.isArray(categories) && categories.length > 0) return true;
  }
  if (body.partner_services !== undefined) {
    const services = Array.isArray(body.partner_services)
      ? body.partner_services
      : parseJsonIfString(body.partner_services, []);
    if (Array.isArray(services) && services.length > 0) return true;
  }
  if (body.service_ids !== undefined) {
    const ids = Array.isArray(body.service_ids)
      ? body.service_ids
      : parseJsonIfString(body.service_ids, []);
    if (Array.isArray(ids) && ids.length > 0) return true;
  }
  return false;
};

const RESTRICTED_UNTIL_APPROVED_MESSAGE =
  'Category and services can only be updated after your account is verified and approved.';

const assertPartnerApprovedForRestrictedUpdates = (req, res, section, verificationStatus) => {
  if (Number(verificationStatus) === PARTNER_VERIFICATION_STATUS_APPROVED) {
    return true;
  }

  if (section === PARTNER_UPDATE_SECTION.BANKS) {
    res.status(403).json({
      success: false,
      status: 403,
      message: RESTRICTED_UNTIL_APPROVED_MESSAGE,
    });
    return false;
  }

  if (hasBankPayload(req.body) || hasPartnerCatalogPayload(req.body)) {
    res.status(403).json({
      success: false,
      status: 403,
      message: RESTRICTED_UNTIL_APPROVED_MESSAGE,
    });
    return false;
  }

  return true;
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

const validateBankPayloadIfPresent = (req, res) => {
  const body = req.body;
  if (!hasBankPayload(body)) return true;

  if (Array.isArray(body.bank_account)) {
    if (body.bank_account.length === 0) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'At least one bank account is required.',
      });
      return false;
    }
    const seenAccountNumbers = new Set();
    for (let i = 0; i < body.bank_account.length; i++) {
      const item = body.bank_account[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `bank_account[${i}] must be an object.`,
        });
        return false;
      }
      const missing = getMissingBankAccountFields(item);
      if (missing.length > 0) {
        res.status(400).json({
          success: false,
          status: 400,
          message: missing[0],
        });
        return false;
      }
      if (!validateBankAccountFormatFields(item, res, `bank_account[${i}]`)) {
        return false;
      }
      const accountNumber = String(item.account_number).trim();
      if (seenAccountNumbers.has(accountNumber)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: 'Duplicate account number in bank accounts.',
        });
        return false;
      }
      seenAccountNumbers.add(accountNumber);
    }
    return true;
  }

  const bankName = pickPartnerUpdateValue(req, ['bank_name']);
  if (!bankName) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Bank name is required.',
    });
    return false;
  }

  const branchName = pickPartnerUpdateValue(req, ['branch_name']);
  if (!branchName) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Branch name is required.',
    });
    return false;
  }

  const accountHolderName = pickPartnerUpdateValue(req, ['account_holder_name', 'account_name']);
  if (!accountHolderName) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Account holder name is required.',
    });
    return false;
  }

  const accountNumber = pickPartnerUpdateValue(req, ['account_number']);
  if (!accountNumber) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Account number is required.',
    });
    return false;
  }

  const ifscCode = pickPartnerUpdateValue(req, ['ifsc_code']);
  if (!ifscCode) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'IFSC code is required.',
    });
    return false;
  }

  if (
    !validateBankAccountFormatFields(
      { account_number: accountNumber, ifsc_code: ifscCode },
      res
    )
  ) {
    return false;
  }

  return true;
};

const getMissingFlatCatalogFields = (item) => {
  const missing = [];
  const categoryId = item?.category_id;
  const serviceId = item?.service_id ?? item?.serviceId;
  const categoryErr = getCategoryStep1Error(categoryId);
  if (categoryErr) missing.push(categoryErr);
  const serviceErr = getServiceStep1Error(serviceId);
  if (serviceErr) missing.push(serviceErr);
  if (!isPresentFieldValue(item?.description)) {
    missing.push('Description is required.');
  }
  if (!isPresentFieldValue(item?.price)) {
    missing.push('Price is required.');
  }
  return missing;
};

const getMissingNestedServiceFields = (svc) => {
  const missing = [];
  if (typeof svc === 'string' || typeof svc === 'number') {
    return ['Service is required.', 'Description is required.', 'Price is required.'];
  }
  if (!svc || typeof svc !== 'object' || Array.isArray(svc)) {
    return ['Service is required.', 'Description is required.', 'Price is required.'];
  }
  const serviceId = svc.service_id ?? svc.serviceId;
  const serviceErr = getServiceStep1Error(serviceId);
  if (serviceErr) missing.push(serviceErr);
  if (!isPresentFieldValue(svc.description)) {
    missing.push('Description is required.');
  }
  if (!isPresentFieldValue(svc.price)) {
    missing.push('Price is required.');
  }
  return missing;
};

const coerceSingleOidToArray = (body, field) => {
  const v = body[field];
  if (v === undefined || v === null || Array.isArray(v)) return;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t && isValidCatalogObjectId(t)) body[field] = [t];
  }
};

const validatePartnerCatalogIfPresent = (req, res) => {
  const body = req.body;
  if (!hasPartnerCatalogPayload(body)) {
    return true;
  }

  coerceSingleOidToArray(body, 'service_ids');
  coerceSingleOidToArray(body, 'category_ids');

  const partnerServices = body.partner_services;
  const hasPartnerServices = Array.isArray(partnerServices) && partnerServices.length > 0;

  if (hasPartnerServices) {
    if (!validatePartnerCatalogPayload(req, res)) return false;

    for (let i = 0; i < partnerServices.length; i++) {
      const item = partnerServices[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `${fieldLabel(`partner_services[${i}]`)} must be an object.`,
        });
        return false;
      }

      if (Array.isArray(item.services)) {
        const missing = [];
        const categoryErr = getCategoryStep1Error(item.category_id);
        if (categoryErr) missing.push(categoryErr);
        if (!Array.isArray(item.services) || item.services.length === 0) {
          missing.push('Service is required.');
        } else {
          for (let j = 0; j < item.services.length; j++) {
            const svcMissing = getMissingNestedServiceFields(item.services[j]);
            for (const msg of svcMissing) {
              if (!missing.includes(msg)) missing.push(msg);
            }
          }
        }
        if (missing.length > 0) {
          return respondPartnerCatalogValidationErrors(res, missing);
        }
        continue;
      }

      const flatMissing = getMissingFlatCatalogFields(item);
      if (flatMissing.length > 0) {
        return respondPartnerCatalogValidationErrors(res, flatMissing);
      }
    }
    return true;
  }

  if (body.service_ids === undefined && body.category_ids === undefined) {
    return true;
  }

  let serviceIds = body.service_ids;
  if (!Array.isArray(serviceIds) && typeof serviceIds === 'string') {
    const t = String(serviceIds).trim();
    if (t) serviceIds = [t];
  }

  let categoryIds = body.category_ids;
  if (!Array.isArray(categoryIds) && typeof categoryIds === 'string') {
    const t = String(categoryIds).trim();
    if (t) categoryIds = [t];
  }

  const descriptions = body.service_descriptions;
  const prices = body.service_prices;
  const parallelMissing = new Set();

  if (body.category_ids !== undefined) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      parallelMissing.add('Category is required.');
    }
  }
  if (body.service_ids !== undefined) {
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      parallelMissing.add('Service is required.');
    }
  }
  if (body.service_descriptions !== undefined && !Array.isArray(descriptions)) {
    parallelMissing.add('Description is required.');
  }
  if (body.service_prices !== undefined && !Array.isArray(prices)) {
    parallelMissing.add('Price is required.');
  }

  if (Array.isArray(serviceIds)) {
    for (let i = 0; i < serviceIds.length; i++) {
      const serviceErr = getServiceStep1Error(serviceIds[i]);
      if (serviceErr) parallelMissing.add(serviceErr);
      if (body.category_ids !== undefined) {
        const categoryId =
          Array.isArray(categoryIds) &&
          (i < categoryIds.length && categoryIds[i] != null && String(categoryIds[i]).trim() !== ''
            ? categoryIds[i]
            : categoryIds?.[categoryIds.length - 1]);
        const categoryErr = getCategoryStep1Error(categoryId);
        if (categoryErr) parallelMissing.add(categoryErr);
      }
      if (
        body.service_descriptions !== undefined &&
        Array.isArray(descriptions) &&
        !isPresentFieldValue(descriptions[i])
      ) {
        parallelMissing.add('Description is required.');
      }
      if (
        body.service_prices !== undefined &&
        Array.isArray(prices) &&
        !isPresentFieldValue(prices[i])
      ) {
        parallelMissing.add('Price is required.');
      }
    }
  }

  if (parallelMissing.size > 0) {
    return respondPartnerCatalogValidationErrors(res, [...parallelMissing]);
  }

  return true;
};

const collectPartnerCatalogRows = (body) => {
  const rows = [];
  const partnerServices = body.partner_services;
  if (Array.isArray(partnerServices) && partnerServices.length > 0) {
    for (const item of partnerServices) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (Array.isArray(item.services)) {
        const parentCategoryId = item.category_id;
        for (const svc of item.services) {
          if (!svc || typeof svc !== 'object' || Array.isArray(svc)) continue;
          const categoryId = svc.category_id ?? parentCategoryId;
          const serviceId = svc.service_id ?? svc.serviceId;
          if (getCategoryStep1Error(categoryId) || getServiceStep1Error(serviceId)) continue;
          rows.push({
            category_id: String(categoryId).trim(),
            service_id: String(serviceId).trim(),
          });
        }
      } else {
        const categoryId = item.category_id;
        const serviceId = item.service_id ?? item.serviceId;
        if (getCategoryStep1Error(categoryId) || getServiceStep1Error(serviceId)) continue;
        rows.push({
          category_id: String(categoryId).trim(),
          service_id: String(serviceId).trim(),
        });
      }
    }
    return rows;
  }

  let serviceIds = body.service_ids;
  if (!Array.isArray(serviceIds) && typeof serviceIds === 'string') {
    const t = String(serviceIds).trim();
    if (t) serviceIds = [t];
  }
  if (!Array.isArray(serviceIds)) return rows;

  let categoryIds = body.category_ids;
  if (!Array.isArray(categoryIds) && typeof categoryIds === 'string') {
    const t = String(categoryIds).trim();
    if (t) categoryIds = [t];
  }
  if (!Array.isArray(categoryIds)) return rows;

  for (let i = 0; i < serviceIds.length; i++) {
    const categoryId =
      i < categoryIds.length && categoryIds[i] != null && String(categoryIds[i]).trim() !== ''
        ? categoryIds[i]
        : categoryIds[categoryIds.length - 1];
    const serviceId = serviceIds[i];
    if (getCategoryStep1Error(categoryId) || getServiceStep1Error(serviceId)) continue;
    rows.push({
      category_id: String(categoryId).trim(),
      service_id: String(serviceId).trim(),
    });
  }
  return rows;
};

const validatePartnerLocationInDbPartial = async (body, res) => {
  const { state_id, city_id, area_id, pincode } = body;
  const hasState = state_id !== undefined && String(state_id).trim() !== '';
  const hasCity = city_id !== undefined && String(city_id).trim() !== '';
  const hasArea = area_id !== undefined && String(area_id).trim() !== '';
  const hasPincode = pincode !== undefined && String(pincode).trim() !== '';

  if (!hasState && !hasCity && !hasArea && !hasPincode) {
    return true;
  }

  let stateOid = null;
  let state = null;
  if (hasState) {
    if (!mongoose.Types.ObjectId.isValid(String(state_id))) {
      res.status(400).json({ success: false, status: 400, message: 'Invalid state id.' });
      return false;
    }
    stateOid = new mongoose.Types.ObjectId(String(state_id));
    state = await State.findOne({ _id: stateOid, deleted_at: null }).lean();
    if (!state) {
      res.status(400).json({ success: false, status: 400, message: 'State not found.' });
      return false;
    }
    if (state.is_active === false) {
      res.status(400).json({ success: false, status: 400, message: 'State is not active.' });
      return false;
    }
  }

  let cityOid = null;
  let city = null;
  if (hasCity) {
    if (!mongoose.Types.ObjectId.isValid(String(city_id))) {
      res.status(400).json({ success: false, status: 400, message: 'Invalid city id.' });
      return false;
    }
    cityOid = new mongoose.Types.ObjectId(String(city_id));
    city = await City.findOne({ _id: cityOid, deleted_at: null }).lean();
    if (!city) {
      res.status(400).json({ success: false, status: 400, message: 'City not found.' });
      return false;
    }
    if (hasState && String(city.state_id) !== String(stateOid)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'City does not belong to the selected state.',
      });
      return false;
    }
    if (city.is_active === false) {
      res.status(400).json({ success: false, status: 400, message: 'City is not active.' });
      return false;
    }
    if (!hasState) {
      stateOid = city.state_id;
    }
  }

  let areaOid = null;
  let area = null;
  if (hasArea) {
    if (!mongoose.Types.ObjectId.isValid(String(area_id))) {
      res.status(400).json({ success: false, status: 400, message: 'Invalid area id.' });
      return false;
    }
    areaOid = new mongoose.Types.ObjectId(String(area_id));
    area = await Area.findOne({ _id: areaOid, deleted_at: null }).lean();
    if (!area) {
      res.status(400).json({ success: false, status: 400, message: 'Area not found.' });
      return false;
    }
    if (hasCity && String(area.city_id) !== String(cityOid)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Area does not belong to the selected city.',
      });
      return false;
    }
    if (hasState && String(area.state_id) !== String(stateOid)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Area does not belong to the selected state.',
      });
      return false;
    }
    if (area.is_active === false) {
      res.status(400).json({ success: false, status: 400, message: 'Area is not active.' });
      return false;
    }
  }

  if (hasPincode) {
    if (!hasArea) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Area is required when pincode is provided.',
      });
      return false;
    }
    const pincodeValue = String(pincode).trim();
    const areaPincodes = Array.isArray(area.pincodes)
      ? area.pincodes.map((p) => String(p).trim())
      : [];
    if (!areaPincodes.includes(pincodeValue)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Pincode is not valid for the selected area.',
      });
      return false;
    }
  }

  return true;
};

const validatePartnerCatalogInDb = async (req, res) => {
  if (!hasPartnerCatalogPayload(req.body)) {
    return true;
  }
  const rows = collectPartnerCatalogRows(req.body);
  const seen = new Set();

  for (const row of rows) {
    const categoryId = row.category_id;
    const serviceId = row.service_id;
    if (getCategoryStep1Error(categoryId) || getServiceStep1Error(serviceId)) continue;

    const dedupeKey = `${String(categoryId).trim()}:${String(serviceId).trim()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const category = await Category.findOne({
      _id: categoryId,
      deleted_at: null,
    }).lean();
    if (!category) {
      return respondPartnerCatalogValidationErrors(res, ['Category not found.']);
    }
    if (
      !category.is_active ||
      category.is_request ||
      category.approval_status !== 'approve'
    ) {
      return respondPartnerCatalogValidationErrors(res, ['Category is not available.']);
    }

    const service = await Service.findOne({
      _id: serviceId,
      deleted_at: null,
    }).lean();
    if (!service) {
      return respondPartnerCatalogValidationErrors(res, ['Service not found.']);
    }
    if (String(service.category_id) !== String(categoryId)) {
      return respondPartnerCatalogValidationErrors(res, [
        'Service does not belong to the selected category.',
      ]);
    }
    if (
      !service.is_active ||
      service.is_request ||
      service.approval_status !== 'approve'
    ) {
      return respondPartnerCatalogValidationErrors(res, ['Service is not available.']);
    }
  }

  return true;
};

const validatePartnerBasicPartialFields = async (req, res) => {
  const { address, state_id, city_id, area_id, pincode, gender, experience } = req.body;

  if (address !== undefined && String(address).trim() === '') {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Address is required.',
    });
    return false;
  }

  if (state_id !== undefined && String(state_id).trim() === '') {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'State is required.',
    });
    return false;
  }
  if (
    state_id !== undefined &&
    String(state_id).trim() !== '' &&
    !mongoose.Types.ObjectId.isValid(String(state_id))
  ) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid state id.',
    });
    return false;
  }

  if (city_id !== undefined && String(city_id).trim() === '') {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'City is required.',
    });
    return false;
  }
  if (
    city_id !== undefined &&
    String(city_id).trim() !== '' &&
    !mongoose.Types.ObjectId.isValid(String(city_id))
  ) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid city id.',
    });
    return false;
  }

  if (area_id !== undefined && String(area_id).trim() === '') {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Area is required.',
    });
    return false;
  }
  if (
    area_id !== undefined &&
    String(area_id).trim() !== '' &&
    !mongoose.Types.ObjectId.isValid(String(area_id))
  ) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid area id.',
    });
    return false;
  }

  if (pincode !== undefined && String(pincode).trim() === '') {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'Pincode is required.',
    });
    return false;
  }

  if (gender !== undefined) {
    if (gender === null || String(gender).trim() === '') {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Gender is required.',
      });
      return false;
    }
    if (!isValidGender(gender)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'gender must be "male", "female", or "other".',
      });
      return false;
    }
    req.body.gender = normalizeGender(gender);
  }

  if (experience !== undefined) {
    if (experience === null || String(experience).trim() === '') {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'Experience is required.',
      });
      return false;
    }
    req.body.experience = String(experience).trim();
  }

  if (!validatePartnerCatalogIfPresent(req, res)) return false;

  if (!(await validatePartnerLocationInDbPartial(req.body, res))) {
    return false;
  }
  if (!(await validatePartnerCatalogInDb(req, res))) {
    return false;
  }

  return true;
};

const validatePartnerDocumentsPayload = (req, res) => validateAadharCardFileRequired(req, res);

const validatePartnerBankAccountsPayload = (req, res) => {
  if (!hasBankPayload(req.body)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'bank_account is required.',
    });
    return false;
  }
  return validateBankPayloadIfPresent(req, res);
};

const validatePartnerUpdatePartialFields = async (req, res, partner) => {
  const mustUploadProfilePhoto =
    requiresProfilePhotoForUpdate(req) && !hasExistingProfilePhoto(partner);
  if (mustUploadProfilePhoto && !validateProfileImageRequired(req, res)) return false;
  if (!(await validatePartnerBasicPartialFields(req, res))) return false;
  if (!validateBankPayloadIfPresent(req, res)) return false;
  if (requiresAadharCardFile(req) && !validateAadharCardFileRequired(req, res)) {
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

const capitalizePersonName = (name) =>
  String(name)
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

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
  return capitalizePersonName(trimmed);
};

const partnerRegisterMiddleware = async (req, res, next) => {
  try {
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
  const normalizedEmail = normalizeUserEmail(email);
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.',
    });
  }
  req.body.email = normalizedEmail;

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  const normalizedPhone = normalizeUserPhone(phone_number);
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
    console.log('[partner.register] middleware: duplicate check starting', {
      email: normalizedEmail,
      phone_number: normalizedPhone,
    });
    const uniqueness = await checkUserContactUniqueness({
      email: normalizedEmail,
      phone_number: normalizedPhone,
    });
    if (!uniqueness.ok) {
      console.log('[partner.register] middleware: duplicate found', { message: uniqueness.message });
      return res.status(409).json({
        success: false,
        status: 409,
        message: uniqueness.message,
      });
    }
    console.log('[partner.register] middleware: validation passed, calling register handler');
  } catch (err) {
    console.error('[partner.register] middleware: duplicate check threw', {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      debug: {
        step: 'middleware_duplicate_check',
        error: err.message,
        name: err.name,
        ...(err.code !== undefined ? { code: err.code } : {}),
      },
    });
  }

  next();
  } catch (err) {
    console.error('[partner.register] middleware: unhandled error', {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      debug: {
        step: 'middleware_unhandled',
        error: err.message,
        name: err.name,
        ...(err.code !== undefined ? { code: err.code } : {}),
      },
    });
  }
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

const partnerGoogleLoginMiddleware = async (req, res, next) => {
  const { id_token, phone_number, date_of_birth } = req.body;

  if (id_token === undefined || id_token === null || String(id_token).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'id_token is required.',
    });
  }
  req.body.id_token = String(id_token).trim();

  if (phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== '') {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    const normalizedPhone = normalizeUserPhone(phone_number);
    if (!phoneRegex.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid phone number format.',
      });
    }
    req.body.phone_number = normalizedPhone;
  } else {
    delete req.body.phone_number;
  }

  if (date_of_birth !== undefined && date_of_birth !== null && String(date_of_birth).trim() !== '') {
    const validatedDob = validateDateOfBirth(date_of_birth, res);
    if (validatedDob === null) return;
    req.body.date_of_birth = validatedDob;
  } else {
    delete req.body.date_of_birth;
  }

  next();
};

const partnerAppleLoginMiddleware = async (req, res, next) => {
  const { id_token, phone_number, date_of_birth, name } = req.body;

  if (id_token === undefined || id_token === null || String(id_token).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'id_token is required.',
    });
  }
  req.body.id_token = String(id_token).trim();

  if (phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== '') {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    const normalizedPhone = normalizeUserPhone(phone_number);
    if (!phoneRegex.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid phone number format.',
      });
    }
    req.body.phone_number = normalizedPhone;
  } else {
    delete req.body.phone_number;
  }

  if (date_of_birth !== undefined && date_of_birth !== null && String(date_of_birth).trim() !== '') {
    const validatedDob = validateDateOfBirth(date_of_birth, res);
    if (validatedDob === null) return;
    req.body.date_of_birth = validatedDob;
  } else {
    delete req.body.date_of_birth;
  }

  if (name !== undefined && name !== null && String(name).trim() !== '') {
    req.body.name = String(name).trim();
  } else {
    delete req.body.name;
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

const runPartnerUpdateIdentityChecks = async (req, res) => {
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
    const normalizedEmail = normalizeUserEmail(email);
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
    const normalizedPhone = normalizeUserPhone(phone_number);
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
  if (mongoose.Types.ObjectId.isValid(partnerId)) {
    const contactEmail = email !== undefined ? req.body.email : undefined;
    const contactPhone = phone_number !== undefined ? req.body.phone_number : undefined;
    if (contactEmail !== undefined || contactPhone !== undefined) {
      try {
        const uniqueness = await checkUserContactUniqueness({
          email: contactEmail,
          phone_number: contactPhone,
          excludeUserId: partnerId,
        });
        if (!uniqueness.ok) {
          return res.status(409).json({
            success: false,
            status: 409,
            message: uniqueness.message,
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
  }

  return true;
};

const createPartnerUpdateMiddleware = (section) => {
  const runSectionValidation = async (req, res, partner) => {
    if (section === PARTNER_UPDATE_SECTION.BASIC) {
      return validatePartnerBasicPartialFields(req, res);
    }
    if (section === PARTNER_UPDATE_SECTION.DOCUMENTS) {
      return validatePartnerDocumentsPayload(req, res);
    }
    if (section === PARTNER_UPDATE_SECTION.BANKS) {
      return validatePartnerBankAccountsPayload(req, res);
    }
    return validatePartnerUpdatePartialFields(req, res, partner);
  };

  return async (req, res, next) => {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Access denied. No token provided.',
      });
    }

    let partner;
    try {
      partner = await User.findOne({ _id: req.user.id, deleted_at: null })
        .select('type verification_status profile_url')
        .lean();
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
    delete req.body.partner_subscription;
    delete req.body.subscription_plan_id;

    if (section === PARTNER_UPDATE_SECTION.DOCUMENTS) {
      parsePartnerDocumentFields(req);
    } else if (section === PARTNER_UPDATE_SECTION.BANKS) {
      parsePartnerBankFields(req);
    } else {
      parsePartnerBasicFields(req);
    }

    if (req.body.partner_documents !== undefined) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'partner_documents is not supported. Upload verification document files instead.',
      });
    }

    if (!rejectForeignPartnerUpdateFields(req, res, section)) {
      return;
    }

    if (!assertPartnerApprovedForRestrictedUpdates(req, res, section, partner.verification_status)) {
      return;
    }

    try {
      if (!(await runSectionValidation(req, res, partner))) {
        return;
      }
    } catch (err) {
      console.error('partnerUpdateMiddleware validation', err.message);
      return res.status(500).json({
        success: false,
        status: 500,
        message: 'Internal server error.',
      });
    }

    if (section === PARTNER_UPDATE_SECTION.BASIC || section === PARTNER_UPDATE_SECTION.ALL) {
      const identityOk = await runPartnerUpdateIdentityChecks(req, res);
      if (identityOk !== true) {
        return;
      }
    }

    req.partnerUpdateSection = section;
    return next();
  };
};

const partnerUpdateMiddleware = createPartnerUpdateMiddleware(PARTNER_UPDATE_SECTION.ALL);
const partnerUpdateBasicDetailsMiddleware = createPartnerUpdateMiddleware(PARTNER_UPDATE_SECTION.BASIC);
const partnerUpdateDocumentsMiddleware = createPartnerUpdateMiddleware(PARTNER_UPDATE_SECTION.DOCUMENTS);
const partnerUpdateBankAccountsMiddleware = createPartnerUpdateMiddleware(PARTNER_UPDATE_SECTION.BANKS);

module.exports = {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
  partnerGoogleLoginMiddleware,
  partnerAppleLoginMiddleware,
  partnerUpdateMiddleware,
  partnerUpdateBasicDetailsMiddleware,
  partnerUpdateDocumentsMiddleware,
  partnerUpdateBankAccountsMiddleware,
  partnerProfileImageSizeMiddleware,
  partnerRequireMultipartMiddleware,
  PARTNER_UPDATE_SECTION,
  PARTNER_DOCUMENT_FILE_FIELDS,
};
