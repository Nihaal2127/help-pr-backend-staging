const mongoose = require("mongoose");
const { fieldLabel } = require("../utils/field_labels");
const { normalizeAdminDescription } = require("../utils/admin_description_access");
const Order = require("../models/order");
const OrderService = require("../models/order_services");
const User = require("../models/user");
const City = require("../models/city");
const Category = require("../models/category");
const Service = require("../models/service");
const Franchise = require("../models/franchise");
const Address = require("../models/address");
const { OrderCreationError } = require("../errors/order_creation_error");
const { checkObjectIdExists } = require("../validator/id_validator");
const {
  normalizeOrderStatus,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_REFUNDED,
} = require("../enum/order_status_enum");
const { assertOrderCanBeMarkedCompletedOrThrow } = require("./order_completion_validation");

const PAYMENT_SCHEDULE_TYPES = new Set(["single", "installments"]);

const normalizeServiceItemsOps = (value) => {
  if (value === undefined || value === null) {
    return { update: [] };
  }
  if (Array.isArray(value)) {
    return { update: value };
  }
  if (typeof value === "object") {
    return {
      update: Array.isArray(value.update) ? value.update : [],
    };
  }
  throw new OrderCreationError(
    "service_items must be an array or { update: [...] }.",
    400
  );
};

const assertObjectId = async (model, id, label, { allowNull = false } = {}) => {
  if (id === undefined) return;
  if (id === null || id === "") {
    if (allowNull) return;
    throw new OrderCreationError(`${fieldLabel(label)} cannot be empty.`, 400);
  }
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    throw new OrderCreationError(`Invalid ${fieldLabel(label)}.`, 400);
  }
  const result = await checkObjectIdExists(model, id, label);
  if (!result.exists) {
    throw new OrderCreationError(result.message, 409);
  }
};

const loadUserUniqueId = async (userId) => {
  const user = await User.findById(userId).select("user_id").lean();
  if (!user) {
    throw new OrderCreationError("User not found.", 404);
  }
  return user.user_id || "";
};

/**
 * Apply order-level field updates from PUT body (excluding pricing/nested keys).
 */
const applyOrderLevelFields = async (order, body) => {
  let partnerChanged = false;
  let userChanged = false;

  if (Object.prototype.hasOwnProperty.call(body, "user_id")) {
    await assertObjectId(User, body.user_id, "user");
    order.user_id = new mongoose.Types.ObjectId(body.user_id);
    order.user_unique_id =
      body.user_unique_id !== undefined
        ? String(body.user_unique_id).trim()
        : await loadUserUniqueId(body.user_id);
    userChanged = true;
  } else if (body.user_unique_id !== undefined) {
    order.user_unique_id = String(body.user_unique_id).trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, "partner_id")) {
    if (body.partner_id === null || body.partner_id === "") {
      order.partner_id = null;
    } else {
      await assertObjectId(User, body.partner_id, "partner");
      order.partner_id = new mongoose.Types.ObjectId(body.partner_id);
    }
    partnerChanged = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "employee_id")) {
    if (body.employee_id === null || body.employee_id === "") {
      order.employee_id = null;
    } else {
      await assertObjectId(User, body.employee_id, "employee");
      order.employee_id = new mongoose.Types.ObjectId(body.employee_id);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "franchise_id")) {
    if (body.franchise_id === null || body.franchise_id === "") {
      order.franchise_id = null;
    } else {
      await assertObjectId(Franchise, body.franchise_id, "franchise");
      order.franchise_id = new mongoose.Types.ObjectId(body.franchise_id);
    }
  }

  if (body.city_id !== undefined) {
    await assertObjectId(City, body.city_id, "city");
    order.city_id = new mongoose.Types.ObjectId(body.city_id);
  }

  if (body.category_id !== undefined) {
    await assertObjectId(Category, body.category_id, "category");
    order.category_id = new mongoose.Types.ObjectId(body.category_id);
  }

  if (body.service_id !== undefined) {
    if (body.service_id === null || body.service_id === "") {
      order.service_id = null;
    } else {
      await assertObjectId(Service, body.service_id, "service");
      order.service_id = new mongoose.Types.ObjectId(body.service_id);
    }
  }

  if (body.address !== undefined) {
    order.address = String(body.address);
  }

  if (Object.prototype.hasOwnProperty.call(body, "address_id")) {
    if (body.address_id === null || body.address_id === "") {
      order.address_id = null;
    } else {
      await assertObjectId(Address, body.address_id, "address");
      order.address_id = new mongoose.Types.ObjectId(body.address_id);
    }
  }

  if (body.order_date !== undefined) {
    order.order_date = body.order_date ? new Date(body.order_date) : null;
  }

  if (body.order_description !== undefined) {
    order.order_description = String(body.order_description ?? "").trim();
  }

  if (body.customer_description !== undefined) {
    order.customer_description = String(body.customer_description ?? "").trim();
  }

  if (body.admin_description !== undefined) {
    order.admin_description = normalizeAdminDescription(body.admin_description);
  }

  if (body.from_date !== undefined) {
    order.from_date = body.from_date ? new Date(body.from_date) : null;
  }
  if (body.to_date !== undefined) {
    order.to_date = body.to_date ? new Date(body.to_date) : null;
  }
  if (body.work_hours_per_day !== undefined) {
    order.work_hours_per_day = Number(body.work_hours_per_day) || 0;
  }
  if (body.total_work_hours !== undefined) {
    order.total_work_hours = Number(body.total_work_hours) || 0;
  }
  if (body.work_start_time !== undefined) {
    order.work_start_time = body.work_start_time ?? "";
  }
  if (body.work_end_time !== undefined) {
    order.work_end_time = body.work_end_time ?? "";
  }

  if (body.payment_schedule_type !== undefined) {
    const pst = String(body.payment_schedule_type).trim();
    if (!PAYMENT_SCHEDULE_TYPES.has(pst)) {
      throw new OrderCreationError(
        "payment_schedule_type must be single or installments.",
        409
      );
    }
    order.payment_schedule_type = pst;
  }

  if (body.customer_payment_method !== undefined) {
    order.customer_payment_method = String(body.customer_payment_method ?? "").trim();
  }

  if (body.type !== undefined) {
    const t = Number(body.type);
    if (!Number.isFinite(t)) {
      throw new OrderCreationError("type must be a number.", 400);
    }
    order.type = t;
  }

  return { partnerChanged, userChanged };
};

const resolveLineCharge = (item) => {
  if (item.total_service_charge !== undefined && item.total_service_charge !== null) {
    return Number(item.total_service_charge);
  }
  if (item.service_price !== undefined && item.service_price !== null) {
    return Number(item.service_price);
  }
  return null;
};

/**
 * Update order_service line(s). Default target: sole line on order when _id omitted.
 */
const applyServiceItemsUpdate = async (order, body) => {
  const ops = normalizeServiceItemsOps(body.service_items);
  if (ops.update.length === 0) {
    return { lineChargeForReprice: null };
  }

  const orderLineIds = (order.service_items || []).map((id) => String(id));
  let lineChargeForReprice = null;

  for (let i = 0; i < ops.update.length; i += 1) {
    const item = ops.update[i];
    let lineId = item._id ?? item.id;

    if (!lineId) {
      if (orderLineIds.length !== 1) {
        throw new OrderCreationError(
          `service_items.update[${i}]: _id is required when order has multiple lines.`,
          400
        );
      }
      lineId = orderLineIds[0];
    }

    if (!mongoose.Types.ObjectId.isValid(String(lineId))) {
      throw new OrderCreationError(
        `service_items.update[${i}]: invalid _id.`,
        400
      );
    }

    if (!orderLineIds.includes(String(lineId))) {
      throw new OrderCreationError(
        `service_items.update[${i}]: line does not belong to this order.`,
        404
      );
    }

    const line = await OrderService.findOne({
      _id: lineId,
      order_id: order._id,
      deleted_at: null,
    });

    if (!line) {
      throw new OrderCreationError(
        `service_items.update[${i}]: order service not found.`,
        404
      );
    }

    if (Object.prototype.hasOwnProperty.call(item, "user_id")) {
      await assertObjectId(User, item.user_id, "user");
      line.user_id = new mongoose.Types.ObjectId(item.user_id);
      line.user_unique_id =
        item.user_unique_id !== undefined
          ? String(item.user_unique_id).trim()
          : await loadUserUniqueId(item.user_id);
    }

    if (Object.prototype.hasOwnProperty.call(item, "partner_id")) {
      await assertObjectId(User, item.partner_id, "partner");
      line.partner_id = new mongoose.Types.ObjectId(item.partner_id);
      const partner = await User.findById(line.partner_id).select("user_id").lean();
      if (!partner) {
        throw new OrderCreationError("Partner user not found.", 404);
      }
      line.partner_unique_id = partner.user_id || "";
      order.partner_id = line.partner_id;
    }

    if (item.category_id !== undefined) {
      await assertObjectId(Category, item.category_id, "category");
      line.category_id = new mongoose.Types.ObjectId(item.category_id);
      order.category_id = line.category_id;
    }

    if (item.service_id !== undefined) {
      await assertObjectId(Service, item.service_id, "service");
      line.service_id = new mongoose.Types.ObjectId(item.service_id);
      order.service_id = line.service_id;
    }

    if (item.service_date !== undefined) {
      if (!item.service_date) {
        throw new OrderCreationError(
          `service_items.update[${i}]: service_date is required.`,
          409
        );
      }
      line.service_date = new Date(item.service_date);
    }

    if (item.service_from_time !== undefined) {
      if (!item.service_from_time) {
        throw new OrderCreationError(
          `service_items.update[${i}]: service_from_time is required.`,
          409
        );
      }
      line.service_from_time = new Date(item.service_from_time);
    }

    if (item.service_to_time !== undefined) {
      if (!item.service_to_time) {
        throw new OrderCreationError(
          `service_items.update[${i}]: service_to_time is required.`,
          409
        );
      }
      line.service_to_time = new Date(item.service_to_time);
    }

    if (item.service_status !== undefined) {
      const normalized = normalizeOrderStatus(item.service_status);
      if (!normalized) {
        throw new OrderCreationError(
          `service_items.update[${i}]: invalid service_status.`,
          409
        );
      }
      if (
        normalized === ORDER_STATUS_COMPLETED &&
        line.service_status !== ORDER_STATUS_COMPLETED
      ) {
        await assertOrderCanBeMarkedCompletedOrThrow(order);
      }
      line.service_status = normalized;
    }

    if (item.is_paid !== undefined) {
      line.is_paid = Boolean(item.is_paid);
    }

    const charge = resolveLineCharge(item);
    if (charge !== null) {
      if (!Number.isFinite(charge) || charge <= 0) {
        throw new OrderCreationError(
          `service_items.update[${i}]: total_service_charge must be > 0.`,
          409
        );
      }
      line.total_service_charge = charge;
      line.service_price = charge;
      lineChargeForReprice = charge;
      order.total_service_charge = charge;
      order.service_price = charge;
    }

    line.updated_at = new Date();
    await line.save();
  }

  return { lineChargeForReprice };
};

/**
 * Sync order header fields to all non-terminal service lines after bulk header changes.
 */
const syncHeaderFieldsToServiceLines = async (order, { partnerChanged, userChanged }) => {
  const lineIds = (order.service_items || []).filter(Boolean);
  if (lineIds.length === 0) return;

  const $set = { updated_at: new Date() };

  if (userChanged && order.user_id) {
    $set.user_id = order.user_id;
    $set.user_unique_id = order.user_unique_id;
  }

  if (partnerChanged && order.partner_id) {
    const partner = await User.findById(order.partner_id).select("user_id").lean();
    if (partner) {
      $set.partner_id = order.partner_id;
      $set.partner_unique_id = partner.user_id || "";
    }
  }

  if (order.category_id) {
    $set.category_id = order.category_id;
  }
  if (order.service_id) {
    $set.service_id = order.service_id;
  }

  if (Object.keys($set).length <= 1) return;

  await OrderService.updateMany(
    {
      _id: { $in: lineIds },
      service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
    },
    { $set }
  );
};

/**
 * Apply order + service_items field updates before reprice / status / nested resources.
 */
const applyOrderFieldsAndServicesUpdate = async (order, body) => {
  const headerResult = await applyOrderLevelFields(order, body);
  const { lineChargeForReprice } = await applyServiceItemsUpdate(order, body);
  await syncHeaderFieldsToServiceLines(order, headerResult);

  if (Number(order.type) === 1 && !order.partner_id) {
    throw new OrderCreationError(
      "partner_id is required on the order when type is 1.",
      409
    );
  }

  return {
    lineChargeForReprice,
    triggerRepriceFromLine:
      lineChargeForReprice !== null &&
      body.total_service_charge === undefined &&
      body.service_price === undefined &&
      !Object.prototype.hasOwnProperty.call(body, "offer_id"),
  };
};

const hasOrderFieldUpdates = (body) => {
  const keys = [
    "user_id",
    "user_unique_id",
    "partner_id",
    "employee_id",
    "franchise_id",
    "city_id",
    "category_id",
    "service_id",
    "address",
    "address_id",
    "order_date",
    "order_description",
    "customer_description",
    "from_date",
    "to_date",
    "work_hours_per_day",
    "total_work_hours",
    "work_start_time",
    "work_end_time",
    "payment_schedule_type",
    "customer_payment_method",
    "type",
    "service_items",
  ];
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
};

module.exports = {
  applyOrderFieldsAndServicesUpdate,
  hasOrderFieldUpdates,
  normalizeServiceItemsOps,
};
