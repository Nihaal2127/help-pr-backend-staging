const mongoose = require("mongoose");
const { checkObjectIdExists } = require('../validator/id_validator');
const Service = require('../models/service');
const { parseJSONField, parseBooleanField, parseNumberField } = require("../utils/multipart_parser");

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

const createUserMiddleware = (req, res, next) => {
  parseNumberField(req, "type");
  parseNumberField(req, "registration_type");
  parseBooleanField(req, "is_from_web");
  parseBooleanField(req, "is_active");
  parseBooleanField(req, "is_blocked");
  parseBooleanField(req, "is_business");
  parseBooleanField(req, "chat");
  parseJSONField(req, "accessible_screens");
  parseJSONField(req, "partner_services");
  parseJSONField(req, "partner_documents");
  parseJSONField(req, "bank_account");
  parseJSONField(req, "partner_subscription");

  const {
    name,
    email,
    phone_number,
    address,
    state_id,
    city_id,
    profile_url,
    password,
    confirm_password,
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
  if (type === 2 && req.body.partner_services !== undefined) {
    if (!Array.isArray(req.body.partner_services)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'partner_services must be an array.',
      });
    }
    for (let i = 0; i < req.body.partner_services.length; i++) {
      const item = req.body.partner_services[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `partner_services[${i}] must be an object.`,
        });
      }
      if (!item.service_id || !mongoose.Types.ObjectId.isValid(item.service_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `partner_services[${i}].service_id must be a valid ObjectId.`,
        });
      }
      if (item.category_id !== undefined && item.category_id !== null && String(item.category_id).trim() !== '' && !mongoose.Types.ObjectId.isValid(item.category_id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `partner_services[${i}].category_id must be a valid ObjectId.`,
        });
      }
    }
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
  if (confirm_password === undefined || confirm_password === null || String(confirm_password).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Confirm password is required.'
    });
  }
  if (password !== confirm_password) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password and confirm password do not match.'
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
    if (confirm_password === undefined || confirm_password === null || String(confirm_password).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Confirm password is required.'
      });
    }
    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Password and confirm password do not match.'
      });
    }
  }
  if ([1, 3].includes(type) && franchise_id !== undefined && franchise_id !== null && String(franchise_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(franchise_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid franchise id.'
      });
    }
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

const updateUserMiddleware = (req, res, next) => {
  parseNumberField(req, "type");
  parseNumberField(req, "registration_type");
  parseBooleanField(req, "is_from_web");
  parseBooleanField(req, "is_active");
  parseBooleanField(req, "is_blocked");
  parseBooleanField(req, "is_business");
  parseBooleanField(req, "chat");
  parseJSONField(req, "accessible_screens");

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
    confirm_password,
  } = req.body;
  if (accessible_screens !== undefined && !validateAccessibleScreens(accessible_screens, res)) return;


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
    if (confirm_password === undefined || confirm_password === null || String(confirm_password).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Confirm password is required.'
      });
    }
    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Password and confirm password do not match.'
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
  const { new_password, confirm_password, user_id, type } = req.body;
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
  if (confirm_password === undefined || confirm_password === null || String(confirm_password).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Confirm password is required.',
    });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Password and confirm password do not match.',
    });
  }
  next();
};
module.exports = { createUserMiddleware, updateUserMiddleware, getPartnerDropDownMiddleware, changePasswordMiddleware };
