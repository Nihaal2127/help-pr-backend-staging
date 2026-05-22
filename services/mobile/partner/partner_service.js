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
const { createMultiple } = require('../../../controllers/partner_document_controller');
const { handleImageUpload } = require('../../../helper/image_uploader');
const { getUploadType } = require('../../../enum/upload_type_enum');
const { replacePartnerCatalogFromNormalizedRows } = require('../../../services/partner_category_service');
const DEFAULT_PARTNER_PLAN_NAME = 'basic';

const USER_TYPE_PARTNER = 2;
const REGISTRATION_TYPE_NORMAL = 1;

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

const normalizePartnerBankAccount = (payload) => {
  const parsed = parseJsonIfString(payload, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rawPrimary = parsed.is_primary ?? parsed.primary_bank_account ?? false;
  const normalizedPrimary =
    typeof rawPrimary === 'string' ? rawPrimary.trim().toLowerCase() === 'true' : rawPrimary === true;
  return {
    account_holder_name: parsed.account_holder_name ?? parsed.account_name ?? '',
    account_number: parsed.account_number ?? '',
    ifsc_code: parsed.ifsc_code ?? '',
    bank_name: parsed.bank_name ?? '',
    branch_name: parsed.branch_name ?? '',
    is_primary: normalizedPrimary,
  };
};

const mergePartnerDocumentPayloadFromMultipart = async (files, partner_documents) => {
  const base = parseJsonIfString(partner_documents, {});
  const merged = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
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
    return;
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
  if (Object.keys(documentImageById).length === 0) return;
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

const registerPartner = async ({ name, email, phone_number, password, date_of_birth }) => {
  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_PARTNER);
  const _id = new mongoose.Types.ObjectId();

  const newUser = new User({
    _id,
    registration_id,
    user_id,
    name,
    email,
    phone_number,
    date_of_birth,
    type: USER_TYPE_PARTNER,
    registration_type: REGISTRATION_TYPE_NORMAL,
    is_from_web: false,
    verification_status: 1,
    verified_at: null,
  });

  newUser.password = password;
  const token = newUser.generateAuthToken();
  const savedUser = await newUser.save();

  await notificationSetting.create({ user_id: savedUser._id });

  const basicPlan = await SubscriptionPlan.findOne({
    plan_name: DEFAULT_PARTNER_PLAN_NAME,
    is_active: true,
    deleted_at: null,
  });
  if (!basicPlan) {
    throw new Error('Default subscription plan "basic" is not configured.');
  }

  await PartnerSubscription.create({
    partner_id: savedUser._id,
    subscription_plan_id: basicPlan._id,
    started_at: savedUser.created_at,
    expires_at: null,
    status: 'active',
    notes: 'Auto-assigned on mobile registration',
  });

  const data = savedUser.toObject();
  delete data.password;

  return {
    data,
  };
};

const loginPartner = async ({ email, password, device_token }) => {
  const user = await User.findOne({ email, deleted_at: null }).select('+password');
  if (!user) {
    return { ok: false, status: 401, message: 'Invalid credentials.' };
  }

  if (Number(user.type) !== USER_TYPE_PARTNER) {
    return {
      ok: false,
      status: 403,
      message: 'This account is not a partner. Use the correct app to sign in.',
    };
  }

  if (user.is_blocked === true) {
    return {
      ok: false,
      status: 403,
      message: 'Your account is blocked. Please contact support.',
    };
  }

  if (Number(user.verification_status) === 3) {
    return {
      ok: false,
      status: 403,
      message: user.rejected_reasone?.trim()
        ? `Registration rejected: ${user.rejected_reasone.trim()}`
        : 'Your partner registration was rejected. Please contact admin.',
    };
  }

  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return { ok: false, status: 401, message: 'Invalid credentials.' };
  }

  const token = user.generateAuthToken();
  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    user.device_token = String(device_token).trim();
  }
  await user.save();

  const populated = await User.findById(user._id).populate([{ path: 'city_id' }]).lean();
  const data = {
    ...populated,
    city_id: populated?.city_id?._id || null,
    city_name: populated?.city_id?.name || null,
  };
  delete data.password;

  return {
    ok: true,
    data,
  };
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
    return { ok: true };
  }

  if (
    !mongoose.Types.ObjectId.isValid(String(stateId)) ||
    !mongoose.Types.ObjectId.isValid(String(cityId)) ||
    !mongoose.Types.ObjectId.isValid(String(areaId))
  ) {
    return { ok: true };
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
    return {
      ok: false,
      status: 400,
      message: 'No franchise available for this location.',
    };
  }

  user.franchise_id = franchise._id;
  return { ok: true };
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
  };
  delete data.password;
  return data;
};

const updatePartner = async ({ partnerId, body, files }) => {
  const user = await User.findOne({ _id: partnerId, type: USER_TYPE_PARTNER, deleted_at: null });
  if (!user) {
    return { ok: false, status: 404, message: 'Partner not found.' };
  }

  const updateData = { ...body };

  if (files?.image?.[0]) {
    updateData.profile_url = await handleImageUpload(files.image[0], getUploadType(4), true, null);
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

  if (shouldAddNewAddress) {
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
      return {
        ok: false,
        status: 400,
        message: 'Address, state_id, city_id, and pincode are required to add a new address.',
      };
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

  if (updateData.password !== undefined && String(updateData.password).trim() !== '') {
    user.password = updateData.password;
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
      return { ok: false, status: 404, message: 'Address not found for this user.' };
    }
  }

  const hasPartnerDocFiles = PARTNER_DOCUMENT_FILE_FIELDS.some((f) => files?.[f]?.[0]);
  const shouldRunPartnerExtras =
    hasNonEmptyPartnerCatalogPayload(updateData) ||
    updateData.partner_documents !== undefined ||
    updateData.bank_account !== undefined ||
    updateData.account_number !== undefined ||
    updateData.account_holder_name !== undefined ||
    hasPartnerDocFiles;

  if (shouldRunPartnerExtras) {
    await ensurePartnerDocumentCatalogRows(updatedUser._id, updatedUser);

    const mergedPartnerDocs = await mergePartnerDocumentPayloadFromMultipart(
      files,
      updateData.partner_documents
    );
    await applyPartnerDocumentImageUpdates(
      updatedUser._id,
      normalizePartnerDocuments(mergedPartnerDocs)
    );

    if (hasNonEmptyPartnerCatalogPayload(updateData)) {
      const resolvedPartnerServicesInput = resolvePartnerServicesInputFromBody(updateData);
      const normalizedServiceRows = normalizePartnerServices(resolvedPartnerServicesInput ?? []);
      await replacePartnerCatalogFromNormalizedRows(updatedUser._id, normalizedServiceRows);
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
        return { ok: false, status: bankResult.status, message: bankResult.message };
      }
    }
  }

  const data = await buildPartnerResponseData(updatedUser._id);
  return { ok: true, data };
};

module.exports = {
  registerPartner,
  loginPartner,
  updatePartner,
};
