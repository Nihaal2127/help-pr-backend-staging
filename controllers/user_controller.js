const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const User = require('../models/user');
const Address = require('../models/address');
const Area = require('../models/area');
const PartnerServices = require('../models/partner_service');
const notificationSetting = require('../models/notification_settings');
const { validationResult } = require('express-validator');
const { createOtp } = require('./otp_controller')
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const BusinessInfo = require('../models/business_info');
const Franchise = require('../models/franchise');
const { getNewId } = require('../helper/id_generator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const {
  getServiceCountData,
  getVerificationCountData,
  pickFranchiseIdFromRequest,
} = require('./count_controller');

const { getDocumentList } = require('./document_controller');
const { createMultiple, getPartnerDocumentList } = require('./partner_document_controller');
const { getLastServiceDate } = require('./order_service_controller');
const { getUserTypeKey } = require('../enum/user_type_enum')
const { handleImageUpload } = require('../helper/image_uploader');
const { getUploadType } = require('../enum/upload_type_enum');
const PartnerDocument = require('../models/partner_document');
const PartnerBankAccount = require('../models/partner_bank_account');
const PartnerSubscription = require('../models/partner_subscription');
const {
  replacePartnerCategoriesFromSignupRows,
  replacePartnerCatalogFromNormalizedRows,
  mergePartnerCatalogFromNormalizedRows,
} = require('../services/partner_category_service');
const partnerSubscriptionService = require('../services/partner_subscription_service');
const {
  normalizeUserEmail,
  normalizeUserPhone,
  checkUserContactUniqueness,
} = require('../utils/user_contact_uniqueness');
const { fieldLabel } = require('../utils/field_labels');
const {
  partnerDocumentFieldsAfterImageUpload,
  applyPartnerUserStatusAfterDocumentUpload,
} = require('../utils/partner_document_status');

const GET_ALL_SORT_FIELDS = ['name', 'email', 'created_at'];
const VERIFICATION_SORT_FIELDS = ['name', 'email', 'created_at'];

/** Query: sort_by / sortBy = name | email | created_at; sort_order / sortOrder = asc | desc. Legacy: sort=1|-1 on created_at when sort_by omitted. */
function buildGetAllSort(query) {
  const sortByRaw = query.sort_by ?? query.sortBy;
  const orderRaw = String(query.sort_order ?? query.sortOrder ?? '').toLowerCase();

  if (!sortByRaw) {
    const legacy = query.sort !== undefined ? parseInt(query.sort, 10) : NaN;
    const dir = legacy === 1 || legacy === -1 ? legacy : -1;
    return { created_at: dir };
  }

  const sortBy = GET_ALL_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'created_at';

  let direction;
  if (orderRaw === 'asc' || orderRaw === '1') direction = 1;
  else if (orderRaw === 'desc' || orderRaw === '-1') direction = -1;
  else direction = sortBy === 'created_at' ? -1 : 1;

  return { [sortBy]: direction };
}

function getSortDirection(query, fallback = -1) {
  const orderRaw = String(query.sort_order ?? query.sortOrder ?? '').toLowerCase();
  if (orderRaw === 'asc' || orderRaw === '1') return 1;
  if (orderRaw === 'desc' || orderRaw === '-1') return -1;
  return fallback;
}

async function buildAreaIdToNameMap(areaIds) {
  const oids = [
    ...new Set(
      (areaIds || [])
        .filter((id) => id != null && String(id).trim() !== '' && mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id)),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (oids.length === 0) return new Map();
  const areas = await Area.find({ _id: { $in: oids }, deleted_at: null }).select('name').lean();
  const map = new Map();
  for (const a of areas) map.set(String(a._id), a.name);
  return map;
}

function resolveAreaName(areaId, areaMap) {
  if (areaId == null || String(areaId).trim() === '') return null;
  return areaMap.get(String(areaId)) ?? null;
}

function attachAreaNamesToAddresses(addresses, areaMap) {
  return (addresses || []).map((addr) => ({
    ...addr,
    area_name: resolveAreaName(addr.area_id, areaMap),
  }));
}

const sanitizeOptionalObjectIdRef = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return mongoose.Types.ObjectId.isValid(trimmed) ? new mongoose.Types.ObjectId(trimmed) : null;
  }
  if (typeof value === 'object' && value._id) {
    const rawId = String(value._id).trim();
    return mongoose.Types.ObjectId.isValid(rawId) ? new mongoose.Types.ObjectId(rawId) : null;
  }
  return null;
};

const sanitizeUserLocationRefsForPopulate = (users) =>
  (users || []).map((user) => ({
    ...user,
    state_id: sanitizeOptionalObjectIdRef(user?.state_id),
    city_id: sanitizeOptionalObjectIdRef(user?.city_id),
  }));

const USER_TYPE_FRANCHISE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

function collectFranchiseAreaIds(franchiseLean) {
  const seen = new Set();
  const oids = [];
  if (!franchiseLean || franchiseLean.area_id == null) return oids;
  const arr = Array.isArray(franchiseLean.area_id) ? franchiseLean.area_id : [franchiseLean.area_id];
  for (const item of arr) {
    let oid = null;
    if (item instanceof mongoose.Types.ObjectId) {
      oid = item;
    } else if (item && typeof item === 'object' && item._id) {
      oid = item._id;
    } else if (typeof item === 'string' && /^[a-fA-F0-9]{24}$/i.test(item.trim())) {
      oid = new mongoose.Types.ObjectId(item.trim());
    }
    if (!oid) continue;
    const k = oid.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    oids.push(oid);
  }
  return oids;
}

/** Type-4 user ids with an address pincode in the franchise's linked areas. */
async function getFranchiseCustomerUserIdsByPincode(franchiseLean) {
  const areaIds = collectFranchiseAreaIds(franchiseLean);
  if (areaIds.length === 0) return [];

  const areas = await Area.find({
    _id: { $in: areaIds },
    deleted_at: null,
  })
    .select('pincodes')
    .lean();

  const allowedPins = [];
  const pinSeen = new Set();
  for (const a of areas) {
    for (const p of a.pincodes || []) {
      const t = String(p).trim();
      if (!t || pinSeen.has(t)) continue;
      pinSeen.add(t);
      allowedPins.push(t);
    }
  }
  if (allowedPins.length === 0) return [];

  const rows = await Address.aggregate([
    {
      $match: {
        deleted_at: null,
        user_id: { $exists: true, $ne: null },
      },
    },
    {
      $addFields: {
        pinNorm: {
          $trim: {
            input: {
              $toString: { $ifNull: ['$pincode', ''] },
            },
          },
        },
      },
    },
    { $match: { pinNorm: { $in: allowedPins } } },
    { $group: { _id: '$user_id' } },
  ]);

  return rows.map((r) => r._id).filter(Boolean);
}

/** Franchise admin may be linked via user.franchise_id or Franchise.admin_id (JWT user id). */
async function resolveCallerFranchiseOid(caller, userId) {
  if (caller?.franchise_id) {
    return caller.franchise_id;
  }
  if (Number(caller?.type) === USER_TYPE_FRANCHISE_ADMIN && userId) {
    const franchise = await Franchise.findOne({
      admin_id: userId,
      deleted_at: null,
    })
      .select('_id')
      .lean();
    return franchise?._id ?? null;
  }
  return null;
}

function resolveEffectiveFranchiseOid(caller, franchiseIdFilter, callerFranchiseOid) {
  if ([USER_TYPE_SUPER_ADMIN, USER_TYPE_STAFF].includes(caller.type) && franchiseIdFilter) {
    return new mongoose.Types.ObjectId(franchiseIdFilter);
  }
  const franchiseOid = callerFranchiseOid ?? caller.franchise_id ?? null;
  if ([USER_TYPE_FRANCHISE_ADMIN, USER_TYPE_EMPLOYEE].includes(caller.type) && franchiseOid) {
    return franchiseOid;
  }
  return null;
}

function buildUserListRoleFilter(caller, { franchiseIdFilter, type, partnerListVerificationStatus, callerFranchiseOid }) {
  if ([USER_TYPE_PARTNER, USER_TYPE_CUSTOMER].includes(caller.type)) {
    return {
      ok: false,
      status: 403,
      message: 'You are not allowed to access users list.',
    };
  }
  if (![USER_TYPE_FRANCHISE_ADMIN, USER_TYPE_EMPLOYEE, USER_TYPE_SUPER_ADMIN, USER_TYPE_STAFF].includes(caller.type)) {
    return {
      ok: false,
      status: 403,
      message: 'You are not allowed to access users list.',
    };
  }

  if ([USER_TYPE_SUPER_ADMIN, USER_TYPE_STAFF].includes(caller.type)) {
    if (franchiseIdFilter) {
      if (!mongoose.Types.ObjectId.isValid(franchiseIdFilter)) {
        return {
          ok: false,
          status: 400,
          message: `${fieldLabel('franchise_id')} must be a valid MongoDB ObjectId.`,
        };
      }
      return {
        ok: true,
        roleFilter: { franchise_id: new mongoose.Types.ObjectId(franchiseIdFilter) },
      };
    }
    return { ok: true, roleFilter: {} };
  }

  const callerFranchise = callerFranchiseOid ?? caller.franchise_id ?? null;

  if ([USER_TYPE_FRANCHISE_ADMIN, USER_TYPE_EMPLOYEE].includes(caller.type) && !callerFranchise) {
    return {
      ok: false,
      status: 403,
      message: 'Franchise not found for your account.',
    };
  }

  if (
    franchiseIdFilter &&
    callerFranchise &&
    String(franchiseIdFilter) !== String(callerFranchise)
  ) {
    return {
      ok: false,
      status: 403,
      message: 'You are not allowed to view users for this franchise.',
    };
  }

  const allowedTypes = [1, 2, 3, 4];
  if (Number.isInteger(type) && !allowedTypes.includes(type)) {
    return {
      ok: false,
      status: 403,
      message: 'You are not allowed to access this user type.',
    };
  }
  return {
    ok: true,
    roleFilter: {
      type: { $in: allowedTypes },
      franchise_id: callerFranchise,
    },
  };
}

async function applyType4FranchiseScope(roleFilter, franchiseOid) {
  const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null })
    .select('area_id')
    .lean();
  if (!franchise) {
    return { ok: false, status: 404, message: 'Franchise not found.' };
  }

  const pincodeUserIds = await getFranchiseCustomerUserIdsByPincode(franchise);
  const { franchise_id, ...restRole } = roleFilter;
  return {
    ok: true,
    roleFilter: {
      ...restRole,
      $or: [
        { franchise_id: franchiseOid },
        { _id: { $in: pincodeUserIds } },
      ],
    },
  };
}

/**
 * Approved partners (verification_status 2) list buckets:
 * - Active: is_blocked false, is_active true
 * - Inactive: is_blocked false, is_active false
 * - Blocked: is_blocked true, is_active false
 */
function buildPartnerListStatusFilter(query) {
  const activeRaw = query.is_active;
  const blockedRaw = query.is_blocked;
  const hasActive =
    activeRaw !== undefined && activeRaw !== null && String(activeRaw).trim() !== '';
  const hasBlocked =
    blockedRaw !== undefined && blockedRaw !== null && String(blockedRaw).trim() !== '';

  if (!hasActive && !hasBlocked) return {};

  const isBlocked = hasBlocked ? parseBoolean(blockedRaw) : null;
  const isActive = hasActive ? parseBoolean(activeRaw) : null;

  if (isBlocked === true) {
    return { is_blocked: true, is_active: false };
  }
  if (isActive === true) {
    return { is_blocked: false, is_active: true };
  }
  if (isActive === false) {
    return { is_blocked: false, is_active: false };
  }
  if (isBlocked === false) {
    return { is_blocked: false };
  }
  return {};
}

/** GET /user/getAll ?is_verified= for type=2. Omitted → verified only (2), matching previous hardcoded filter. */
function resolvePartnerListVerificationStatus(isVerifiedRaw) {
  if (isVerifiedRaw === undefined || isVerifiedRaw === null || String(isVerifiedRaw).trim() === '') {
    return { ok: true, verification_status: 2 };
  }
  const key = String(isVerifiedRaw).trim().toLowerCase();
  if (key === 'approved') return { ok: true, verification_status: 2 };
  if (key === 'pending') return { ok: true, verification_status: 1 };
  if (key === 'rejected') return { ok: true, verification_status: 3 };
  return {
    ok: false,
    message: `${fieldLabel('is_verified')} must be one of: approved, pending, rejected.`,
  };
}

/** Response field for partners: mirrors create/update body `is_verified` strings. */
function verificationStatusToIsVerified(verificationStatus) {
  const n = Number(verificationStatus);
  if (n === 2) return 'approved';
  if (n === 3) return 'rejected';
  return 'pending';
}

/** Accept `verification_rejection_reason` in body; persist as `rejected_reasone`. */
function applyVerificationRejectionReasonInput(data) {
  if (!data || data.verification_rejection_reason === undefined) {
    return;
  }
  const trimmed = String(data.verification_rejection_reason).trim();
  data.rejected_reasone = trimmed;
  delete data.verification_rejection_reason;
}

function partnerRejectionReasonFields(record) {
  const reason = record?.rejected_reasone ?? '';
  return {
    verification_rejection_reason: reason,
    rejected_reasone: reason,
  };
}

function mapPartnerDocumentsForResponse(documents) {
  if (!documents || !Array.isArray(documents)) return [];
  return documents.map((doc) => ({
    ...doc,
    document_id: doc.document_id?._id || null,
    name: doc.document_id?.name || null,
    is_optional: doc.document_id?.is_optional || null,
  }));
}

function partnerServiceRowsToCategoriesAndServices(rows) {
  const categoriesById = new Map();
  const servicesById = new Map();
  for (const r of rows || []) {
    const cat = r.category_id;
    if (cat && typeof cat === 'object' && cat._id) {
      categoriesById.set(cat._id.toString(), {
        category_id: cat._id,
        category_name: cat.name ?? null,
      });
    }
    const svc = r.service_id;
    if (svc && typeof svc === 'object' && svc._id) {
      servicesById.set(svc._id.toString(), {
        service_id: svc._id,
        service_name: svc.name ?? null,
      });
    }
  }
  return {
    categories: [...categoriesById.values()],
    services: [...servicesById.values()],
  };
}

const parseBooleanInput = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
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
    ...(areaId && mongoose.Types.ObjectId.isValid(String(areaId))
      ? { area_id: areaId }
      : {}),
    pincode,
    address_status: addressStatus === undefined ? true : parseBooleanInput(addressStatus),
  });
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
          category_id: svc && typeof svc === 'object' && !Array.isArray(svc) && svc.category_id
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
  body.service_ids !== undefined;

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

/** When frontend sends service_ids + category_ids (+ optional names/descriptions/prices) instead of partner_services. */
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
  const names = coerceArray(body.service_names, []);
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

/** Same resolution as partner create (type 2). */
const resolvePartnerServicesInputFromBody = (body) => {
  const partner_services = body.partner_services;
  const psArr = Array.isArray(partner_services) ? partner_services : [];
  const hasPartnerServicesPayload = psArr.length > 0;
  const pcArr = Array.isArray(body.partner_categories) ? body.partner_categories : [];
  const hasPartnerCategoriesPayload = pcArr.length > 0;
  const hasParallelIds =
    (Array.isArray(body.service_ids) && body.service_ids.length > 0) ||
    (typeof body.service_ids === 'string' && String(body.service_ids).trim() !== '');

  if (hasPartnerServicesPayload) {
    return partner_services;
  }
  if (body.partner_services !== undefined) {
    return partner_services;
  }
  if (!hasPartnerServicesPayload && hasParallelIds) {
    return buildPartnerServicesFromParallelFields(body);
  }
  if (!hasPartnerServicesPayload && !hasParallelIds && hasPartnerCategoriesPayload) {
    return pcArr;
  }
  if (body.partner_categories !== undefined) {
    return pcArr;
  }
  if (body.service_ids !== undefined) {
    return buildPartnerServicesFromParallelFields(body);
  }
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

const normalizePartnerBankAccount = (payload) => {
  const parsed = parseJsonIfString(payload, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rawPrimary = parsed.is_primary ?? parsed.primary_bank_account ?? false;
  const normalizedPrimary =
    typeof rawPrimary === 'string'
      ? rawPrimary.trim().toLowerCase() === 'true'
      : rawPrimary === true;
  return {
    account_holder_name: parsed.account_holder_name ?? parsed.account_name ?? '',
    account_number: parsed.account_number ?? '',
    ifsc_code: parsed.ifsc_code ?? '',
    bank_name: parsed.bank_name ?? '',
    branch_name: parsed.branch_name ?? '',
    is_primary: normalizedPrimary,
  };
};

const normalizePartnerSubscriptionPayload = (payload) => {
  const parsed = parseJsonIfString(payload, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    partner_id: parsed.partner_id ?? parsed.partner ?? null,
    subscription_plan_id: parsed.subscription_plan_id ?? parsed.subscription_plan ?? null,
    started_at:
      parsed.started_at ??
      parsed.subscription_start_date ??
      parsed.start_date ??
      null,
    expires_at:
      parsed.expires_at ??
      parsed.subscription_end_date ??
      parsed.end_date ??
      null,
    status: parsed.status ?? null,
    notes: parsed.notes ?? '',
  };
};

const PARTNER_DOCUMENT_FILE_FIELDS = [
  'vehicle_registration',
  'police_verification_certificate',
  'pan_card',
  'driving_license',
  'aadhar_card',
];

const mergePartnerDocumentPayloadFromMultipart = async (req, partner_documents) => {
  const base = parseJsonIfString(partner_documents, {});
  const merged =
    base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  const files = req.files || {};
  for (const field of PARTNER_DOCUMENT_FILE_FIELDS) {
    const arr = files[field];
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
  /** Match multipart slugs (e.g. pan_card) and JSON keys to Document.name whether stored with spaces or underscores. */
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
  if (Object.keys(documentImageById).length === 0) {
    return false;
  }
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

/** Ensure partner_document rows exist for each active master Document (same as create). */
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

async function upsertPartnerBankAccountForPartner(partnerId, normalizedBankAccount) {
  if (!normalizedBankAccount) return { ok: true };
  const bankAccountNumber =
    normalizedBankAccount.account_number != null
      ? String(normalizedBankAccount.account_number).trim()
      : '';
  if (!bankAccountNumber) return { ok: true };

  const partnerOid =
    partnerId instanceof mongoose.Types.ObjectId
      ? partnerId
      : new mongoose.Types.ObjectId(String(partnerId));

  const takenByOther = await PartnerBankAccount.findOne({
    account_number: bankAccountNumber,
    deleted_at: null,
    partner_id: { $ne: partnerOid },
  }).lean();
  if (takenByOther) {
    return { ok: false, status: 409, message: 'Account number already exists.' };
  }

  let account = await PartnerBankAccount.findOne({
    partner_id: partnerOid,
    deleted_at: null,
    is_primary: true,
  });
  if (!account) {
    account = await PartnerBankAccount.findOne({
      partner_id: partnerOid,
      deleted_at: null,
    }).sort({ created_at: 1 });
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

  if (account) {
    Object.assign(account, fields);
    await account.save();
  } else {
    await PartnerBankAccount.create({
      partner_id: partnerOid,
      ...fields,
      created_at: new Date(),
      deleted_at: null,
    });
  }
  return { ok: true };
}


const changePassword = async (req, res) => {
  try {
    const { new_password, user_id, type } = req.body;
    const normalizedType = Number(type);

    const user = await User.findOne({ _id: user_id, type: normalizedType, deleted_at: null }).select('+password'); // Include password explicitly

    if (!user) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }
    user.password = new_password;
    await user.save()
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Password change successfully.',
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};
const getAllOld = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = parseInt(req.query.type);

    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;


    const filter = {
      deleted_at: null,
      ...(req.query.type && { type: type }),
      ...(req.query.is_active && { is_active: is_active }),
    };
    if (req.query.first_name) {
      filter.first_name = { $regex: new RegExp(req.query.first_name, "i") };
    }
    if (req.query.last_name) {
      filter.last_name = { $regex: new RegExp(req.query.last_name, "i") };
    }
    if (req.query.phone_number) {
      filter.phone_number = { $regex: new RegExp(req.query.phone_number, "i") };
    }
    const sort = { created_at: -1 };

    const projection = { password: 0, auth_token: 0 };
    const { data: users, totalCount, totalPages, currentPage } = await applyPagination(
      User,
      filter,
      page,
      limit,
      sort,
      projection,
    );

    if (type === 1) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: "User list fetched successfully.",
        totalItems: totalCount,
        totalPages,
        currentPage,
        records: users,
      });
    }
    const safeUsersForPopulate = sanitizeUserLocationRefsForPopulate(users);
    const populatedUser = await User.populate(safeUsersForPopulate, [
      { path: "state_id" },
      { path: "city_id" },
    ]);


    const processedUsers = populatedUser.map(user => {
      const { state_id, city_id, ...rest } = user;
      return {
        ...rest,
        state_id: user.state_id._id,
        state_name: user.state_id.name,

        city_id: user.city_id._id,
        city_name: user.city_id.name,
      };
    })
    return res.status(200).json({
      success: true,
      status: 200,
      message: "User list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedUsers,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = parseInt(req.query.type);
    const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');

    if (!caller) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid token.',
      });
    }

    const franchiseIdFilter = typeof req.query.franchise_id === 'string' ? req.query.franchise_id.trim() : null;
    const callerFranchiseOid = await resolveCallerFranchiseOid(caller, req.user.id);

    let partnerListVerificationStatus;
    if (type === USER_TYPE_PARTNER) {
      const vr = resolvePartnerListVerificationStatus(req.query.is_verified);
      if (!vr.ok) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: vr.message,
        });
      }
      partnerListVerificationStatus = vr.verification_status;
    }

    const roleResult = buildUserListRoleFilter(caller, {
      franchiseIdFilter,
      type,
      partnerListVerificationStatus,
      callerFranchiseOid,
    });
    if (!roleResult.ok) {
      return res.status(roleResult.status).json({
        success: false,
        status: roleResult.status,
        message: roleResult.message,
      });
    }
    let roleFilter = roleResult.roleFilter;

    const effectiveFranchiseOid = resolveEffectiveFranchiseOid(caller, franchiseIdFilter, callerFranchiseOid);
    if (type === USER_TYPE_CUSTOMER && effectiveFranchiseOid) {
      const type4Scope = await applyType4FranchiseScope(roleFilter, effectiveFranchiseOid);
      if (!type4Scope.ok) {
        return res.status(type4Scope.status).json({
          success: false,
          status: type4Scope.status,
          message: type4Scope.message,
        });
      }
      roleFilter = type4Scope.roleFilter;
    }

    const partnerStatusFilter =
      type === USER_TYPE_PARTNER ? buildPartnerListStatusFilter(req.query) : {};
    const is_active =
      type !== USER_TYPE_PARTNER && req.query.is_active !== undefined
        ? parseBoolean(req.query.is_active)
        : null;
    const is_blocked =
      type !== USER_TYPE_PARTNER && req.query.is_blocked !== undefined
        ? parseBoolean(req.query.is_blocked)
        : null;

    const searchTerm = req.query.keyword ?? req.query.search;
    let regex;
    if (searchTerm) {
      const sanitizedKeyword = sanitizeInput(searchTerm);
      regex = new RegExp(sanitizedKeyword, 'i');
    }

    const filter = {
      ...roleFilter,
      deleted_at: null,
      ...(req.query.type && { type: type }),
      ...(type === 2 && { verification_status: partnerListVerificationStatus }),
      ...partnerStatusFilter,
      ...(type !== 2 && req.query.is_active !== undefined && req.query.is_active !== null && String(req.query.is_active).trim() !== '' && { is_active: is_active }),
      ...(type !== 2 && req.query.is_blocked !== undefined && { is_blocked: is_blocked }),
      ...(searchTerm && {
        $or: type === 2
          ? [{ name: regex }]
          : [
              { name: regex },
              { email: regex },
              { phone_number: regex },
            ]
      })
    };

    const sort = buildGetAllSort(req.query);

    const projection = { password: 0, auth_token: 0 };
    const { data: users, totalCount, totalPages, currentPage } = await applyPagination(
      User,
      filter,
      page,
      limit,
      sort,
      projection,
    );
    if (type === 1) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: "User list fetched successfully.",
        totalItems: totalCount,
        totalPages,
        currentPage,
        records: users,
      });
    }
    const populatedUser = await User.populate(users, [
      { path: "state_id" },
      { path: "city_id" },
    ]);

    const partnerIdsInPage = populatedUser.filter((u) => Number(u.type) === 2).map((u) => u._id);
    const partnerIdToServiceRows = new Map();
    const partnerIdToRichUser = new Map();
    const partnerIdToBank = new Map();
    const partnerIdToSubs = new Map();

    if (partnerIdsInPage.length > 0) {
      const partnerServiceRows = await PartnerServices.find({
        partner_id: { $in: partnerIdsInPage },
        deleted_at: null,
      })
        .populate([
          { path: 'category_id', select: 'name' },
          { path: 'service_id', select: 'name' },
        ])
        .lean();

      for (const row of partnerServiceRows) {
        const key = row.partner_id.toString();
        if (!partnerIdToServiceRows.has(key)) partnerIdToServiceRows.set(key, []);
        partnerIdToServiceRows.get(key).push(row);
      }

      const richPartners = await User.find({ _id: { $in: partnerIdsInPage } })
        .populate({ path: 'documents', populate: { path: 'document_id', model: 'document' } })
        .populate({ path: 'business_info_id' })
        .lean();
      for (const rp of richPartners) {
        partnerIdToRichUser.set(rp._id.toString(), rp);
      }

      const banks = await PartnerBankAccount.find({
        partner_id: { $in: partnerIdsInPage },
        is_primary: true,
        deleted_at: null,
      }).lean();
      for (const b of banks) {
        partnerIdToBank.set(String(b.partner_id), b);
      }

      const subs = await PartnerSubscription.find({
        partner_id: { $in: partnerIdsInPage },
        deleted_at: null,
      })
        .populate({ path: 'subscription_plan_id' })
        .sort({ created_at: -1 })
        .lean();
      for (const s of subs) {
        const key = s.partner_id.toString();
        if (!partnerIdToSubs.has(key)) partnerIdToSubs.set(key, []);
        partnerIdToSubs.get(key).push(s);
      }
    }

    const processedUsers = await Promise.all(populatedUser.map(async user => {
      const service_count_data = await getServiceCountData(user._id);
      const { state_id, city_id, ...rest } = user;
      let addressField = rest.address;
      let type4AreaMap = null;
      if (user.type === 4) {
        addressField = await Address.find({
          user_id: user._id,
          deleted_at: null,
        })
          .sort({ created_at: 1 })
          .select('contact_name contact_number address landmark area area_id state_id city_id state city pincode address_status created_at updated_at')
          .lean();
        type4AreaMap = await buildAreaIdToNameMap([
          rest.area_id,
          ...addressField.map((a) => a.area_id),
        ]);
        addressField = attachAreaNamesToAddresses(addressField, type4AreaMap);
      }
      const row = {
        ...rest,
        address: addressField,
        state_id: user?.state_id?._id || null,
        state_name: user?.state_id?.name || null,

        city_id: user?.city_id?._id || null,
        city_name: user?.city_id?.name || null,
        ...(user.type === 4 && {
          area_name: resolveAreaName(rest.area_id, type4AreaMap),
        }),

        total_service: service_count_data.total_service,
        service_paid: service_count_data.service_paid,
        service_unpaid: service_count_data.service_unpaid,
        in_progress_service: service_count_data.in_progress_service,
        completed_service: service_count_data.completed_service,
        cancelled_service: service_count_data.cancelled_service,
        no_of_services: service_count_data.no_of_services,

        balance_amount: service_count_data.balance_amount,
        total_amount: service_count_data.total_amount,
        paid_amount: service_count_data.paid_amount,
        rating: 0,//This is in Phaase 2
        total_earnings: 0,
        bal_payment: 0,
      };

      if (Number(user.type) === 2) {
        const pid = user._id.toString();
        row.last_service_date = await getLastServiceDate(user._id, user.type);

        const rich = partnerIdToRichUser.get(pid);
        if (rich) {
          row.documents = mapPartnerDocumentsForResponse(rich.documents);
          if (user.is_business === true && rich.business_info_id) {
            const bi = rich.business_info_id;
            row.business_info_id = bi?._id ?? user.business_info_id ?? null;
            row.business_info_name = bi?.name ?? null;
            row.business_info_phone_number = bi?.phone_number ?? null;
            row.business_info_email = bi?.email ?? null;
            row.business_info_provided_service = bi?.provided_service ?? null;
          }
        }

        row.bank_account = partnerIdToBank.get(pid) ?? null;

        const psRows = partnerIdToServiceRows.get(pid) || [];
        row.partner_services = psRows;
        const agg = partnerServiceRowsToCategoriesAndServices(psRows);
        row.categories = agg.categories;
        row.services = agg.services;

        row.partner_subscriptions = partnerIdToSubs.get(pid) ?? [];

        row.is_verified = verificationStatusToIsVerified(row.verification_status);
        Object.assign(row, partnerRejectionReasonFields(row));
      }

      return row;
    }));





    let finalRecords = processedUsers;
    if (type === 2) {
      const sortByRaw = req.query.sort_by ?? req.query.sortBy;
      const sortDirection = getSortDirection(req.query, -1);
      if (sortByRaw === 'name') {
        finalRecords = [...processedUsers].sort((a, b) => {
          const aName = String(a?.name ?? '').toLowerCase();
          const bName = String(b?.name ?? '').toLowerCase();
          if (aName < bName) return -1 * sortDirection;
          if (aName > bName) return 1 * sortDirection;
          return 0;
        });
      } else if (sortByRaw === 'no_of_services') {
        finalRecords = [...processedUsers].sort((a, b) => {
          const aCount = Number(a?.no_of_services ?? 0);
          const bCount = Number(b?.no_of_services ?? 0);
          return (aCount - bCount) * sortDirection;
        });
      }
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "User list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: finalRecords,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getVerificationAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');

    if (!caller) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid token.',
      });
    }

    const franchiseIdFilter = pickFranchiseIdFromRequest(req);
    const callerFranchiseOid = await resolveCallerFranchiseOid(caller, req.user.id);

    const verificationStatusRaw = req.query.verification_status;
    let verificationFilter;
    if (
      verificationStatusRaw !== undefined &&
      verificationStatusRaw !== null &&
      String(verificationStatusRaw).trim() !== ''
    ) {
      const vs = parseInt(String(verificationStatusRaw).trim(), 10);
      if (![1, 2, 3].includes(vs)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `${fieldLabel('verification_status')} must be 1, 2, or 3.`,
        });
      }
      verificationFilter = { verification_status: vs };
    } else {
      verificationFilter = { verification_status: { $in: [1, 3] } };
    }

    const verificationStatuses =
      verificationFilter.verification_status?.$in ?? [verificationFilter.verification_status];
    const includesPendingVerification = verificationStatuses.includes(1);

    const roleResult = buildUserListRoleFilter(caller, {
      franchiseIdFilter,
      type: USER_TYPE_PARTNER,
      partnerListVerificationStatus: includesPendingVerification ? 1 : verificationStatuses[0],
      callerFranchiseOid,
    });
    if (!roleResult.ok) {
      return res.status(roleResult.status).json({
        success: false,
        status: roleResult.status,
        message: roleResult.message,
      });
    }

    const roleFilter = roleResult.roleFilter;

    const searchTerm = req.query.keyword ?? req.query.search;
    let regex;
    if (searchTerm) {
      const sanitizedKeyword = sanitizeInput(searchTerm);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
    }
    const filter = {
      deleted_at: null,
      type: USER_TYPE_PARTNER,
      ...roleFilter,
      ...verificationFilter,
      ...(searchTerm && { name: regex })
    };
    
    const sortByRaw = req.query.sort_by ?? req.query.sortBy;
    const orderRaw = String(req.query.sort_order ?? req.query.sortOrder ?? '').toLowerCase();
    let sort = { created_at: req.query.sort !== undefined ? parseInt(req.query.sort) : -1 };
    if (sortByRaw && VERIFICATION_SORT_FIELDS.includes(sortByRaw)) {
      let direction;
      if (orderRaw === 'asc' || orderRaw === '1') direction = 1;
      else if (orderRaw === 'desc' || orderRaw === '-1') direction = -1;
      else direction = sortByRaw === 'created_at' ? -1 : 1;
      sort = { [sortByRaw]: direction };
    }

    const projection = { password: 0, auth_token: 0 };
    const { data: users, totalCount, totalPages, currentPage } = await applyPagination(
      User,
      filter,
      page,
      limit,
      sort,
      projection,
    );

    const populatedUser = await User.populate(users, [
      { path: "state_id" },
      { path: "city_id" },
    ]);

    const partnerIds = populatedUser.map((u) => u._id);
    const partnerServiceRows =
      partnerIds.length === 0
        ? []
        : await PartnerServices.find({
            partner_id: { $in: partnerIds },
            deleted_at: null,
          })
            .populate([
              { path: 'category_id', select: 'name' },
              { path: 'service_id', select: 'name' },
            ])
            .lean();

    const partnerIdToServiceRows = new Map();
    for (const row of partnerServiceRows) {
      const key = row.partner_id.toString();
      if (!partnerIdToServiceRows.has(key)) partnerIdToServiceRows.set(key, []);
      partnerIdToServiceRows.get(key).push(row);
    }

    const processedUsers = await Promise.all(populatedUser.map(async user => {
      const document_uploaded_count = await getVerificationCountData(user._id);
      const { state_id, city_id, ...rest } = user;
      const rows = partnerIdToServiceRows.get(user._id.toString()) || [];
      const categoriesById = new Map();
      const servicesById = new Map();
      for (const r of rows) {
        const cat = r.category_id;
        if (cat && typeof cat === 'object' && cat._id) {
          categoriesById.set(cat._id.toString(), {
            category_id: cat._id,
            category_name: cat.name ?? null,
          });
        }
        const svc = r.service_id;
        if (svc && typeof svc === 'object' && svc._id) {
          servicesById.set(svc._id.toString(), {
            service_id: svc._id,
            service_name: svc.name ?? null,
          });
        }
      }
      return {
        ...rest,
        state_id: user.state_id._id,
        state_name: user.state_id.name,

        city_id: user.city_id._id,
        city_name: user.city_id.name,
        document_uploaded_count,
        categories: [...categoriesById.values()],
        services: [...servicesById.values()],
      };
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: "User list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedUsers,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      name,
      email,
      phone_number,
      address,
      state_id,
      city_id,
      area_id,
      pincode,
      profile_url,
      password,
      is_from_web,
      is_active,
      is_blocked,
      is_business,
      type,
      registration_type,
      device_token,
      business_name,
      business_email,
      business_phone_number,
      provided_service,
      created_by_id,
      franchise_id,
      accessible_screens,
      chat,
      partner_services,
      partner_documents,
      bank_account,
      partner_subscription,
      date_of_birth,
      gender,
      experience,
      rejected_reasone,
      verification_rejection_reason,
    } = req.body;
    const userType = Number(type);
    const resolvedPartnerServicesInput =
      userType === 2 ? resolvePartnerServicesInputFromBody(req.body) : null;
    let resolvedProfileUrl = profile_url;
    const profileUpload = req.files?.image?.[0] || req.file;
    if (profileUpload) {
      resolvedProfileUrl = await handleImageUpload(profileUpload, getUploadType(4), true, null);
    }
    const resolvedChat =
      userType === 3
        ? (chat !== undefined ? chat : true)
        : chat;
    let partnerVerificationFields = {};
    if (userType === 2) {
      partnerVerificationFields = { verification_status: 1, verified_at: null };
    }
    const resolvedIsActive =
      userType === 2
        ? false
        : (is_active !== undefined
            ? is_active
            : false);
    const normalizedEmail = normalizeUserEmail(email);
    const normalizedPhone = normalizeUserPhone(phone_number);
    const uniqueness = await checkUserContactUniqueness({
      email: normalizedEmail,
      phone_number: normalizedPhone,
    });
    if (!uniqueness.ok) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: uniqueness.message,
      });
    }
    if (
      franchise_id != null &&
      String(franchise_id).trim() !== '' &&
      mongoose.Types.ObjectId.isValid(String(franchise_id))
    ) {
      const franchise = await Franchise.findOne({ _id: franchise_id, deleted_at: null }).lean();
      if (!franchise) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Franchise not found.',
        });
      }
    }

    if (is_business === true && userType === 2) {
      const existingBusiness = await BusinessInfo.findOne({
        $or: [
          { business_phone_number },
          { business_email },
        ],
        deleted_at: null
      });
      if (existingBusiness) {

        let message = '';
        if (existingBusiness.phone_number === phone_number) {
          message = 'Business phone number already exists.';
        } else if (existingBusiness.email === email) {
          message = 'Business email already exists.';
        }
        return res.status(409).json({
          success: false,
          status: 409,
          message,
        });
      }
    }
    const registration_id = await getNewId(0);
    const user_id = await getNewId(Number.isFinite(userType) ? userType : type);
    const _id = new mongoose.Types.ObjectId();
    const normalizedScreens =
      Array.isArray(accessible_screens) && accessible_screens.length > 0
        ? accessible_screens.map((p) => ({
            page: String(p.page).trim(),
            url: String(p.url).trim(),
          }))
        : [];
    const newUser = new User({
      _id: _id,
      registration_id,
      user_id,
      name,
      email: normalizedEmail,
      phone_number: normalizedPhone,
      address,
      state_id,
      city_id,
      ...(area_id != null &&
      String(area_id).trim() !== '' &&
      mongoose.Types.ObjectId.isValid(String(area_id))
        ? { area_id }
        : {}),
      pincode,
      profile_url: resolvedProfileUrl,
      is_from_web,
      is_active: resolvedIsActive,
      ...partnerVerificationFields,
      ...(is_blocked !== undefined ? { is_blocked } : {}),
      chat: resolvedChat,
      is_business,
      type: Number.isFinite(userType) ? userType : type,
      registration_type,
      device_token,
      created_by_id,
      franchise_id,
      accessible_screens: normalizedScreens,
      date_of_birth: date_of_birth === undefined ? null : date_of_birth,
      gender:
        gender === undefined || gender === null || String(gender).trim() === ''
          ? null
          : String(gender).trim().toLowerCase(),
      experience:
        experience === undefined || experience === null || String(experience).trim() === ''
          ? null
          : String(experience).trim(),
      rejected_reasone:
        verification_rejection_reason !== undefined && verification_rejection_reason !== null
          ? String(verification_rejection_reason).trim()
          : rejected_reasone !== undefined && rejected_reasone !== null
            ? String(rejected_reasone).trim()
            : '',
    });

    if (is_business === true && userType === 2) {
      const business_info_id = new mongoose.Types.ObjectId();
      const business_info = new BusinessInfo({
        _id: business_info_id,
        user_id: _id,
        name: business_name,
        email: business_email,
        phone_number: business_phone_number,
        provided_service,
      });
      await business_info.save();
      newUser.business_info_id = business_info_id;
    }
    newUser.password = password;
    newUser.last_signin = new Date();
    newUser.auth_token = newUser.generateAuthToken();

    if (userType === 2) {
      const documentList = await getDocumentList();
      const filesForPartnerDocs = req.files || {};
      const hasVerificationUploads = PARTNER_DOCUMENT_FILE_FIELDS.some((f) => filesForPartnerDocs[f]?.[0]);
      if (documentList.length === 0 && hasVerificationUploads) {
        console.warn(
          '[user/create] Verification files were sent but the master Document catalog has no active rows (is_active: true). No partner_document rows are inserted; uploads cannot be linked.'
        );
      }
      let partnerDocumentIds = [];
      if (documentList.length > 0) {
        const documents = documentList.map((document) => ({
          _id: new mongoose.Types.ObjectId(),
          partner_id: _id,
          document_id: document._id,
        }));
        const result = await createMultiple(documents);
        if (result.success !== true) {
          return res.status(result.status).json(result);
        }
        partnerDocumentIds = documents.map((document) => document._id);
      }
      newUser.documents = partnerDocumentIds;

      const normalizedServiceRows = normalizePartnerServices(
        resolvedPartnerServicesInput ?? []
      );

      const savedUser = await newUser.save();
      if (normalizedServiceRows.length > 0) {
        await replacePartnerCategoriesFromSignupRows(_id, normalizedServiceRows);
      }

      const mergedPartnerDocs = await mergePartnerDocumentPayloadFromMultipart(req, partner_documents);
      await applyPartnerDocumentImageUpdates(
        savedUser._id,
        normalizePartnerDocuments(mergedPartnerDocs)
      );

      const normalizedBankAccount = normalizePartnerBankAccount(
        bank_account ?? {
          account_name: req.body.account_name,
          account_holder_name: req.body.account_holder_name,
          account_number: req.body.account_number,
          ifsc_code: req.body.ifsc_code,
          bank_name: req.body.bank_name,
          branch_name: req.body.branch_name,
          primary_bank_account: req.body.primary_bank_account,
          is_primary: req.body.is_primary,
        }
      );
      const bankAccountNumber =
        normalizedBankAccount && normalizedBankAccount.account_number != null
          ? String(normalizedBankAccount.account_number).trim()
          : '';
      if (normalizedBankAccount && bankAccountNumber) {
        const existingAccount = await PartnerBankAccount.findOne({
          account_number: bankAccountNumber,
          deleted_at: null,
        });
        if (!existingAccount) {
          await PartnerBankAccount.create({
            partner_id: savedUser._id,
            bank_name: normalizedBankAccount.bank_name,
            account_holder_name: normalizedBankAccount.account_holder_name,
            account_number: bankAccountNumber,
            ifsc_code: normalizedBankAccount.ifsc_code,
            branch_name: normalizedBankAccount.branch_name,
            is_primary: normalizedBankAccount.is_primary === true,
          });
        }
      }

      const normalizedSubscription = normalizePartnerSubscriptionPayload(
        partner_subscription ?? {
          partner: req.body.partner,
          partner_id: req.body.partner_id,
          subscription_plan: req.body.subscription_plan,
          subscription_plan_id: req.body.subscription_plan_id,
          subscription_start_date: req.body.subscription_start_date,
          started_at: req.body.started_at,
          start_date: req.body.start_date,
          subscription_end_date: req.body.subscription_end_date,
          expires_at: req.body.expires_at,
          end_date: req.body.end_date,
          status: req.body.status,
          notes: req.body.notes,
        }
      );
      if (normalizedSubscription && normalizedSubscription.subscription_plan_id) {
        const resolvedStatus =
          normalizedSubscription.status === 'inactive'
            ? 'cancelled'
            : normalizedSubscription.status;
        const subscriptionResult = await partnerSubscriptionService.createPartnerSubscription(
          {
            partner_id: savedUser._id,
            subscription_plan_id: normalizedSubscription.subscription_plan_id,
            started_at: normalizedSubscription.started_at,
            expires_at: normalizedSubscription.expires_at,
            status: resolvedStatus,
            notes: normalizedSubscription.notes,
          },
          created_by_id
        );
        if (!subscriptionResult.ok) {
          return res.status(subscriptionResult.status).json({
            success: false,
            status: subscriptionResult.status,
            message: subscriptionResult.message,
          });
        }
      }

      await createAddressRecord({
        userId: savedUser._id,
        name: savedUser.name,
        phoneNumber: savedUser.phone_number,
        address: savedUser.address,
        stateId: savedUser.state_id,
        cityId: savedUser.city_id,
        areaId: savedUser.area_id,
        pincode: savedUser.pincode,
      });
      const notificationSettings = new notificationSetting({
        user_id: savedUser._id,
      });
      await notificationSettings.save();
      const { documents: _, ...userWithoutDocuments } = savedUser.toObject();
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'User created successfully.',
        record: userWithoutDocuments,
      });
    }

    const savedUser = await newUser.save();
    await createAddressRecord({
      userId: savedUser._id,
      name: savedUser.name,
      phoneNumber: savedUser.phone_number,
      address: savedUser.address,
      stateId: savedUser.state_id,
      cityId: savedUser.city_id,
      areaId: savedUser.area_id,
      pincode: savedUser.pincode,
    });
    const notificationSettings = new notificationSetting({
      user_id: savedUser._id,
    });
    await notificationSettings.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User created successfully.',
      record: savedUser,
    });
  } catch (error) {
    console.error('Error creating User:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = { ...req.body };
  applyVerificationRejectionReasonInput(updateData);

  try {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: `${fieldLabel('user_id')} not found`
      });
    }

    const user = await User.findOne({ _id: id, deleted_at: null });

    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'User not found'
      });
    }
    if (req.files?.image?.[0] || req.file) {
      const profileUpload = req.files?.image?.[0] || req.file;
      updateData.profile_url = await handleImageUpload(
        profileUpload,
        getUploadType(4),
        true,
        null
      );
    }

    if (updateData.accessible_screens !== undefined) {
      if (Array.isArray(updateData.accessible_screens) && updateData.accessible_screens.length > 0) {
        updateData.accessible_screens = updateData.accessible_screens.map((p) => ({
          page: String(p.page).trim(),
          url: String(p.url).trim(),
        }));
      } else {
        updateData.accessible_screens = [];
      }
    }
    const shouldAddNewAddress =
      parseBooleanInput(updateData.add_new_address) ||
      parseBooleanInput(updateData.is_additional_address);
    const hasAddressPayload =
      updateData.address !== undefined ||
      updateData.state_id !== undefined ||
      updateData.city_id !== undefined ||
      updateData.pincode !== undefined;
    const hasAddressStatusPayload = updateData.address_status !== undefined;
    const targetAddressId = updateData.address_id;
    let didAddNewAddress = false;
    if (shouldAddNewAddress) {
      if (
        !hasAddressPayload ||
        !updateData.address ||
        String(updateData.address).trim() === '' ||
        !updateData.state_id ||
        String(updateData.state_id).trim() === '' ||
        !mongoose.Types.ObjectId.isValid(String(updateData.state_id)) ||
        !updateData.city_id ||
        String(updateData.city_id).trim() === '' ||
        !mongoose.Types.ObjectId.isValid(String(updateData.city_id)) ||
        !updateData.pincode ||
        String(updateData.pincode).trim() === ''
      ) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `Address, ${fieldLabel('state_id')}, ${fieldLabel('city_id')}, and pincode are required to add a new address.`,
        });
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
      didAddNewAddress = true;
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
    const effectiveType = updateData.type !== undefined ? updateData.type : user.type;
    const effectiveFranchiseId = updateData.franchise_id !== undefined ? updateData.franchise_id : user.franchise_id;
    if ([1, 3].includes(effectiveType) && effectiveFranchiseId) {
      const franchise = await Franchise.findOne({ _id: effectiveFranchiseId, deleted_at: null }).lean();
      if (!franchise) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Franchise not found.',
        });
      }
    }
    if (Number(user.type) === 2 && updateData.is_verified !== undefined && updateData.is_verified !== null && String(updateData.is_verified).trim() !== '') {
      const vKey = String(updateData.is_verified).trim().toLowerCase();
      if (vKey === 'approved') {
        updateData.verification_status = 2;
        updateData.verified_at = new Date();
        updateData.is_active = true;
        updateData.rejected_reasone = '';
      } else if (vKey === 'rejected') {
        updateData.verification_status = 3;
        updateData.verified_at = null;
        updateData.is_active = false;
        if (updateData.rejected_reasone !== undefined && updateData.rejected_reasone !== null) {
          updateData.rejected_reasone = String(updateData.rejected_reasone).trim();
        }
      } else if (vKey === 'pending') {
        updateData.verification_status = 1;
        updateData.verified_at = null;
        updateData.rejected_reasone = '';
      }
      delete updateData.is_verified;
    }
    if (effectiveType === 4) {
      const finalName = updateData.name !== undefined ? updateData.name : user.name;
      const finalEmail = updateData.email !== undefined ? updateData.email : user.email;
      const finalPhoneNumber = updateData.phone_number !== undefined ? updateData.phone_number : user.phone_number;
      const finalProfileUrl = updateData.profile_url !== undefined ? updateData.profile_url : user.profile_url;

      if (!finalName || String(finalName).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Name is required.'
        });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!finalEmail || String(finalEmail).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Email is required.'
        });
      }
      if (!emailRegex.test(String(finalEmail))) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid email format.'
        });
      }
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!finalPhoneNumber || String(finalPhoneNumber).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Phone number is required.'
        });
      }
      if (!phoneRegex.test(String(finalPhoneNumber))) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid phone number format.'
        });
      }
      if (!didAddNewAddress && (!finalProfileUrl || String(finalProfileUrl).trim() === '')) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Profile photo is required.'
        });
      }
    }

    if (effectiveType === 3 && updateData.chat === undefined && (user.chat === undefined || user.chat === null)) {
      updateData.chat = true;
    }

    if (updateData.is_blocked !== undefined) {
      const blocked = parseBooleanInput(updateData.is_blocked);
      updateData.is_blocked = blocked;
      if (blocked === true) {
        updateData.is_active = false;
      }
    }

    if (
      Number(user.type) === 2 &&
      updateData.is_active !== undefined &&
      updateData.is_active !== null &&
      parseBooleanInput(updateData.is_active)
    ) {
      const nextVerificationStatus =
        updateData.verification_status !== undefined
          ? Number(updateData.verification_status)
          : Number(user.verification_status);
      if (nextVerificationStatus === 1) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Documents verification is pending.',
        });
      }
    }

    // Only allow explicit fields to be updated.
    const ALLOWED_UPDATE_FIELDS = new Set([
      'name',
      'email',
      'phone_number',
      'address',
      'state_id',
      'city_id',
      'area_id',
      'pincode',
      'profile_url',
      'is_from_web',
      'is_active',
      'is_blocked',
      'is_business',
      'type',
      'registration_type',
      'device_token',
      'created_by_id',
      'franchise_id',
      'accessible_screens',
      'chat',
      'verification_status',
      'verification_id',
      'verified_at',
      'rejected_reasone',
      'provided_service',
      'business_info_id',
      'password',
      'date_of_birth',
      'gender',
      'experience',
    ]);

    Object.keys(updateData).forEach((key) => {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        user[key] = updateData[key];
      }
    });

    const updatedUser = await user.save();
    if (!shouldAddNewAddress && (hasAddressPayload || hasAddressStatusPayload)) {
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
          if (updateData.address !== undefined) {
            targetAddress.address = String(updateData.address);
          }
          if (updateData.state_id !== undefined) {
            targetAddress.state_id = updateData.state_id;
          }
          if (updateData.city_id !== undefined) {
            targetAddress.city_id = updateData.city_id;
          }
          if (updateData.area_id !== undefined) {
            targetAddress.area_id =
              updateData.area_id != null &&
              String(updateData.area_id).trim() !== '' &&
              mongoose.Types.ObjectId.isValid(String(updateData.area_id))
                ? updateData.area_id
                : null;
          }
          if (updateData.pincode !== undefined) {
            targetAddress.pincode = String(updateData.pincode);
          }
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
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Address not found for this user.',
        });
      }
    }
    const hasPartnerDocFiles = PARTNER_DOCUMENT_FILE_FIELDS.some((f) => req.files?.[f]?.[0]);
    const shouldRunPartnerExtras =
      effectiveType === 2 &&
      (hasNonEmptyPartnerCatalogPayload(updateData) ||
        updateData.partner_documents !== undefined ||
        updateData.bank_account !== undefined ||
        updateData.account_number !== undefined ||
        updateData.account_holder_name !== undefined ||
        updateData.partner_subscription !== undefined ||
        updateData.subscription_plan_id !== undefined ||
        hasPartnerDocFiles);
    if (shouldRunPartnerExtras) {
      await ensurePartnerDocumentCatalogRows(updatedUser._id, updatedUser);

      const mergedPartnerDocs = await mergePartnerDocumentPayloadFromMultipart(
        req,
        updateData.partner_documents
      );
      const documentsUpdated = await applyPartnerDocumentImageUpdates(
        updatedUser._id,
        normalizePartnerDocuments(mergedPartnerDocs)
      );
      if (documentsUpdated && applyPartnerUserStatusAfterDocumentUpload(updatedUser)) {
        await updatedUser.save();
      }

      if (hasNonEmptyPartnerCatalogPayload(updateData)) {
        const resolvedPartnerServicesInput = resolvePartnerServicesInputFromBody(updateData);
        const normalizedServiceRows = normalizePartnerServices(
          resolvedPartnerServicesInput ?? []
        );
        await mergePartnerCatalogFromNormalizedRows(
          updatedUser._id,
          normalizedServiceRows
        );
      }

      const hasBankPayload =
        updateData.bank_account !== undefined ||
        updateData.account_number !== undefined ||
        updateData.account_holder_name !== undefined;
      if (hasBankPayload) {
        const normalizedBankAccount = normalizePartnerBankAccount(
          updateData.bank_account ?? {
            account_name: updateData.account_name,
            account_holder_name: updateData.account_holder_name,
            account_number: updateData.account_number,
            ifsc_code: updateData.ifsc_code,
            bank_name: updateData.bank_name,
            branch_name: updateData.branch_name,
            primary_bank_account: updateData.primary_bank_account,
            is_primary: updateData.is_primary,
          }
        );
        const bankResult = await upsertPartnerBankAccountForPartner(
          updatedUser._id,
          normalizedBankAccount
        );
        if (!bankResult.ok) {
          return res.status(bankResult.status).json({
            success: false,
            status: bankResult.status,
            message: bankResult.message,
          });
        }
      }

      const hasSubscriptionPayload =
        updateData.partner_subscription !== undefined ||
        updateData.subscription_plan_id !== undefined;
      if (hasSubscriptionPayload) {
        const normalizedSubscription = normalizePartnerSubscriptionPayload(
          updateData.partner_subscription ?? {
            partner: updateData.partner,
            partner_id: updateData.partner_id,
            subscription_plan: updateData.subscription_plan,
            subscription_plan_id: updateData.subscription_plan_id,
            subscription_start_date: updateData.subscription_start_date,
            started_at: updateData.started_at,
            start_date: updateData.start_date,
            subscription_end_date: updateData.subscription_end_date,
            expires_at: updateData.expires_at,
            end_date: updateData.end_date,
            status: updateData.status,
            notes: updateData.notes,
          }
        );
        if (normalizedSubscription && normalizedSubscription.subscription_plan_id) {
          const resolvedStatus =
            normalizedSubscription.status === 'inactive'
              ? 'cancelled'
              : normalizedSubscription.status;
          const subscriptionResult = await partnerSubscriptionService.createPartnerSubscription(
            {
              partner_id: updatedUser._id,
              subscription_plan_id: normalizedSubscription.subscription_plan_id,
              started_at: normalizedSubscription.started_at,
              expires_at: normalizedSubscription.expires_at,
              status: resolvedStatus,
              notes: normalizedSubscription.notes,
            },
            req.user?.id ?? updateData.created_by_id
          );
          if (!subscriptionResult.ok) {
            return res.status(subscriptionResult.status).json({
              success: false,
              status: subscriptionResult.status,
              message: subscriptionResult.message,
            });
          }
        }
      }
    }
    let responseRecord = updatedUser;

    if (effectiveType === 4 || effectiveType === 2) {
      const service_count_data = await getServiceCountData(updatedUser._id);
      const last_service_date = await getLastServiceDate(updatedUser._id, updatedUser.type);
      responseRecord = {
        ...updatedUser.toObject(),
        last_service_date,
        total_service: service_count_data.total_service,
        service_paid: service_count_data.service_paid,
        service_unpaid: service_count_data.service_unpaid,
        in_progress_service: service_count_data.in_progress_service,
        completed_service: service_count_data.completed_service,
        cancelled_service: service_count_data.cancelled_service,
        no_of_services: service_count_data.no_of_services,
        balance_amount: service_count_data.balance_amount,
        total_amount: service_count_data.total_amount,
        paid_amount: service_count_data.paid_amount,
      };
    }
    if (Number(updatedUser.type) === 2) {
      responseRecord = {
        ...(responseRecord.toObject ? responseRecord.toObject() : responseRecord),
        is_verified: verificationStatusToIsVerified(updatedUser.verification_status),
        ...partnerRejectionReasonFields(updatedUser),
      };
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'User updated successfully',
      record: responseRecord,
    });
  } catch (error) {
    console.error('Error updating User:', error);
    const status = Number(error.status) || 500;
    res.status(status).json({
      success: false,
      status,
      message: status === 500 ? 'Internal server error.' : String(error.message || 'Internal server error.'),
    });
  }
};
const getById = async (req, res) => {
  const { id } = req.params;
  try {

    let user = await User.findById(id).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'User not found'
      });
    }

    if (user.type === 1) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'User fetched successfully',
        record: user,
      });
    }


    user = await User.findById(id).populate([
      { path: "state_id" },
      { path: "city_id" },
    ]).lean();

    

    const response = {
      ...user,
      state_id: user.state_id?._id ?? null,
      state_name: user.state_id?.name ?? null,

      city_id: user.city_id?._id ?? null,
      city_name: user.city_id?.name ?? null,

    };
    if (user.type === 4) {
      const addresses = await Address.find({
        user_id: user._id,
        deleted_at: null,
      })
        .sort({ created_at: 1 })
        .select('contact_name contact_number address landmark area area_id state_id city_id state city pincode address_status created_at updated_at')
        .lean();
      const areaMap = await buildAreaIdToNameMap([
        user.area_id,
        ...addresses.map((a) => a.area_id),
      ]);
      response.address = attachAreaNamesToAddresses(addresses, areaMap);
      response.area_name = resolveAreaName(user.area_id, areaMap);
    }
    if (user.type === 4 || user.type === 2) {
      const last_service_date = await getLastServiceDate(user._id, user.type);
      const service_count_data = await getServiceCountData(user._id);
      response.last_service_date = last_service_date;

      response.total_service = service_count_data.total_service;
      response.service_paid = service_count_data.service_paid;
      response.service_unpaid = service_count_data.service_unpaid;
      response.in_progress_service = service_count_data.in_progress_service;
      response.completed_service = service_count_data.completed_service;
      response.cancelled_service = service_count_data.cancelled_service;
      response.no_of_services = service_count_data.no_of_services;

      response.balance_amount = service_count_data.balance_amount;
      response.total_amount = service_count_data.total_amount;
      response.paid_amount = service_count_data.paid_amount;
    }
    if (user.type === 2 && user.is_business === true) {
      user = await User.findById(id).populate([
        { path: "business_info_id" },
      ]).lean();
      response.business_info_id = user.business_info_id?._id ?? null;
      response.business_info_name = user.business_info_id?.name ?? null;
      response.business_info_phone_number = user.business_info_id?.phone_number ?? null;
      response.business_info_email = user.business_info_id?.email ?? null;
      response.business_info_provided_service = user.business_info_id?.provided_service ?? null;
    }
    if (user.type === 2) {

      user = await User.findById(id)
        .populate({
          path: "documents",
          populate: {
            path: "document_id",
            model: "document",
          },
        })
        .lean();

      const mappedDocuments = mapPartnerDocumentsForResponse(user?.documents);
      response.documents = mappedDocuments;
      response.partner_documents = mappedDocuments;

      response.partner_services = await PartnerServices.find({
        partner_id: user._id,
        deleted_at: null,
      })
        .populate([
          { path: 'category_id', select: 'name' },
          { path: 'service_id', select: 'name' },
        ])
        .lean();

      response.partner_subscriptions = await PartnerSubscription.find({
        partner_id: user._id,
        deleted_at: null,
      })
        .populate({ path: 'subscription_plan_id' })
        .sort({ created_at: -1 })
        .lean();

      response.bank_accounts = await PartnerBankAccount.find({
        partner_id: user._id,
        deleted_at: null,
      })
        .sort({ is_primary: -1, created_at: -1 })
        .lean();

      response.is_verified = verificationStatusToIsVerified(user.verification_status);
      Object.assign(response, partnerRejectionReasonFields(user));
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User fetched successfully',
      record: response,
    });
  } catch (error) {
    console.error('Error fetching User:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'User not found'
      });
    }

    if (user.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User is already deleted'
      });
    }

    user.deleted_at = new Date();

    await user.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting User:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getDropDown = async (req, res) => {

  try {
    const type = parseInt(req.query.type);
    const adminWithoutFranchiseFilter =
      type === 1
        ? { $or: [{ franchise_id: null }, { franchise_id: { $exists: false } }] }
        : {};
    const filter = {
      deleted_at: null,
      is_active: true,
      ...(req.query.type && { type: type }),
      ...adminWithoutFranchiseFilter,
    };
    const sort = { created_at: -1 };

    const { data: users, } = await applyDropDownFilter(
      User,
      filter,
      sort
    );
    const processedUser = users.map((user) => ({
      _id: user._id,
      name: user.name ?? null,
    }));
    res.status(200).json({
      success: true,
      status: 200,
      message: "User list fetched successfully.",
      records: processedUser,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message
    });
  }
};
const getPartnerDropDownOld = async (req, res) => {

  try {
    const filter = {
      deleted_at: null,
      is_accept_request: true,
      // is_active:true,
      service_id: new mongoose.Types.ObjectId(req.query.service_id)
    };
    const sort = { created_at: -1 };
    const { data: partners, } = await applyDropDownFilter(
      PartnerServices,
      filter,
      sort
    );

    const populateOptions = partners.map((partner) => {
      return [
        { path: "partner_id" }
      ];
    });

    const populatedPartner = await Promise.all(
      partners.map((partner, index) =>
        PartnerServices.populate(partner, populateOptions[index])
      )
    );
    const processedpartner = populatedPartner.map(partner => {
      const { ...rest } = partner;

      return {
        ...rest,
        partner_id: partner.partner_id._id,
        partner_name: partner.partner_id.name,
      };
    })

    res.status(200).json({
      success: true,
      status: 200,
      message: "Partner list fetched successfully.",
      records: processedpartner,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};
const getPartnerDropDown = async (req, res) => {
  try {
    const serviceId = req.query.service_id;

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Missing ${fieldLabel('service_id')} in query parameters.`,
      });
    }

    const records = await PartnerServices.aggregate([
      {
        $match: {
          deleted_at: null,
          is_accept_request: true,
          service_id: new mongoose.Types.ObjectId(serviceId),
        },
      },
      {
        $lookup: {
          from: "users", // collection name is always plural and lowercase in MongoDB
          localField: "partner_id",
          foreignField: "_id",
          as: "partner_info",
        },
      },
      {
        $unwind: "$partner_info", // flatten array
      },
      {
        $match: {
          "partner_info.is_active": true,
        },
      },
      {
        $sort: { created_at: -1 },
      },
      {
        $project: {
          _id: 1,
          partner_id: "$partner_info._id",
          partner_name: "$partner_info.name",
          service_id: 1,
          category_id: 1,
          is_accept_request: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      status: 200,
      message: "Partner list fetched successfully.",
      records,
    });
  } catch (err) {
    console.error(err); // helpful for debugging
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: err.message,
    });
  }
};
module.exports = { getAll, create, update, getById, deleteUser, getDropDown, changePassword, getVerificationAll, getPartnerDropDown };
