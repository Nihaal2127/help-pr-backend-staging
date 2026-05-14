const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const User = require('../models/user');
const Address = require('../models/address');
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
const { getServiceCountData, getVerificationCountData } = require('./count_controller');

const { getDocumentList } = require('./document_controller');
const { createMultiple, getPartnerDocumentList } = require('./partner_document_controller');
const { getPartnerPrimaryAccount } = require('./partner_bank_account_controller');
const { getLastServiceDate } = require('./order_service_controller');
const { getUserTypeKey } = require('../enum/user_type_enum')
const { handleImageUpload } = require('../helper/image_uploader');
const { getUploadType } = require('../enum/upload_type_enum');
const PartnerDocument = require('../models/partner_document');
const PartnerBankAccount = require('../models/partner_bank_account');
const partnerSubscriptionService = require('../services/partner_subscription_service');

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

const parseBooleanInput = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
};

const createAddressRecord = async ({
  userId,
  name,
  phoneNumber,
  address,
  stateId,
  cityId,
  pincode,
  addressStatus,
}) => {
  if (!address || !stateId || !cityId || !pincode) return;
  await Address.create({
    user_id: userId,
    contact_name: name ?? '',
    contact_number: phoneNumber ?? '',
    address,
    state_id: stateId,
    city_id: cityId,
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
    if (Array.isArray(item.services)) {
      const parentCategoryId = item.category_id ?? null;
      for (const svc of item.services) {
        if (!svc || typeof svc !== 'object' || Array.isArray(svc)) continue;
        const sid = svc.service_id ?? svc.serviceId ?? null;
        if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) continue;
        rows.push({
          category_id: svc.category_id ?? parentCategoryId,
          service_id: sid,
          description: svc.description ?? '',
          price: svc.price ?? null,
        });
      }
    } else {
      const sid = item.service_id ?? item.serviceId ?? null;
      if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) continue;
      rows.push({
        category_id: item.category_id ?? null,
        service_id: sid,
        description: item.description ?? '',
        price: item.price ?? null,
      });
    }
  }
  return rows;
};

/** When frontend sends service_ids + category_ids (+ optional names/descriptions/prices) instead of partner_services. */
const buildPartnerServicesFromParallelFields = (body) => {
  const coerceArray = (val, fallback = []) => {
    if (Array.isArray(val)) return val;
    if (val === undefined || val === null) return fallback;
    return parseJsonIfString(val, fallback);
  };
  const ids = coerceArray(body.service_ids, []);
  const cats = coerceArray(body.category_ids, []);
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const names = coerceArray(body.service_names, []);
  const descs = coerceArray(body.service_descriptions, []);
  const prices = coerceArray(body.service_prices, []);
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
    });
  }
  return rows;
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
    started_at: parsed.started_at ?? parsed.subscription_start_date ?? null,
    expires_at: parsed.expires_at ?? parsed.subscription_end_date ?? null,
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
    return;
  }
  const documentList = await getDocumentList();
  const documentNameToId = new Map(
    documentList.map((doc) => [String(doc.name || '').trim().toLowerCase(), String(doc._id)])
  );
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
    return;
  }
  const updates = Object.entries(documentImageById).map(([documentId, imageUrl]) =>
    PartnerDocument.updateOne(
      {
        partner_id: partnerId,
        document_id: new mongoose.Types.ObjectId(documentId),
        deleted_at: null,
      },
      { $set: { document_image: imageUrl } }
    )
  );
  await Promise.all(updates);
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
    const populatedUser = await User.populate(users, [
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

    const CALLER_TYPE_ADMIN = 1;
    const CALLER_TYPE_PARTNER = 2;
    const CALLER_TYPE_EMPLOYEE = 3;
    const CALLER_TYPE_USER = 4;
    const CALLER_TYPE_SUPER_ADMIN = 5;
    const CALLER_TYPE_STAFF = 6;
    const franchiseIdFilter = typeof req.query.franchise_id === 'string' ? req.query.franchise_id.trim() : null;

    let roleFilter = {};
    if ([CALLER_TYPE_SUPER_ADMIN, CALLER_TYPE_STAFF].includes(caller.type)) {
      if (franchiseIdFilter) {
        if (!mongoose.Types.ObjectId.isValid(franchiseIdFilter)) {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'franchise_id must be a valid MongoDB ObjectId.',
          });
        }
        roleFilter = { franchise_id: new mongoose.Types.ObjectId(franchiseIdFilter) };
      } else {
        roleFilter = {};
      }
    } else if ([CALLER_TYPE_ADMIN, CALLER_TYPE_EMPLOYEE].includes(caller.type)) {
      if (franchiseIdFilter) {
        return res.status(403).json({
          success: false,
          status: 403,
          message: 'You are not allowed to use franchise_id filter.',
        });
      }
      const allowedTypes = [1, 2, 3, 4];
      if (Number.isInteger(type) && !allowedTypes.includes(type)) {
        return res.status(403).json({
          success: false,
          status: 403,
          message: 'You are not allowed to access this user type.',
        });
      }
      roleFilter = {
        type: { $in: allowedTypes },
        franchise_id: caller.franchise_id ?? null,
      };
    } else if ([CALLER_TYPE_PARTNER, CALLER_TYPE_USER].includes(caller.type)) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'You are not allowed to access users list.',
      });
    } else {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'You are not allowed to access users list.',
      });
    }


    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;
    const is_blocked = req.query.is_blocked !== undefined ? parseBoolean(req.query.is_blocked) : null;

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
      ...(type === 2 && { verification_status: 2 }),
      ...(req.query.is_active && { is_active: is_active }),
      ...(req.query.is_blocked !== undefined && { is_blocked: is_blocked }),
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



    const processedUsers = await Promise.all(populatedUser.map(async user => {
      const service_count_data = await getServiceCountData(user._id);
      const { state_id, city_id, ...rest } = user;
      let addressField = rest.address;
      if (user.type === 4) {
        addressField = await Address.find({
          user_id: user._id,
          deleted_at: null,
        })
          .sort({ created_at: 1 })
          .select('contact_name contact_number address landmark area state_id city_id state city pincode address_status created_at updated_at')
          .lean();
      }
      return {
        ...rest,
        address: addressField,
        state_id: user?.state_id?._id || null,
        state_name: user?.state_id?.name || null,

        city_id: user?.city_id?._id || null,
        city_name: user?.city_id?.name || null,

        total_service: service_count_data.total_service,
        service_paid: service_count_data.service_paid,
        service_unpaid: service_count_data.service_unpaid,
        in_progress_service: service_count_data.in_progress_service,
        completed_service: service_count_data.completed_service,
        cancelled_service: service_count_data.cancelled_service,
        no_of_services: service_count_data.no_of_services,

        balance_amount: service_count_data.balance_amount,
        total_amount: service_count_data.total_amount,
        rating: 0,//This is in Phaase 2
        total_earnings: 0,
        bal_payment: 0,
      };
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

    const verification_status = req.query.verification_status !== undefined ? parseInt(req.query.verification_status) : null;

    const searchTerm = req.query.keyword ?? req.query.search;
    let regex;
    if (searchTerm) {
      const sanitizedKeyword = sanitizeInput(searchTerm);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
    }
    const filter = {
      deleted_at: null,
      type: 2,
      ...(req.query.verification_status && { verification_status: verification_status }),
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



    const processedUsers = await Promise.all(populatedUser.map(async user => {
      const document_uploaded_count = await getVerificationCountData(user._id);
      const { state_id, city_id, ...rest } = user;
      return {
        ...rest,
        state_id: user.state_id._id,
        state_name: user.state_id.name,

        city_id: user.city_id._id,
        city_name: user.city_id.name,
        document_uploaded_count,
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
    } = req.body;
    let resolvedPartnerServicesInput = partner_services;
    if (type === 2) {
      const psArr = Array.isArray(partner_services) ? partner_services : [];
      const hasPartnerServicesPayload = psArr.length > 0;
      const hasParallelIds =
        (Array.isArray(req.body.service_ids) && req.body.service_ids.length > 0) ||
        (typeof req.body.service_ids === 'string' && String(req.body.service_ids).trim() !== '');
      if (!hasPartnerServicesPayload && hasParallelIds) {
        resolvedPartnerServicesInput = buildPartnerServicesFromParallelFields(req.body);
      }
    }
    let resolvedProfileUrl = profile_url;
    const profileUpload = req.files?.image?.[0] || req.file;
    if (profileUpload) {
      resolvedProfileUrl = await handleImageUpload(profileUpload, getUploadType(4), true, null);
    }
    const resolvedIsActive =
      type === 2
        ? false
        : (is_active !== undefined
            ? is_active
            : false);
    const resolvedChat =
      type === 3
        ? (chat !== undefined ? chat : true)
        : chat;
    let partnerVerificationFields = {};
    if (type === 2) {
      const raw = req.body.is_verified;
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        const isTrue =
          raw === true ||
          raw === 1 ||
          String(raw).trim().toLowerCase() === 'true';
        partnerVerificationFields = isTrue
          ? { verification_status: 2, verified_at: new Date() }
          : { verification_status: 1, verified_at: null };
      }
    }
    const existingUser = await User.findOne({
      $or: [
        { phone_number },
        { email },
      ],
      deleted_at: null
    });
    if (existingUser) {

      let message = '';
      if (existingUser.phone_number === phone_number) {
        message = 'Phone number already exists.';
      } else if (existingUser.email === email) {
        message = 'Email already exists.';
      }
      return res.status(409).json({
        success: false,
        status: 409,
        message,
      });
    }
    if ([1, 3].includes(type) && franchise_id) {
      const franchise = await Franchise.findOne({ _id: franchise_id, deleted_at: null }).lean();
      if (!franchise) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Franchise not found.',
        });
      }
    }

    if (is_business === true && type === 2) {
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
    const user_id = await getNewId(type);
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
      email,
      phone_number,
      address,
      state_id,
      city_id,
      pincode,
      profile_url: resolvedProfileUrl,
      is_from_web,
      is_active: resolvedIsActive,
      ...partnerVerificationFields,
      ...(is_blocked !== undefined ? { is_blocked } : {}),
      chat: resolvedChat,
      is_business,
      type,
      registration_type,
      device_token,
      created_by_id,
      franchise_id,
      accessible_screens: normalizedScreens,
    });

    if (is_business === true && type === 2) {
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

    if (type === 2) {
      const documentList = await getDocumentList();
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

      const normalizedServiceRows = normalizePartnerServices(resolvedPartnerServicesInput);
      const partnerServicesRows = normalizedServiceRows.map((serviceRow) => ({
        _id: new mongoose.Types.ObjectId(),
        partner_id: _id,
        category_id: serviceRow.category_id,
        service_id: serviceRow.service_id,
      }));

      const savedUser = await newUser.save();
      if (partnerServicesRows.length > 0) {
        await PartnerServices.insertMany(partnerServicesRows, { ordered: false });
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
      if (normalizedBankAccount && normalizedBankAccount.account_number) {
        const existingAccount = await PartnerBankAccount.findOne({
          account_number: normalizedBankAccount.account_number,
          deleted_at: null,
        });
        if (!existingAccount) {
          await PartnerBankAccount.create({
            partner_id: savedUser._id,
            bank_name: normalizedBankAccount.bank_name,
            account_holder_name: normalizedBankAccount.account_holder_name,
            account_number: normalizedBankAccount.account_number,
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
          subscription_end_date: req.body.subscription_end_date,
          expires_at: req.body.expires_at,
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

  try {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'user_id not found'
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
    if (shouldAddNewAddress && hasAddressPayload) {
      await createAddressRecord({
        userId: user._id,
        name: updateData.contact_name ?? updateData.name ?? user.name,
        phoneNumber: updateData.contact_number ?? updateData.phone_number ?? user.phone_number,
        address: updateData.address,
        stateId: updateData.state_id,
        cityId: updateData.city_id,
        pincode: updateData.pincode,
        addressStatus: updateData.address_status,
      });
      delete updateData.address;
      delete updateData.state_id;
      delete updateData.city_id;
      delete updateData.pincode;
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
    if (effectiveType === 4) {
      const finalName = updateData.name !== undefined ? updateData.name : user.name;
      const finalEmail = updateData.email !== undefined ? updateData.email : user.email;
      const finalPhoneNumber = updateData.phone_number !== undefined ? updateData.phone_number : user.phone_number;
      const finalAddress = updateData.address !== undefined ? updateData.address : user.address;
      const finalStateId = updateData.state_id !== undefined ? updateData.state_id : user.state_id;
      const finalCityId = updateData.city_id !== undefined ? updateData.city_id : user.city_id;
      const finalPincode = updateData.pincode !== undefined ? updateData.pincode : user.pincode;
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
      if (!finalAddress || String(finalAddress).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Address is required.'
        });
      }
      if (!finalStateId || String(finalStateId).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'State is required.'
        });
      }
      if (!mongoose.Types.ObjectId.isValid(finalStateId)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid state id.'
        });
      }
      if (!finalCityId || String(finalCityId).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'City is required.'
        });
      }
      if (!mongoose.Types.ObjectId.isValid(finalCityId)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid city id.'
        });
      }
      if (!finalPincode || String(finalPincode).trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Pincode is required.'
        });
      }
      if (!finalProfileUrl || String(finalProfileUrl).trim() === '') {
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

    // Only allow explicit fields to be updated.
    const ALLOWED_UPDATE_FIELDS = new Set([
      'name',
      'email',
      'phone_number',
      'address',
      'state_id',
      'city_id',
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
      'provided_service',
      'business_info_id',
      'password',
    ]);

    Object.keys(updateData).forEach((key) => {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        user[key] = updateData[key];
      }
    });

    const updatedUser = await user.save();
    if (!shouldAddNewAddress && (hasAddressPayload || hasAddressStatusPayload)) {
      const primaryAddress = await Address.findOne({ user_id: updatedUser._id, deleted_at: null }).sort({ created_at: 1 });
      if (primaryAddress) {
        if (hasAddressPayload) {
          primaryAddress.contact_name = updatedUser.name ?? '';
          primaryAddress.contact_number = updatedUser.phone_number ?? '';
          primaryAddress.address = updatedUser.address ?? '';
          primaryAddress.state_id = updatedUser.state_id ?? null;
          primaryAddress.city_id = updatedUser.city_id ?? null;
          primaryAddress.pincode = updatedUser.pincode ?? '';
        }
        if (hasAddressStatusPayload) {
          primaryAddress.address_status = parseBooleanInput(updateData.address_status);
        }
        await primaryAddress.save();
      } else if (hasAddressPayload) {
        await createAddressRecord({
          userId: updatedUser._id,
          name: updatedUser.name,
          phoneNumber: updatedUser.phone_number,
          address: updatedUser.address,
          stateId: updatedUser.state_id,
          cityId: updatedUser.city_id,
          pincode: updatedUser.pincode,
          addressStatus: updateData.address_status,
        });
      }
    }
    if (effectiveType === 2) {
      const mergedPartnerDocs = await mergePartnerDocumentPayloadFromMultipart(
        req,
        updateData.partner_documents
      );
      await applyPartnerDocumentImageUpdates(
        updatedUser._id,
        normalizePartnerDocuments(mergedPartnerDocs)
      );
    }
    let responseRecord = updatedUser;

    if (effectiveType === 4 || effectiveType === 2) {
      const service_count_data = await getServiceCountData(updatedUser._id);
      const last_service_date = await getLastServiceDate(updatedUser._id);
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
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
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
      response.address = await Address.find({
        user_id: user._id,
        deleted_at: null,
      })
        .sort({ created_at: 1 })
        .select('contact_name contact_number address landmark area state_id city_id state city pincode address_status created_at updated_at')
        .lean();
    }
    if (user.type === 4 || user.type === 2) {
      const last_service_date = await getLastServiceDate(user._id);
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

      if (user && user.documents) {
        user.documents = user.documents.map(doc => ({
          ...doc,
          // ...doc.document_id,
          document_id: doc.document_id?._id || null,
          name: doc.document_id?.name || null,
          is_optional: doc.document_id?.is_optional || null,
        }));
      }

      response.documents = user.documents;

      const bank_account = await getPartnerPrimaryAccount(user._id);

      response.bank_account = bank_account;

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
        message: "Missing service_id in query parameters.",
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
