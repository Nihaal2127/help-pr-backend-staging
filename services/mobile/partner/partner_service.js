const mongoose = require('mongoose');
const User = require('../../../models/user');
const Address = require('../../../models/address');
const PartnerDocument = require('../../../models/partner_document');
const PartnerBankAccount = require('../../../models/partner_bank_account');
const notificationSetting = require('../../../models/notification_settings');
const SubscriptionPlan = require('../../../models/subscription_plan');
const PartnerSubscription = require('../../../models/partner_subscription');
const Franchise = require('../../../models/franchise');
const { getNewId } = require('../../../helper/id_generator');
const { getDocumentList } = require('../../../controllers/document_controller');
const {
  createMultiple,
  getPartnerDocumentList,
} = require('../../../controllers/partner_document_controller');
const PartnerCategory = require('../../../models/partner_category');
const PartnerService = require('../../../models/partner_service');
const { handleImageUpload } = require('../../../helper/image_uploader');
const { getUploadType } = require('../../../enum/upload_type_enum');
const {
  normalizeUserEmail,
  normalizeUserPhone,
  checkUserContactUniqueness,
} = require('../../../utils/user_contact_uniqueness');
const { escapeRegExp } = require('../../../utils/string_helpers');
const { verifyGoogleIdToken, GOOGLE_APP_PARTNER } = require('../../../helper/google_auth');
const { verifyAppleIdToken, APPLE_APP_PARTNER } = require('../../../helper/apple_auth');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { fail, okWithData, okPass } = require('../../../utils/mobile_service_result');
const { attachPartnerRatingFields } = require('../../../utils/rating_format');
const { getPartnerEngagementCounts } = require('../../partner_post_common_service');
const { safeNotifyBackofficePartnerPending } = require('../../../src/modules/notifications/services/backofficeHooks');
const {
  partnerDocumentFieldsAfterImageUpload,
  applyPartnerUserStatusAfterDocumentUpload,
} = require('../../../utils/partner_document_status');
const DEFAULT_PARTNER_PLAN_NAME = 'basic';
const REGISTRATION_TYPE_NORMAL = 1;
const REGISTRATION_TYPE_GOOGLE = 2;
const REGISTRATION_TYPE_APPLE = 3;

const VERIFICATION_STATUS_MESSAGES = {
  1: 'Your profile is under verification. We will notify you once it is approved.',
  2: 'Your account is approved.',
  3: 'Your registration was rejected. Please contact support or update your documents.',
};

const verificationStatusToMessage = (status) => {
  const n = Number(status);
  return VERIFICATION_STATUS_MESSAGES[n] ?? null;
};

const PARTNER_DOCUMENT_FILE_FIELDS = [
  'vehicle_registration',
  'police_verification_certificate',
  'pan_card',
  'driving_license',
  'aadhar_card',
];

const MOBILE_PARTNER_ALLOWED_UPDATE_FIELDS = new Set([
  'name',
  'email',
  'phone_number',
  'address',
  'state_id',
  'city_id',
  'area_id',
  'pincode',
  'profile_url',
  'device_token',
  'password',
  'date_of_birth',
  'gender',
  'experience',
]);

const parseBooleanInput = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
};

const parseJsonIfString = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
};

const findPartnerAddressForUpdate = async (userId, addressId) => {
  if (
    addressId !== undefined &&
    addressId !== null &&
    String(addressId).trim() !== '' &&
    mongoose.Types.ObjectId.isValid(String(addressId))
  ) {
    return Address.findOne({
      _id: addressId,
      user_id: userId,
      deleted_at: null,
    });
  }
  return Address.findOne({ user_id: userId, deleted_at: null }).sort({ created_at: 1 });
};

const createAddressRecord = async ({
  userId,
  name,
  phoneNumber,
  address,
  stateId,
  cityId,
  areaId,
  pincode,
  addressStatus,
}) => {
  if (!address || !stateId || !cityId || !pincode) return null;
  return Address.create({
    user_id: userId,
    contact_name: name ?? '',
    contact_number: phoneNumber ?? '',
    address,
    state_id: stateId,
    city_id: cityId,
    ...(areaId && mongoose.Types.ObjectId.isValid(String(areaId)) ? { area_id: areaId } : {}),
    pincode,
    address_status: addressStatus === undefined ? true : parseBooleanInput(addressStatus),
  });
};

const normalizePartnerServices = (payload) => {
  const parsed = parseJsonIfString(payload, []);
  if (!Array.isArray(parsed)) return [];
  const rows = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const categoryIsActive = item.is_active !== undefined ? item.is_active !== false : true;
    if (Array.isArray(item.services)) {
      const parentCategoryId = item.category_id ?? null;
      for (const svc of item.services) {
        if (svc === undefined || svc === null) continue;
        let sid = null;
        let description = '';
        let price = null;
        let payment_type = '';
        let tax = null;
        let minimum_deposit = null;
        let serviceIsActive = true;
        if (typeof svc === 'string' || typeof svc === 'number') {
          const s = String(svc).trim();
          if (mongoose.Types.ObjectId.isValid(s)) sid = s;
        } else if (typeof svc === 'object' && !Array.isArray(svc)) {
          sid = svc.service_id ?? svc.serviceId ?? null;
          description = svc.description != null ? String(svc.description) : '';
          price = svc.price;
          payment_type = svc.payment_type != null ? String(svc.payment_type).trim() : '';
          tax = svc.tax;
          minimum_deposit = svc.minimum_deposit;
          if (svc.is_active !== undefined) serviceIsActive = svc.is_active !== false;
        }
        if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) continue;
        rows.push({
          category_id:
            svc && typeof svc === 'object' && !Array.isArray(svc) && svc.category_id
              ? svc.category_id
              : parentCategoryId,
          service_id: sid,
          description,
          price,
          payment_type,
          tax,
          minimum_deposit,
          is_active: serviceIsActive,
          category_is_active: categoryIsActive,
        });
      }
    } else {
      const sid = item.service_id ?? item.serviceId ?? null;
      if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) continue;
      rows.push({
        category_id: item.category_id ?? null,
        service_id: sid,
        description: item.description != null ? String(item.description) : '',
        price: item.price,
        payment_type: item.payment_type != null ? String(item.payment_type).trim() : '',
        tax: item.tax,
        minimum_deposit: item.minimum_deposit,
        is_active: item.is_active !== undefined ? item.is_active !== false : true,
        category_is_active: categoryIsActive,
      });
    }
  }
  return rows;
};

const hasPartnerCatalogPayload = (body) =>
  body.partner_services !== undefined ||
  body.partner_categories !== undefined ||
  body.service_ids !== undefined ||
  body.category_ids !== undefined ||
  body.service_descriptions !== undefined ||
  body.service_prices !== undefined;

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

const buildPartnerServicesFromParallelFields = (body) => {
  const coerceArray = (val, fallback = []) => {
    if (Array.isArray(val)) return val;
    if (val === undefined || val === null) return fallback;
    return parseJsonIfString(val, fallback);
  };
  let ids = coerceArray(body.service_ids, []);
  if (
    ids.length === 0 &&
    typeof body.service_ids === 'string' &&
    mongoose.Types.ObjectId.isValid(String(body.service_ids).trim())
  ) {
    ids = [String(body.service_ids).trim()];
  }
  let cats = coerceArray(body.category_ids, []);
  if (
    cats.length === 0 &&
    typeof body.category_ids === 'string' &&
    mongoose.Types.ObjectId.isValid(String(body.category_ids).trim())
  ) {
    cats = [String(body.category_ids).trim()];
  }
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const descs = coerceArray(body.service_descriptions, []);
  const prices = coerceArray(body.service_prices, []);
  const taxes = coerceArray(body.service_taxes, []);
  const paymentTypes = coerceArray(body.service_payment_types, []);
  const minimumDeposits = coerceArray(body.service_minimum_deposits, []);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const sid = ids[i];
    if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) continue;
    const cat =
      i < cats.length && cats[i] != null && String(cats[i]).trim() !== ''
        ? cats[i]
        : cats.length > 0
          ? cats[cats.length - 1]
          : null;
    rows.push({
      category_id: cat != null && mongoose.Types.ObjectId.isValid(String(cat)) ? cat : null,
      service_id: sid,
      description: descs[i] != null ? String(descs[i]) : '',
      price: prices[i] != null ? prices[i] : null,
      tax: taxes[i] != null ? taxes[i] : null,
      payment_type: paymentTypes[i] != null ? String(paymentTypes[i]).trim() : '',
      minimum_deposit: minimumDeposits[i] != null ? minimumDeposits[i] : null,
      is_active: true,
      category_is_active: true,
    });
  }
  return rows;
};

const resolvePartnerServicesInputFromBody = (body) => {
  const partner_services = body.partner_services;
  const psArr = Array.isArray(partner_services) ? partner_services : [];
  const hasPartnerServicesPayload = psArr.length > 0;
  const pcArr = Array.isArray(body.partner_categories) ? body.partner_categories : [];
  const hasPartnerCategoriesPayload = pcArr.length > 0;
  const hasParallelIds =
    (Array.isArray(body.service_ids) && body.service_ids.length > 0) ||
    (typeof body.service_ids === 'string' && String(body.service_ids).trim() !== '');

  if (hasPartnerServicesPayload) return partner_services;
  if (body.partner_services !== undefined) return partner_services;
  if (!hasPartnerServicesPayload && hasParallelIds) {
    return buildPartnerServicesFromParallelFields(body);
  }
  if (!hasPartnerServicesPayload && !hasParallelIds && hasPartnerCategoriesPayload) {
    return pcArr;
  }
  if (body.partner_categories !== undefined) return pcArr;
  if (body.service_ids !== undefined) return buildPartnerServicesFromParallelFields(body);
  return null;
};

const normalizePartnerDocuments = (payload) => {
  const parsed = parseJsonIfString(payload, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const aliasMap = {
    vehicle_registration: 'vehicle registration',
    police_verification_certificate: 'police verification certificate',
    pan_card: 'pan card',
    driving_license: 'driving license',
    aadhar_card: 'aadhar card',
    aadhaar_card: 'aadhar card',
  };
  const normalized = {};
  Object.entries(parsed).forEach(([key, value]) => {
    const normalizedKey = String(key).trim().toLowerCase();
    normalized[aliasMap[normalizedKey] || normalizedKey] = value;
  });
  return normalized;
};

const normalizeOnePartnerBankAccount = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rawPrimary = parsed.is_primary ?? parsed.primary_bank_account ?? false;
  const normalizedPrimary =
    typeof rawPrimary === 'string' ? rawPrimary.trim().toLowerCase() === 'true' : rawPrimary === true;
  const accountNumber =
    parsed.account_number != null ? String(parsed.account_number).trim() : '';
  if (!accountNumber) return null;
  return {
    account_holder_name: String(parsed.account_holder_name ?? parsed.account_name ?? '').trim(),
    account_number: accountNumber,
    ifsc_code: String(parsed.ifsc_code ?? '').trim().toUpperCase(),
    bank_name: String(parsed.bank_name ?? '').trim(),
    branch_name: String(parsed.branch_name ?? '').trim(),
    is_primary: normalizedPrimary,
  };
};

const normalizePartnerBankAccount = (payload) => {
  const { accounts } = resolvePartnerBankInputFromBody({ bank_account: payload });
  return accounts[0] ?? null;
};

const toOid = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
};

const coerceNumber = (v, defaultVal = 0) => {
  if (v === undefined || v === null || v === '') return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
};

async function mergeMobilePartnerCatalogFromNormalizedRows(partnerId, normalizedRows) {
  const partnerOid = toOid(partnerId);
  if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) return;

  const byCat = new Map();
  const latestByService = new Map();

  for (const row of normalizedRows) {
    if (!row?.category_id || !row?.service_id) continue;
    const categoryKey = String(row.category_id);
    const serviceKey = String(row.service_id);
    if (!byCat.has(categoryKey)) byCat.set(categoryKey, new Set());
    byCat.get(categoryKey).add(serviceKey);
    latestByService.set(serviceKey, row);
  }

  const now = new Date();

  // partner_categories behavior for mobile:
  // - new category => insert new document
  // - existing category => keep row, append new service ids, bump updated_at
  for (const [catStr, serviceSet] of byCat) {
    const catOid = toOid(catStr);
    const serviceOids = [...serviceSet].map((id) => toOid(id));
    await PartnerCategory.findOneAndUpdate(
      {
        partner_id: partnerOid,
        category_id: catOid,
        deleted_at: null,
      },
      {
        $setOnInsert: {
          partner_id: partnerOid,
          category_id: catOid,
          is_active: true,
          created_at: now,
          deleted_at: null,
        },
        $set: { updated_at: now },
        $addToSet: { services: { $each: serviceOids } },
      },
      { upsert: true, new: true }
    );
  }

  // keep partner_service additive too (no delete/replace)
  for (const [serviceStr, row] of latestByService) {
    const serviceOid = toOid(serviceStr);
    const categoryOid = toOid(row.category_id);
    const updateFields = {
      category_id: categoryOid,
      description: row.description != null ? String(row.description) : '',
      price: coerceNumber(row.price, 0),
      payment_type: row.payment_type != null ? String(row.payment_type).trim() : '',
      tax: coerceNumber(row.tax, 0),
      minimum_deposit: coerceNumber(row.minimum_deposit, 0),
      is_active: row.is_active !== false,
      is_accept_request: true,
      updated_at: now,
      deleted_at: null,
    };

    const existing = await PartnerService.findOne({
      partner_id: partnerOid,
      service_id: serviceOid,
      deleted_at: null,
    });

    if (existing) {
      Object.assign(existing, updateFields);
      await existing.save();
      continue;
    }

    await PartnerService.create({
      partner_id: partnerOid,
      service_id: serviceOid,
      ...updateFields,
      created_at: now,
    });
  }
}

const resolvePartnerBankInputFromBody = (body) => {
  const hasFlatBankFields =
    body.bank_name !== undefined ||
    body.branch_name !== undefined ||
    body.account_holder_name !== undefined ||
    body.account_name !== undefined ||
    body.account_number !== undefined ||
    body.ifsc_code !== undefined;

  let raw = body.bank_account;
  if (raw === undefined && hasFlatBankFields) {
    raw = {
      account_name: body.account_name,
      account_holder_name: body.account_holder_name,
      account_number: body.account_number,
      ifsc_code: body.ifsc_code,
      bank_name: body.bank_name,
      branch_name: body.branch_name,
      primary_bank_account: body.primary_bank_account,
      is_primary: body.is_primary,
    };
  }

  const parsed = parseJsonIfString(raw, raw);
  const isArrayPayload = Array.isArray(parsed);
  const accounts = [];

  if (isArrayPayload) {
    for (const item of parsed) {
      const row = normalizeOnePartnerBankAccount(item);
      if (row) accounts.push(row);
    }
  } else {
    const row = normalizeOnePartnerBankAccount(parsed);
    if (row) accounts.push(row);
  }

  return { accounts, isArrayPayload };
};

const mergePartnerDocumentPayloadFromMultipart = async (files) => {
  const merged = {};
  const fileMap = files || {};
  for (const field of PARTNER_DOCUMENT_FILE_FIELDS) {
    const arr = fileMap[field];
    if (!arr || !arr[0]) continue;
    merged[field] = await handleImageUpload(arr[0], getUploadType(4), true, null);
  }
  return merged;
};

async function applyPartnerDocumentImageUpdates(partnerId, normalizedDocumentPayload) {
  if (!normalizedDocumentPayload || Object.keys(normalizedDocumentPayload).length === 0) {
    return false;
  }
  const documentList = await getDocumentList();
  const documentNameToId = new Map();
  for (const doc of documentList) {
    const id = String(doc._id);
    const lower = String(doc.name || '').trim().toLowerCase();
    if (!lower) continue;
    const slug = lower.replace(/\s+/g, '_');
    const spaced = lower.replace(/_/g, ' ');
    for (const key of new Set([lower, slug, spaced])) {
      if (key) documentNameToId.set(key, id);
    }
  }
  const documentImageById = {};
  Object.entries(normalizedDocumentPayload).forEach(([key, value]) => {
    const normalizedKey = String(key).trim().toLowerCase();
    const normalizedValue = value === undefined || value === null ? '' : String(value).trim();
    if (!normalizedValue) return;
    const mappedDocumentId = documentNameToId.get(normalizedKey);
    if (mappedDocumentId) {
      documentImageById[mappedDocumentId] = normalizedValue;
    }
  });
  if (Object.keys(documentImageById).length === 0) return false;
  const partnerUser = await User.findById(partnerId).select('verification_status').lean();
  const documentStatusFields = partnerDocumentFieldsAfterImageUpload(
    partnerUser?.verification_status
  );
  const updates = Object.entries(documentImageById).map(([documentId, imageUrl]) =>
    PartnerDocument.updateOne(
      {
        partner_id: partnerId,
        document_id: new mongoose.Types.ObjectId(documentId),
        deleted_at: null,
      },
      { $set: { document_image: imageUrl, ...documentStatusFields } }
    )
  );
  await Promise.all(updates);
  return true;
}

async function ensurePartnerDocumentCatalogRows(partnerId, userRecord) {
  const documentList = await getDocumentList();
  if (!documentList.length) return;

  const existingRows = await PartnerDocument.find({
    partner_id: partnerId,
    deleted_at: null,
  })
    .select('document_id')
    .lean();
  const haveDocId = new Set(existingRows.map((r) => String(r.document_id)));
  const newRows = [];
  for (const document of documentList) {
    if (haveDocId.has(String(document._id))) continue;
    newRows.push({
      _id: new mongoose.Types.ObjectId(),
      partner_id: partnerId,
      document_id: document._id,
    });
  }
  if (!newRows.length) return;

  const result = await createMultiple(newRows);
  if (result.success !== true) {
    const err = new Error(result.message || 'Failed to create partner documents.');
    err.status = result.status || 500;
    throw err;
  }

  const currentIds = Array.isArray(userRecord.documents)
    ? userRecord.documents.map((id) => String(id))
    : [];
  const addedIds = newRows.map((r) => String(r._id));
  userRecord.documents = [...new Set([...currentIds, ...addedIds])].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  await userRecord.save();
}

const assertBankAccountNumberAvailable = async (partnerOid, accountNumber) => {
  const takenByOther = await PartnerBankAccount.findOne({
    account_number: accountNumber,
    deleted_at: null,
    partner_id: { $ne: partnerOid },
  }).lean();
  if (takenByOther) {
    return fail(409, 'Account number already exists.');
  }
  return okPass();
};

const applyPrimaryBankAccountFlags = (accounts) => {
  const rows = accounts.map((acc) => ({ ...acc, is_primary: acc.is_primary === true }));
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary);
  if (firstPrimaryIdx === -1 && rows.length > 0) {
    rows[0].is_primary = true;
    return rows;
  }
  return rows.map((r, i) => ({
    ...r,
    is_primary: i === firstPrimaryIdx,
  }));
};

async function upsertPartnerBankAccountForPartner(partnerId, normalizedBankAccount) {
  if (!normalizedBankAccount) return okPass();
  const bankAccountNumber = String(normalizedBankAccount.account_number || '').trim();
  if (!bankAccountNumber) return okPass();

  const partnerOid =
    partnerId instanceof mongoose.Types.ObjectId
      ? partnerId
      : new mongoose.Types.ObjectId(String(partnerId));

  const availability = await assertBankAccountNumberAvailable(partnerOid, bankAccountNumber);
  if (!availability.ok) return availability;

  let account = await PartnerBankAccount.findOne({
    partner_id: partnerOid,
    account_number: bankAccountNumber,
    deleted_at: null,
  });
  if (!account && normalizedBankAccount.is_primary === true) {
    account = await PartnerBankAccount.findOne({
      partner_id: partnerOid,
      deleted_at: null,
      is_primary: true,
    });
  }

  const fields = {
    bank_name: normalizedBankAccount.bank_name,
    account_holder_name: normalizedBankAccount.account_holder_name,
    account_number: bankAccountNumber,
    ifsc_code: normalizedBankAccount.ifsc_code,
    branch_name: normalizedBankAccount.branch_name,
    is_primary: normalizedBankAccount.is_primary === true,
    updated_at: new Date(),
  };

  if (normalizedBankAccount.is_primary === true) {
    const clearPrimaryQuery = { partner_id: partnerOid, deleted_at: null };
    if (account) clearPrimaryQuery._id = { $ne: account._id };
    await PartnerBankAccount.updateMany(clearPrimaryQuery, {
      $set: { is_primary: false, updated_at: new Date() },
    });
  }

  if (account) {
    Object.assign(account, fields);
    await account.save();
  } else {
    const hasAny = await PartnerBankAccount.exists({ partner_id: partnerOid, deleted_at: null });
    await PartnerBankAccount.create({
      partner_id: partnerOid,
      ...fields,
      is_primary: fields.is_primary || !hasAny,
      created_at: new Date(),
      deleted_at: null,
    });
  }
  return okPass();
}

async function replacePartnerBankAccountsForPartner(partnerId, normalizedAccounts) {
  if (!Array.isArray(normalizedAccounts) || normalizedAccounts.length === 0) {
    return okPass();
  }

  const partnerOid =
    partnerId instanceof mongoose.Types.ObjectId
      ? partnerId
      : new mongoose.Types.ObjectId(String(partnerId));

  const seenNumbers = new Set();
  for (const acc of normalizedAccounts) {
    const bankAccountNumber = String(acc.account_number || '').trim();
    if (!bankAccountNumber) {
      return fail(400, 'Account number is required.');
    }
    if (seenNumbers.has(bankAccountNumber)) {
      return fail(400, 'Duplicate account number in bank accounts.');
    }
    seenNumbers.add(bankAccountNumber);
    const availability = await assertBankAccountNumberAvailable(partnerOid, bankAccountNumber);
    if (!availability.ok) return availability;
  }

  const rows = applyPrimaryBankAccountFlags(normalizedAccounts);
  const now = new Date();

  await PartnerBankAccount.updateMany(
    { partner_id: partnerOid, deleted_at: null },
    { $set: { deleted_at: now, updated_at: now } }
  );

  await PartnerBankAccount.insertMany(
    rows.map((acc) => ({
      partner_id: partnerOid,
      bank_name: acc.bank_name,
      account_holder_name: acc.account_holder_name,
      account_number: acc.account_number,
      ifsc_code: acc.ifsc_code,
      branch_name: acc.branch_name,
      is_primary: acc.is_primary === true,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }))
  );

  return okPass();
}

const assignPartnerOnboarding = async (savedUser) => {
  console.log('[partner.register] onboarding: creating notification settings', {
    user_id: savedUser._id,
  });
  await notificationSetting.create({ user_id: savedUser._id });
  console.log('[partner.register] onboarding: notification settings created');

  console.log('[partner.register] onboarding: looking up basic subscription plan');
  const basicPlan = await SubscriptionPlan.findOne({
    plan_name: DEFAULT_PARTNER_PLAN_NAME,
    is_active: true,
    deleted_at: null,
  });
  if (!basicPlan) {
    console.error('[partner.register] onboarding: basic plan not found in DB');
    throw new Error('Default subscription plan "basic" is not configured.');
  }
  console.log('[partner.register] onboarding: basic plan found', { plan_id: basicPlan._id });

  console.log('[partner.register] onboarding: creating partner subscription');
  await PartnerSubscription.create({
    partner_id: savedUser._id,
    subscription_plan_id: basicPlan._id,
    started_at: savedUser.created_at,
    expires_at: null,
    status: 'active',
    notes: 'Auto-assigned on mobile registration',
  });
  console.log('[partner.register] onboarding: partner subscription created');
};

const buildPartnerLoginData = async (user) => {
  const populated = await User.findById(user._id).populate([{ path: 'city_id' }]).lean();
  if (!populated) return null;

  const engagementCounts = await getPartnerEngagementCounts(user._id);
  const data = {
    ...populated,
    city_id: populated?.city_id?._id || null,
    city_name: populated?.city_id?.name || null,
    verification_status_message: verificationStatusToMessage(populated?.verification_status),
    ...attachPartnerRatingFields(populated),
    ...engagementCounts,
  };
  delete data.password;
  return data;
};

const applyGoogleProfileToPartner = (user, { email, name, picture }) => {
  if (email && !user.email) {
    user.email = normalizeUserEmail(email);
  }
  if (name && !user.name) {
    user.name = name;
  }
  if (picture && !user.profile_url) {
    user.profile_url = picture;
  }
};

const applyAppleProfileToPartner = (user, { email, name }) => {
  if (email && !user.email) {
    user.email = normalizeUserEmail(email);
  }
  if (name && !user.name) {
    user.name = name;
  }
};

const finalizePartnerLogin = async (user, device_token) => {
  if (user.is_blocked === true) {
    return fail(403, 'Your account is blocked. Please contact support.');
  }

  user.generateAuthToken();
  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    user.device_token = String(device_token).trim();
  }
  await user.save();

  const data = await buildPartnerLoginData(user);
  if (!data) {
    return fail(500, 'Failed to load partner profile.');
  }

  return okWithData(data);
};

const tagRegisterError = (step, err) => {
  if (err && typeof err === 'object') {
    err.registerStep = step;
  }
  return err;
};

const registerPartner = async ({ name, email, phone_number, password, date_of_birth }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedPhone = normalizeUserPhone(phone_number);
  console.log('[partner.register] service: checking email/phone uniqueness');

  const uniqueness = await checkUserContactUniqueness({
    email: normalizedEmail,
    phone_number: normalizedPhone,
  });
  if (!uniqueness.ok) {
    console.log('[partner.register] service: uniqueness conflict', { message: uniqueness.message });
    const err = new Error(uniqueness.message);
    err.status = 409;
    throw err;
  }
  console.log('[partner.register] service: uniqueness check passed');

  let registration_id;
  let user_id;
  try {
    console.log('[partner.register] service: generating registration_id');
    registration_id = await getNewId(0);
    console.log('[partner.register] service: registration_id =', registration_id);

    console.log('[partner.register] service: generating user_id');
    user_id = await getNewId(USER_TYPE_PARTNER);
    console.log('[partner.register] service: user_id =', user_id);
  } catch (err) {
    console.error('[partner.register] service: getNewId failed', err.message);
    throw tagRegisterError('getNewId', err);
  }

  const _id = new mongoose.Types.ObjectId();
  console.log('[partner.register] service: building user document', { _id, registration_id, user_id });

  const newUser = new User({
    _id,
    registration_id,
    user_id,
    name,
    email: normalizedEmail,
    phone_number: normalizedPhone,
    date_of_birth,
    type: USER_TYPE_PARTNER,
    registration_type: REGISTRATION_TYPE_NORMAL,
    is_from_web: false,
    verification_status: 1,
    verified_at: null,
  });

  newUser.password = password;

  try {
    console.log('[partner.register] service: generating auth token');
    if (!process.env.JWT_SECRET) {
      console.error('[partner.register] service: JWT_SECRET is missing');
    }
    newUser.generateAuthToken();
    console.log('[partner.register] service: auth token generated');
  } catch (err) {
    console.error('[partner.register] service: generateAuthToken failed', err.message);
    throw tagRegisterError('generateAuthToken', err);
  }

  let savedUser;
  try {
    console.log('[partner.register] service: saving user to database');
    savedUser = await newUser.save();
    console.log('[partner.register] service: user saved', { _id: savedUser._id, user_id: savedUser.user_id });
    void safeNotifyBackofficePartnerPending({
      partner: savedUser,
      actorUserId: savedUser._id,
    });
  } catch (err) {
    console.error('[partner.register] service: user save failed', {
      message: err.message,
      code: err.code,
      name: err.name,
    });
    throw tagRegisterError('user_save', err);
  }

  try {
    console.log('[partner.register] service: starting onboarding');
    await assignPartnerOnboarding(savedUser);
    console.log('[partner.register] service: onboarding completed');
  } catch (err) {
    console.error('[partner.register] service: onboarding failed', {
      message: err.message,
      code: err.code,
      user_id: savedUser._id,
    });
    throw tagRegisterError('onboarding', err);
  }

  const data = savedUser.toObject();
  delete data.password;

  return {
    data,
  };
};

const loginPartner = async ({ email, password, device_token }) => {
  const user = await User.findOne({ email, deleted_at: null }).select('+password');
  if (!user) {
    return fail(401, 'Invalid email.');
  }

  if (Number(user.type) !== USER_TYPE_PARTNER) {
    return fail(403, 'This account is not a partner. Use the correct app to sign in.');
  }

  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return fail(401, 'Invalid password.');
  }

  return finalizePartnerLogin(user, device_token);
};

const googleLoginPartner = async ({ id_token, device_token, phone_number, date_of_birth }) => {
  let googleProfile;
  try {
    googleProfile = await verifyGoogleIdToken(id_token, { app: GOOGLE_APP_PARTNER });
  } catch (err) {
    console.error('googleLoginPartner token verification', err.message);
    if (String(err.message || '').includes('not configured')) {
      return fail(500, 'Google sign-in is not configured on the server.');
    }
    return fail(401, 'Invalid or expired Google token.');
  }

  const { google_id, email, name, picture } = googleProfile;
  const normalizedPhone =
    phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== ''
      ? normalizeUserPhone(phone_number)
      : null;

  let user = await User.findOne({ google_id, deleted_at: null });

  if (user) {
    if (Number(user.type) !== USER_TYPE_PARTNER) {
      return fail(409, 'This Google account is registered with another account type.');
    }
    applyGoogleProfileToPartner(user, { email, name, picture });
    const result = await finalizePartnerLogin(user, device_token);
    if (!result.ok) return result;
    return { ...result, message: 'Login successfully.' };
  }

  if (email) {
    const normalizedEmail = normalizeUserEmail(email);
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
      deleted_at: null,
    });

    if (user) {
      if (Number(user.type) !== USER_TYPE_PARTNER) {
        return fail(409, 'This email is registered with another account type.');
      }
      if (user.google_id && user.google_id !== google_id) {
        return fail(409, 'This email is linked to a different Google account.');
      }

      user.google_id = google_id;
      applyGoogleProfileToPartner(user, { email, name, picture });
      const result = await finalizePartnerLogin(user, device_token);
      if (!result.ok) return result;
      return { ...result, message: 'Login successfully.' };
    }
  }

  if (!email) {
    return fail(400, 'Google account must include an email address to register as a partner.');
  }

  const uniqueness = await checkUserContactUniqueness({
    email,
    phone_number: normalizedPhone,
  });
  if (!uniqueness.ok) {
    return fail(409, uniqueness.message);
  }

  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_PARTNER);
  const _id = new mongoose.Types.ObjectId();

  user = new User({
    _id,
    registration_id,
    user_id,
    google_id,
    name: name || null,
    email: normalizeUserEmail(email),
    phone_number: normalizedPhone,
    date_of_birth: date_of_birth || null,
    profile_url: picture || null,
    type: USER_TYPE_PARTNER,
    registration_type: REGISTRATION_TYPE_GOOGLE,
    is_from_web: false,
    verification_status: 1,
    verified_at: null,
  });

  user.generateAuthToken();
  const savedUser = await user.save();

  try {
    await assignPartnerOnboarding(savedUser);
  } catch (err) {
    console.error('googleLoginPartner onboarding', err.message);
    return fail(500, 'Partner account created but onboarding failed. Please contact support.');
  }

  const data = await buildPartnerLoginData(savedUser);
  if (!data) {
    return fail(500, 'Failed to load partner profile.');
  }

  return { ok: true, data, message: 'Partner registered successfully.' };
};

const appleLoginPartner = async ({ id_token, device_token, phone_number, date_of_birth, name }) => {
  let appleProfile;
  try {
    appleProfile = await verifyAppleIdToken(id_token, { app: APPLE_APP_PARTNER });
  } catch (err) {
    console.error('appleLoginPartner token verification', err.message);
    if (String(err.message || '').includes('not configured')) {
      return fail(500, 'Apple sign-in is not configured on the server.');
    }
    return fail(401, 'Invalid or expired Apple token.');
  }

  const { apple_id, email } = appleProfile;
  const displayName =
    name !== undefined && name !== null && String(name).trim() !== '' ? String(name).trim() : null;
  const normalizedPhone =
    phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== ''
      ? normalizeUserPhone(phone_number)
      : null;

  let user = await User.findOne({ apple_id, deleted_at: null });

  if (user) {
    if (Number(user.type) !== USER_TYPE_PARTNER) {
      return fail(409, 'This Apple account is registered with another account type.');
    }
    applyAppleProfileToPartner(user, { email, name: displayName });
    const result = await finalizePartnerLogin(user, device_token);
    if (!result.ok) return result;
    return { ...result, message: 'Login successfully.' };
  }

  if (email) {
    const normalizedEmail = normalizeUserEmail(email);
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
      deleted_at: null,
    });

    if (user) {
      if (Number(user.type) !== USER_TYPE_PARTNER) {
        return fail(409, 'This email is registered with another account type.');
      }
      if (user.apple_id && user.apple_id !== apple_id) {
        return fail(409, 'This email is linked to a different Apple account.');
      }

      user.apple_id = apple_id;
      applyAppleProfileToPartner(user, { email, name: displayName });
      const result = await finalizePartnerLogin(user, device_token);
      if (!result.ok) return result;
      return { ...result, message: 'Login successfully.' };
    }
  }

  if (!email) {
    return fail(400, 'Apple account must include an email address to register as a partner.');
  }

  const uniqueness = await checkUserContactUniqueness({
    email,
    phone_number: normalizedPhone,
  });
  if (!uniqueness.ok) {
    return fail(409, uniqueness.message);
  }

  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_PARTNER);
  const _id = new mongoose.Types.ObjectId();

  user = new User({
    _id,
    registration_id,
    user_id,
    apple_id,
    name: displayName || null,
    email: normalizeUserEmail(email),
    phone_number: normalizedPhone,
    date_of_birth: date_of_birth || null,
    type: USER_TYPE_PARTNER,
    registration_type: REGISTRATION_TYPE_APPLE,
    is_from_web: false,
    verification_status: 1,
    verified_at: null,
  });

  user.generateAuthToken();
  const savedUser = await user.save();

  try {
    await assignPartnerOnboarding(savedUser);
  } catch (err) {
    console.error('appleLoginPartner onboarding', err.message);
    return fail(500, 'Partner account created but onboarding failed. Please contact support.');
  }

  const data = await buildPartnerLoginData(savedUser);
  if (!data) {
    return fail(500, 'Failed to load partner profile.');
  }

  return { ok: true, data, message: 'Partner registered successfully.' };
};

const assignFranchiseIdFromLocation = async (user) => {
  const stateId = user.state_id;
  const cityId = user.city_id;
  const areaId = user.area_id;

  if (
    stateId == null ||
    cityId == null ||
    areaId == null ||
    String(stateId).trim() === '' ||
    String(cityId).trim() === '' ||
    String(areaId).trim() === ''
  ) {
    return okPass();
  }

  if (
    !mongoose.Types.ObjectId.isValid(String(stateId)) ||
    !mongoose.Types.ObjectId.isValid(String(cityId)) ||
    !mongoose.Types.ObjectId.isValid(String(areaId))
  ) {
    return okPass();
  }

  const stateOid = new mongoose.Types.ObjectId(String(stateId));
  const cityOid = new mongoose.Types.ObjectId(String(cityId));
  const areaOid = new mongoose.Types.ObjectId(String(areaId));

  const franchise = await Franchise.findOne({
    deleted_at: null,
    is_active: true,
    state_id: stateOid,
    city_id: cityOid,
    area_id: areaOid,
  })
    .sort({ updated_at: -1 })
    .select('_id')
    .lean();

  if (!franchise) {
    return fail(400, 'No franchise available for this location.');
  }

  user.franchise_id = franchise._id;
  return okPass();
};

const buildPartnerResponseData = async (partnerId) => {
  const populated = await User.findById(partnerId)
    .populate([
      { path: 'state_id', select: 'name' },
      { path: 'city_id', select: 'name' },
      { path: 'area_id', select: 'name' },
      { path: 'franchise_id', select: 'name' },
    ])
    .lean();
  if (!populated) return null;

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));

  const [partner_services, bank_accounts, partner_documents, engagementCounts] = await Promise.all([
    PartnerService.find({ partner_id: partnerOid, deleted_at: null })
      .populate([
        { path: 'category_id', select: 'name' },
        { path: 'service_id', select: 'name' },
      ])
      .lean(),
    PartnerBankAccount.find({ partner_id: partnerOid, deleted_at: null })
      .sort({ is_primary: -1, created_at: -1 })
      .lean(),
    getPartnerDocumentList(partnerOid),
    getPartnerEngagementCounts(partnerOid),
  ]);

  const data = {
    ...populated,
    state_id: populated?.state_id?._id ?? populated?.state_id ?? null,
    state_name: populated?.state_id?.name ?? null,
    city_id: populated?.city_id?._id ?? populated?.city_id ?? null,
    city_name: populated?.city_id?.name ?? null,
    area_id: populated?.area_id?._id ?? populated?.area_id ?? null,
    area_name: populated?.area_id?.name ?? null,
    franchise_id: populated?.franchise_id?._id ?? populated?.franchise_id ?? null,
    franchise_name: populated?.franchise_id?.name ?? null,
    verification_status_message: verificationStatusToMessage(populated?.verification_status),
    ...attachPartnerRatingFields(populated),
    ...engagementCounts,
    partner_services,
    bank_accounts,
    partner_documents,
    documents: partner_documents,
  };
  delete data.password;
  return data;
};

const PARTNER_UPDATE_SECTION = {
  ALL: 'all',
  BASIC: 'basic-details',
  DOCUMENTS: 'documents',
  BANKS: 'bank-accounts',
};

const updatePartner = async ({ partnerId, body, files, section = PARTNER_UPDATE_SECTION.ALL }) => {
  const runBasic =
    section === PARTNER_UPDATE_SECTION.ALL || section === PARTNER_UPDATE_SECTION.BASIC;
  const runDocuments =
    section === PARTNER_UPDATE_SECTION.ALL || section === PARTNER_UPDATE_SECTION.DOCUMENTS;
  const runBanks =
    section === PARTNER_UPDATE_SECTION.ALL || section === PARTNER_UPDATE_SECTION.BANKS;
  const user = await User.findOne({ _id: partnerId, type: USER_TYPE_PARTNER, deleted_at: null });
  if (!user) {
    return fail(404, 'Partner not found.');
  }

  const isVerificationApproved = Number(user.verification_status) === 2;
  const restrictedUntilApprovedMessage =
    'Catalog, services, and bank details can only be updated after your account is verified and approved.';

  const updateData = { ...body };

  if (runBasic && files?.image?.[0]) {
    updateData.profile_url = await handleImageUpload(files.image[0], getUploadType(4), true, null);
  }

  const shouldAddNewAddress =
    runBasic &&
    (parseBooleanInput(updateData.add_new_address) ||
      parseBooleanInput(updateData.is_additional_address));
  const hasAddressPayload =
    runBasic &&
    (updateData.address !== undefined ||
      updateData.state_id !== undefined ||
      updateData.city_id !== undefined ||
      updateData.pincode !== undefined);
  const hasAddressStatusPayload = runBasic && updateData.address_status !== undefined;
  const targetAddressId = updateData.address_id;

  if (runBasic && shouldAddNewAddress) {
    if (
      !hasAddressPayload ||
      !updateData.address ||
      String(updateData.address).trim() === '' ||
      !updateData.state_id ||
      !mongoose.Types.ObjectId.isValid(String(updateData.state_id)) ||
      !updateData.city_id ||
      !mongoose.Types.ObjectId.isValid(String(updateData.city_id)) ||
      !updateData.pincode ||
      String(updateData.pincode).trim() === ''
    ) {
      return fail(400, 'Address, state, city, and pincode are required to add a new address.');
    }
    await createAddressRecord({
      userId: user._id,
      name: updateData.contact_name ?? updateData.name ?? user.name,
      phoneNumber: updateData.contact_number ?? updateData.phone_number ?? user.phone_number,
      address: updateData.address,
      stateId: updateData.state_id,
      cityId: updateData.city_id,
      areaId: updateData.area_id,
      pincode: updateData.pincode,
      addressStatus: updateData.address_status,
    });
    delete updateData.address;
    delete updateData.state_id;
    delete updateData.city_id;
    delete updateData.area_id;
    delete updateData.pincode;
    delete updateData.address_id;
    delete updateData.address_status;
    delete updateData.add_new_address;
    delete updateData.is_additional_address;
  }

  let passwordUpdated = false;

  if (runBasic) {
    if (updateData.password !== undefined && String(updateData.password).trim() !== '') {
      user.password = updateData.password;
      passwordUpdated = true;
    }

    if (updateData.password !== undefined && String(updateData.password).trim() === '') {
      delete updateData.password;
    }

    Object.keys(updateData).forEach((key) => {
      if (MOBILE_PARTNER_ALLOWED_UPDATE_FIELDS.has(key)) {
        user[key] = updateData[key];
      }
    });

    const hasLocationUpdate =
      updateData.state_id !== undefined ||
      updateData.city_id !== undefined ||
      updateData.area_id !== undefined;

    if (hasLocationUpdate) {
      const franchiseAssign = await assignFranchiseIdFromLocation(user);
      if (!franchiseAssign.ok) {
        return franchiseAssign;
      }
    }
  }

  const updatedUser = await user.save();

  if (runBasic && !shouldAddNewAddress && (hasAddressPayload || hasAddressStatusPayload)) {
    const targetAddress = await findPartnerAddressForUpdate(updatedUser._id, targetAddressId);
    if (targetAddress) {
      if (hasAddressPayload) {
        if (updateData.contact_name !== undefined || updateData.name !== undefined) {
          targetAddress.contact_name =
            updateData.contact_name ?? updateData.name ?? targetAddress.contact_name ?? '';
        }
        if (updateData.contact_number !== undefined || updateData.phone_number !== undefined) {
          targetAddress.contact_number =
            updateData.contact_number ??
            updateData.phone_number ??
            targetAddress.contact_number ??
            '';
        }
        if (updateData.address !== undefined) targetAddress.address = String(updateData.address);
        if (updateData.state_id !== undefined) targetAddress.state_id = updateData.state_id;
        if (updateData.city_id !== undefined) targetAddress.city_id = updateData.city_id;
        if (updateData.area_id !== undefined) {
          targetAddress.area_id =
            updateData.area_id != null &&
            String(updateData.area_id).trim() !== '' &&
            mongoose.Types.ObjectId.isValid(String(updateData.area_id))
              ? updateData.area_id
              : null;
        }
        if (updateData.pincode !== undefined) targetAddress.pincode = String(updateData.pincode);
        if (
          !targetAddressId &&
          (updateData.address !== undefined ||
            updateData.state_id !== undefined ||
            updateData.city_id !== undefined ||
            updateData.pincode !== undefined)
        ) {
          updatedUser.address = targetAddress.address ?? updatedUser.address;
          updatedUser.state_id = targetAddress.state_id ?? updatedUser.state_id;
          updatedUser.city_id = targetAddress.city_id ?? updatedUser.city_id;
          updatedUser.area_id = targetAddress.area_id ?? updatedUser.area_id;
          updatedUser.pincode = targetAddress.pincode ?? updatedUser.pincode;
          const franchiseAssign = await assignFranchiseIdFromLocation(updatedUser);
          if (!franchiseAssign.ok) {
            return franchiseAssign;
          }
          await updatedUser.save();
        }
      }
      if (hasAddressStatusPayload) {
        targetAddress.address_status = parseBooleanInput(updateData.address_status);
      }
      targetAddress.updated_at = new Date();
      await targetAddress.save();
    } else if (hasAddressPayload) {
      await createAddressRecord({
        userId: updatedUser._id,
        name: updatedUser.name,
        phoneNumber: updatedUser.phone_number,
        address: updatedUser.address,
        stateId: updatedUser.state_id,
        cityId: updatedUser.city_id,
        areaId: updatedUser.area_id,
        pincode: updatedUser.pincode,
        addressStatus: updateData.address_status,
      });
    } else if (hasAddressStatusPayload && targetAddressId) {
      return fail(404, 'Address not found for this user.');
    }
  }

  const hasPartnerDocFiles = PARTNER_DOCUMENT_FILE_FIELDS.some((f) => files?.[f]?.[0]);
  const hasCatalogPayload = hasPartnerCatalogPayload(updateData);
  const hasBankPayload =
    updateData.bank_account !== undefined ||
    updateData.bank_name !== undefined ||
    updateData.branch_name !== undefined ||
    updateData.account_holder_name !== undefined ||
    updateData.account_name !== undefined ||
    updateData.account_number !== undefined ||
    updateData.ifsc_code !== undefined;

  if (!isVerificationApproved && (hasBankPayload || hasCatalogPayload)) {
    return fail(403, restrictedUntilApprovedMessage);
  }

  const shouldRunCatalog = runBasic && hasCatalogPayload;
  const shouldRunDocuments = runDocuments && hasPartnerDocFiles;
  const shouldRunBanks = runBanks && hasBankPayload;

  if (shouldRunCatalog || shouldRunDocuments || shouldRunBanks) {
    if (shouldRunDocuments || shouldRunCatalog) {
      await ensurePartnerDocumentCatalogRows(updatedUser._id, updatedUser);
    }

    if (shouldRunDocuments) {
      const mergedPartnerDocs = await mergePartnerDocumentPayloadFromMultipart(files);
      const documentsUpdated = await applyPartnerDocumentImageUpdates(
        updatedUser._id,
        normalizePartnerDocuments(mergedPartnerDocs)
      );
      if (documentsUpdated && applyPartnerUserStatusAfterDocumentUpload(updatedUser)) {
        await updatedUser.save();
      }
    }

    if (shouldRunCatalog) {
      const resolvedPartnerServicesInput = resolvePartnerServicesInputFromBody(updateData);
      const normalizedServiceRows = normalizePartnerServices(resolvedPartnerServicesInput ?? []);
      await mergeMobilePartnerCatalogFromNormalizedRows(updatedUser._id, normalizedServiceRows);
    }

    if (shouldRunBanks) {
      const { accounts, isArrayPayload } = resolvePartnerBankInputFromBody(updateData);
      if (isArrayPayload && accounts.length === 0) {
        return fail(400, 'At least one bank account is required.');
      }
      const bankResult = isArrayPayload
        ? await replacePartnerBankAccountsForPartner(updatedUser._id, accounts)
        : await upsertPartnerBankAccountForPartner(updatedUser._id, accounts[0] ?? null);
      if (!bankResult.ok) {
        return fail(bankResult.status, bankResult.message);
      }
    }
  }

  const data = await buildPartnerResponseData(updatedUser._id);
  return { ok: true, data, passwordUpdated };
};

module.exports = {
  registerPartner,
  loginPartner,
  googleLoginPartner,
  appleLoginPartner,
  updatePartner,
};
