const mongoose = require("mongoose");
const { checkObjectIdExists } = require('../validator/id_validator');
const Service = require('../models/service');
const User = require('../models/user');
const {
  parseJSONField,
  parseBooleanField,
  parseNumberField,
  parseOptionalDateField,
  trimOptionalStringField,
} = require("../utils/multipart_parser");
const { isValidGender, normalizeGender } = require("../enum/gender_enum");

const validateOptionalGender = (req, res) => {
  const value = req.body.gender;
  if (value === undefined) return true;
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    req.body.gender = null;
    return true;
  }
  if (!isValidGender(value)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'gender must be "male", "female", or "other".',
    });
    return false;
  }
  req.body.gender = normalizeGender(value);
  return true;
};

const validateAccessibleScreens = (items, res) => {
  if (items === undefined) return true;
  if (!Array.isArray(items)) {
    res.status(400).json({
      success: false,
      status: 400,
      message: 'accessible_screens must be an array.',
    });
    return false;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: `accessible_screens[${i}] must be an object with "page" and "url".`,
      });
      return false;
    }
    if (typeof item.page !== 'string' || item.page.trim() === '') {
      res.status(400).json({
        success: false,
        status: 400,
        message: `accessible_screens[${i}].page must be a non-empty string.`,
      });
      return false;
    }
    if (typeof item.url !== 'string' || item.url.trim() === '') {
      res.status(400).json({
        success: false,
        status: 400,
        message: `accessible_screens[${i}].url must be a non-empty string.`,
      });
      return false;
    }
  }
  return true;
};

const isUserCreateRoute = (req) =>
  String(req.baseUrl || '') === '/api/user' &&
  (String(req.path || '') === '/create' || String(req.path || '') === '/register-partner');

const isUserUpdateRoute = (req) =>
  String(req.baseUrl || '') === '/api/user' && String(req.path || '').startsWith('/update/');

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
  const hasPartnerServicesPayload =
    Array.isArray(req.body.partner_services) && req.body.partner_services.length > 0;
  const hasPartnerCategoriesPayload =
    Array.isArray(req.body.partner_categories) && req.body.partner_categories.length > 0;

  if (hasPartnerServicesPayload) {
    for (let i = 0; i < req.body.partner_services.length; i++) {
      const item = req.body.partner_services[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `partner_services[${i}] must be an object.`,
        });
        return false;
      }
      if (Array.isArray(item.services)) {
        if (!item.category_id || !mongoose.Types.ObjectId.isValid(String(item.category_id))) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_services[${i}].category_id must be a valid ObjectId.`,
          });
          return false;
        }
        for (let j = 0; j < item.services.length; j++) {
          const svc = item.services[j];
          if (svc === undefined || svc === null) {
            res.status(400).json({
              success: false,
              status: 400,
              message: `partner_services[${i}].services[${j}] is required.`,
            });
            return false;
          }
          if (typeof svc === 'string' || typeof svc === 'number') {
            const sid = String(svc).trim();
            if (!mongoose.Types.ObjectId.isValid(sid)) {
              res.status(400).json({
                success: false,
                status: 400,
                message: `partner_services[${i}].services[${j}] must be a valid service ObjectId.`,
              });
              return false;
            }
            continue;
          }
          if (typeof svc !== 'object' || Array.isArray(svc)) {
            res.status(400).json({
              success: false,
              status: 400,
              message: `partner_services[${i}].services[${j}] must be an object or service id string.`,
            });
            return false;
          }
          const sid = svc.service_id ?? svc.serviceId;
          if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) {
            res.status(400).json({
              success: false,
              status: 400,
              message: `partner_services[${i}].services[${j}].service_id must be a valid ObjectId.`,
            });
            return false;
          }
          if (
            svc.category_id !== undefined &&
            String(svc.category_id).trim() !== '' &&
            !mongoose.Types.ObjectId.isValid(String(svc.category_id))
          ) {
            res.status(400).json({
              success: false,
              status: 400,
              message: `partner_services[${i}].services[${j}].category_id must be a valid ObjectId.`,
            });
            return false;
          }
        }
      } else {
        if (!item.service_id || !mongoose.Types.ObjectId.isValid(String(item.service_id))) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_services[${i}].service_id must be a valid ObjectId.`,
          });
          return false;
        }
        if (
          item.category_id !== undefined &&
          item.category_id !== null &&
          String(item.category_id).trim() !== '' &&
          !mongoose.Types.ObjectId.isValid(item.category_id)
        ) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_services[${i}].category_id must be a valid ObjectId.`,
          });
          return false;
        }
      }
    }
  } else if (hasPartnerCategoriesPayload) {
    for (let i = 0; i < req.body.partner_categories.length; i++) {
      const item = req.body.partner_categories[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `partner_categories[${i}] must be an object.`,
        });
        return false;
      }
      if (!Array.isArray(item.services)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `partner_categories[${i}].services must be an array.`,
        });
        return false;
      }
      if (!item.category_id || !mongoose.Types.ObjectId.isValid(String(item.category_id))) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `partner_categories[${i}].category_id must be a valid ObjectId.`,
        });
        return false;
      }
      for (let j = 0; j < item.services.length; j++) {
        const svc = item.services[j];
        if (svc === undefined || svc === null) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_categories[${i}].services[${j}] is required.`,
          });
          return false;
        }
        if (typeof svc === 'string' || typeof svc === 'number') {
          const sid = String(svc).trim();
          if (!mongoose.Types.ObjectId.isValid(sid)) {
            res.status(400).json({
              success: false,
              status: 400,
              message: `partner_categories[${i}].services[${j}] must be a valid service ObjectId.`,
            });
            return false;
          }
          continue;
        }
        if (typeof svc !== 'object' || Array.isArray(svc)) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_categories[${i}].services[${j}] must be an object or service id string.`,
          });
          return false;
        }
        const sid = svc.service_id ?? svc.serviceId;
        if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `partner_categories[${i}].services[${j}].service_id must be a valid ObjectId.`,
          });
          return false;
        }
      }
    }
  } else if (req.body.service_ids !== undefined) {
    const raw = req.body.service_ids;
    const ids = Array.isArray(raw) ? raw : null;
    if (!Array.isArray(ids)) {
      res.status(400).json({
        success: false,
        status: 400,
        message: 'service_ids must be an array when partner_services is omitted.',
      });
      return false;
    }
    for (let k = 0; k < ids.length; k++) {
      if (!ids[k] || !mongoose.Types.ObjectId.isValid(String(ids[k]))) {
        res.status(400).json({
          success: false,
          status: 400,
          message: `service_ids[${k}] must be a valid ObjectId.`,
        });
        return false;
      }
    }
    const cats = req.body.category_ids;
    if (cats !== undefined && cats !== null) {
      const catArr = Array.isArray(cats) ? cats : null;
      if (!Array.isArray(catArr)) {
        res.status(400).json({
          success: false,
          status: 400,
          message: 'category_ids must be an array.',
        });
        return false;
      }
      for (let c = 0; c < catArr.length; c++) {
        if (
          catArr[c] != null &&
          String(catArr[c]).trim() !== '' &&
          !mongoose.Types.ObjectId.isValid(String(catArr[c]))
        ) {
          res.status(400).json({
            success: false,
            status: 400,
            message: `category_ids[${c}] must be a valid ObjectId.`,
          });
          return false;
        }
      }
    }
  }
  return true;
};

const createUserMiddleware = async (req, res, next) => {
  parseNumberField(req, "type");
  parseNumberField(req, "registration_type");
  parseBooleanField(req, "is_from_web");
  parseBooleanField(req, "is_active");
  parseBooleanField(req, "is_blocked");
  parseBooleanField(req, "is_business");
  parseBooleanField(req, "chat");
  parseJSONField(req, "accessible_screens");
  parsePartnerCatalogFields(req);
  parseJSONField(req, "partner_documents");
  parseJSONField(req, "bank_account");
  parseJSONField(req, "partner_subscription");
  parseOptionalDateField(req, "date_of_birth");
  trimOptionalStringField(req, "experience");
  if (!validateOptionalGender(req, res)) return;

  const partnerServicesAlias = req.body["partner-services"];
  if (
    partnerServicesAlias !== undefined &&
    partnerServicesAlias !== null &&
    (!Array.isArray(req.body.partner_services) || req.body.partner_services.length === 0)
  ) {
    req.body.partner_services = partnerServicesAlias;
  }

  const coerceSingleOidToArray = (field) => {
    const v = req.body[field];
    if (v === undefined || v === null || Array.isArray(v)) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t && mongoose.Types.ObjectId.isValid(t)) req.body[field] = [t];
    }
  };
  coerceSingleOidToArray('service_ids');
  coerceSingleOidToArray('category_ids');

  const {
    name,
    email,
    phone_number,
    address,
    state_id,
    city_id,
    profile_url,
    password,
    is_from_web,
    is_active,
    is_blocked,
    is_business,
    type,
    registration_type,
    business_name,
    business_email,
    business_phone_number,
    provided_service,
    created_by_id,
    franchise_id,
    accessible_screens,
    chat,
  } = req.body;
  if (accessible_screens !== undefined && !validateAccessibleScreens(accessible_screens, res)) return;
  if (type === 2 && hasPartnerCatalogFields(req.body) && !validatePartnerCatalogPayload(req, res)) {
    return;
  }

  if (
    req.body.area_id !== undefined &&
    req.body.area_id !== null &&
    String(req.body.area_id).trim() !== '' &&
    !mongoose.Types.ObjectId.isValid(String(req.body.area_id))
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid area id.',
    });
  }


  if (!name || name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Name is required.'
    });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || email.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.'
    });
  } else if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.'
    });
  }
  const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  if (!phone_number || phone_number.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Phone number is required.'
    });
  } else if (!phoneRegex.test(phone_number)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid phone number format.'
    });
  }
  if (isUserCreateRoute(req)) {
    try {
      const existingUser = await User.findOne({
        $or: [{ phone_number }, { email }],
        deleted_at: null,
      })
        .select('email phone_number')
        .lean();
      if (existingUser) {
        let message = '';
        if (existingUser.phone_number === phone_number) {
          message = 'Phone number already exists.';
        } else if (existingUser.email === email) {
          message = 'Email already exists.';
        } else {
          message = 'Email or phone number already exists.';
        }
        return res.status(409).json({
          success: false,
          status: 409,
          message,
        });
      }
    } catch (err) {
      console.error('createUserMiddleware duplicate check', err.message);
      return res.status(500).json({
        success: false,
        status: 500,
        message: 'Internal server error.',
      });
    }
  }
  if (type === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'User type is require.'
    });
  }
  if (is_from_web === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Regisration source is requiered.'
    });
  }
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!password || password.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password is required.'
    });
  } else if (!passwordRegex.test(password)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.'
    });
  }
  if (type < 1 || type > 6) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid user type.'
    });
  }
  if (type === 4) {
    if (!address || address.trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Address is required.'
      });
    }
    if (!state_id || String(state_id).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'State is required.'
      });
    }
    if (!mongoose.Types.ObjectId.isValid(state_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid state id.'
      });
    }
    if (!city_id || String(city_id).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'City is required.'
      });
    }
    if (!mongoose.Types.ObjectId.isValid(city_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid city id.'
      });
    }
    if (!req.body.pincode || String(req.body.pincode).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Pincode is required.'
      });
    }
    if (!req.file && (!profile_url || String(profile_url).trim() === '')) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Profile photo is required.'
      });
    }
  }
  if (chat !== undefined && typeof chat !== 'boolean') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Chat must be boolean.'
    });
  }
  if (is_blocked !== undefined && typeof is_blocked !== 'boolean') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Blocked status must be boolean.'
    });
  }
  if (
    franchise_id !== undefined &&
    franchise_id !== null &&
    String(franchise_id).trim() !== '' &&
    !mongoose.Types.ObjectId.isValid(String(franchise_id))
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid franchise id.',
    });
  }
  if (![1, 3, 5, 6].includes(type)) {
    if (is_from_web === true) {
      const hasState = state_id !== undefined && state_id !== null && String(state_id).trim() !== '';
      const hasCity = city_id !== undefined && city_id !== null && String(city_id).trim() !== '';
      if (hasState && !mongoose.Types.ObjectId.isValid(state_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid state id.'
        });
      }
      if (hasCity && !mongoose.Types.ObjectId.isValid(city_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid city id.'
        });
      }
    } else {
      if (!mongoose.Types.ObjectId.isValid(state_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid state id.'
        });
      }
      if (!mongoose.Types.ObjectId.isValid(city_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid city id.'
        });
      }
    }
    if (is_active === undefined) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Status is required.'
      });
    }
    if (type === 2) {
      if (is_business !== undefined && is_business === true) {
        if (!business_name || business_name.trim() === '') {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Business name is required.'
          });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!business_email || business_email.trim() === '') {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Business email is required.'
          });
        } else if (!emailRegex.test(business_email)) {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid email format.'
          });
        }
        const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
        if (!business_phone_number || business_phone_number.trim() === '') {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Business phone number is required.'
          });
        } else if (!phoneRegex.test(business_phone_number)) {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid business phone number format.'
          });
        }
        if (!provided_service || provided_service.trim() === '') {
          return res.status(400).json({
            success: false,
            status: 400,
            message: 'Service provided by your business is required.'
          });
        }
      }
    }

    if (!registration_type || registration_type === undefined) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Registration type is required.'
      });
    }
    if (registration_type < 1 || registration_type > 5) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid registration type.'
      });
    }
    if (is_from_web === false && (type === 2 || type === 3)) {
      if (profile_url && profile_url.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Profile url is require.'
        });
      }
      const urlRegex = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,6})([\/\w .-]*)*\/?$/;
      if (profile_url && !urlRegex.test(profile_url)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid Profile URL format.'
        });
      }
    }
    if (is_from_web === true) {
      if (!created_by_id || created_by_id.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Created by id is requiered.'
        });
      } else {
        if (!mongoose.Types.ObjectId.isValid(created_by_id)) {
          return res.status(400).json({
            success: false,
            status: 400,
            message: "Invalid Created by id format.",
          });
        }
      }
    }
  }
  next();
};

const updateUserMiddleware = async (req, res, next) => {
  parseNumberField(req, "type");
  parseNumberField(req, "registration_type");
  parseBooleanField(req, "is_from_web");
  parseBooleanField(req, "is_active");
  parseBooleanField(req, "is_blocked");
  parseBooleanField(req, "is_business");
  parseBooleanField(req, "chat");
  parseJSONField(req, "accessible_screens");
  parsePartnerCatalogFields(req);
  parseJSONField(req, "partner_documents");
  parseOptionalDateField(req, "date_of_birth");
  trimOptionalStringField(req, "experience");
  if (!validateOptionalGender(req, res)) return;

  const {
    name,
    email,
    phone_number,
    address,
    state_id,
    city_id,
    profile_url,
    is_from_web,

    is_business,
    is_blocked,
    type,
    registration_type,

    business_name,
    business_email,
    business_phone_number,
    provided_service,
    created_by_id,
    franchise_id,
    accessible_screens,
    chat,
    password,
  } = req.body;
  if (accessible_screens !== undefined && !validateAccessibleScreens(accessible_screens, res)) return;
  if (hasPartnerCatalogFields(req.body) && !validatePartnerCatalogPayload(req, res)) {
    return;
  }

  if (name !== undefined && name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Name is required.'
    });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email !== undefined && email.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.'
    });
  } else if (email !== undefined && !emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.'
    });
  }
  const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  if (phone_number !== undefined && phone_number.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Phone number is required.'
    });
  } else if (phone_number !== undefined && !phoneRegex.test(phone_number)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid phone number format.'
    });
  }

  if (isUserUpdateRoute(req)) {
    const userId = req.params?.id != null ? String(req.params.id).trim() : '';
    const orConditions = [];
    if (email !== undefined && String(email).trim() !== '' && emailRegex.test(email)) {
      orConditions.push({ email });
    }
    if (
      phone_number !== undefined &&
      String(phone_number).trim() !== '' &&
      phoneRegex.test(phone_number)
    ) {
      orConditions.push({ phone_number });
    }
    if (orConditions.length > 0 && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        const existingUser = await User.findOne({
          $or: orConditions,
          deleted_at: null,
          _id: { $ne: new mongoose.Types.ObjectId(userId) },
        })
          .select('email phone_number')
          .lean();
        if (existingUser) {
          let message = '';
          if (phone_number !== undefined && existingUser.phone_number === phone_number) {
            message = 'Phone number already exists.';
          } else if (email !== undefined && existingUser.email === email) {
            message = 'Email already exists.';
          } else {
            message = 'Email or phone number already exists.';
          }
          return res.status(409).json({
            success: false,
            status: 409,
            message,
          });
        }
      } catch (err) {
        console.error('updateUserMiddleware duplicate check', err.message);
        return res.status(500).json({
          success: false,
          status: 500,
          message: 'Internal server error.',
        });
      }
    }
  }

  // if (type === undefined) {
  //   return res.status(400).json({
  //     success: false,
  //     status: 400,
  //     message: 'User type is require.'
  //   });
  // }
  if (type !== undefined && (type < 1 || type > 6)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid user type.'
    });
  }
  if (chat !== undefined && typeof chat !== 'boolean') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Chat must be boolean.'
    });
  }
  if (is_blocked !== undefined && typeof is_blocked !== 'boolean') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Blocked status must be boolean.'
    });
  }
  if (password !== undefined) {
    if (String(password).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Password is required.'
      });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Password must be at least 8 characters long, contain one uppercase, one lowercase, one number, and one special character.'
      });
    }
  }
  if (franchise_id !== undefined && !mongoose.Types.ObjectId.isValid(franchise_id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid franchise id.'
    });
  }
  // if (is_from_web === undefined) {
  //   return res.status(400).json({
  //     success: false,
  //     status: 400,
  //     message: 'Regisration source is requiered.'
  //   });
  // }
  if (type !== undefined && ![1, 3, 5, 6].includes(type)) {
    if (state_id !== undefined && !mongoose.Types.ObjectId.isValid(state_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid state id.'
      });
    }
    if (city_id !== undefined && !mongoose.Types.ObjectId.isValid(city_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid city id.'
      });
    }
    if (is_business !== undefined && is_business === true) {
      if (business_name !== undefined && business_name.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Business name is required.'
        });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (business_email !== undefined && business_email.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Business email is required.'
        });
      } else if (!emailRegex.test(business_email)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid email format.'
        });
      }
      const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
      if (business_phone_number !== undefined && business_phone_number.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Business phone number is required.'
        });
      } else if (!phoneRegex.test(business_phone_number)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid business phone number format.'
        });
      }
      if (provided_service !== undefined && provided_service.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Service provided by your business is required.'
        });
      }
    }
    // if (registration_type === undefined) {
    //   return res.status(400).json({
    //     success: false,
    //     status: 400,
    //     message: 'Registration type is required.'
    //   });
    // }
    if (registration_type !== undefined && (registration_type < 1 || registration_type > 5)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid registration type.'
      });
    }
    if (is_from_web !== undefined && is_from_web === false && (type === 2 || type === 3)) {
      if (profile_url !== undefined && profile_url.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Profile url is require.'
        });
      }
      const urlRegex = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,6})([\/\w .-]*)*\/?$/;
      if (profile_url !== undefined && !urlRegex.test(profile_url)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid Profile URL format.'
        });
      }
    }
    if (is_from_web !== undefined && is_from_web === true) {
      if (created_by_id !== undefined && created_by_id.trim() === '') {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Created by id is requiered.'
        });
      } else {
        if (created_by_id !== undefined && !mongoose.Types.ObjectId.isValid(created_by_id)) {
          return res.status(400).json({
            success: false,
            status: 400,
            message: "Invalid Created by id format.",
          });
        }
      }
    }
  }
  next();
};

const getPartnerDropDownMiddleware = (req, res, next) => {
  const {
    service_id,
  } = req.query;
  if (!service_id) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service id is requiered.",
    });
  }
  const service_id_data = checkObjectIdExists(Service, service_id, 'service')
  if (service_id_data.exists === false) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: service_id_data.message,
    });
  }
  next();
};
const changePasswordMiddleware = (req, res, next) => {
  const { new_password, user_id, type } = req.body;
  if (!user_id || String(user_id).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'user_id is required.',
    });
  }
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid user_id format.',
    });
  }
  if (type === undefined || type === null || String(type).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'type is required.',
    });
  }
  const normalizedType = Number(type);
  if (![2, 4].includes(normalizedType)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'changePassword is supported only for partner(type=2) and user(type=4).',
    });
  }
  if (!new_password || String(new_password).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'New password is required.',
    });
  }
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(new_password)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.',
    });
  }
  next();
};

const PARTNER_PROFILE_IMAGE_MAX_BYTES = 512 * 1024;

/** After multer: limit profile `image` / `req.file` to 512KB for partners only (create body type 2, register-partner, or update existing partner). */
const enforcePartnerProfileImageSize = async (req, res, next) => {
  try {
    const img = req.files?.image?.[0] || req.file;
    if (!img) return next();
    const size =
      typeof img.size === 'number' && !Number.isNaN(img.size)
        ? img.size
        : Buffer.isBuffer(img.buffer)
          ? img.buffer.length
          : null;
    if (size === null) return next();

    let partnerContext = false;
    const typeRaw = req.body?.type;
    if (typeRaw !== undefined && typeRaw !== null && String(typeRaw).trim() !== '') {
      const typeNum = parseInt(typeRaw, 10);
      if (typeNum === 2) partnerContext = true;
    }
    if (String(req.originalUrl || '').includes('register-partner')) {
      partnerContext = true;
    }
    if (!partnerContext && req.params?.id && mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      const user = await User.findOne({ _id: req.params.id, deleted_at: null }).select('type').lean();
      if (user && Number(user.type) === 2) partnerContext = true;
    }

    if (!partnerContext) return next();

    if (size > PARTNER_PROFILE_IMAGE_MAX_BYTES) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Profile image must be 512 KB or smaller.',
      });
    }
    return next();
  } catch (err) {
    console.error('enforcePartnerProfileImageSize', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = { createUserMiddleware, updateUserMiddleware, getPartnerDropDownMiddleware, changePasswordMiddleware, enforcePartnerProfileImageSize };
