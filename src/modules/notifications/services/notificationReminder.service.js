const Appointment = require("../../../../models/appointment");
const Order = require("../../../../models/order");
const Quote = require("../../../../models/quote");
const PartnerSubscription = require("../../../../models/partner_subscription");
const {
  APPOINTMENT_STATUS_SCHEDULED,
  normalizeAppointmentStatus,
} = require("../../../../enum/appointment_status_enum");
const { ORDER_STATUS_IN_PROGRESS } = require("../../../../enum/order_status_enum");
const { buildQuoteBucketFilter } = require("../../../../enum/quote_status_enum");
const { combineDateAndTime } = require("../../../../utils/order_schedule");
const { getReminderConfig } = require("../constants/reminder_config");
const { notify } = require("./notification.service");

const isScheduledAppointment = (status) => {
  const normalized = normalizeAppointmentStatus(status);
  return !normalized || normalized === APPOINTMENT_STATUS_SCHEDULED;
};

const reminderTimeBucket = (dateValue) => {
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return "unknown";
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}T${String(dt.getUTCHours()).padStart(2, "0")}`;
};

const uniqueObjectIds = (ids) => {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

const runServiceReminders = async (now = new Date()) => {
  const { serviceReminderLeadHours } = getReminderConfig();
  const horizon = new Date(now.getTime() + serviceReminderLeadHours * 60 * 60 * 1000);
  let candidates = 0;
  let notified = 0;

  const appointments = await Appointment.find({
    deleted_at: null,
    start_time: { $gte: now, $lte: horizon },
  })
    .select("_id order_id order_unique_id user_id partner_id franchise_id start_time status")
    .lean();

  const coveredOrderIds = new Set();

  for (const appointment of appointments) {
    if (!isScheduledAppointment(appointment.status)) continue;
    candidates += 1;

    if (appointment.order_id) {
      coveredOrderIds.add(String(appointment.order_id));
    }

    const recipientUserIds = uniqueObjectIds([
      appointment.user_id,
      appointment.partner_id,
    ]);
    if (!recipientUserIds.length) continue;

    await notify({
      eventKey: "SERVICE_REMINDER",
      recipientUserIds,
      context: { orderUniqueId: appointment.order_unique_id || "" },
      entityType: "order",
      entityId: appointment.order_id,
      franchiseId: appointment.franchise_id,
      metadata: {
        order_id: appointment.order_id,
        order_unique_id: appointment.order_unique_id || "",
        appointment_id: appointment._id,
        reminder_type: "service",
      },
      dedupeKeyPrefix: `reminder.service:appt:${appointment._id}:${reminderTimeBucket(appointment.start_time)}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const fromDateMin = new Date(now.getTime() - dayMs);
  const fromDateMax = new Date(horizon.getTime() + dayMs);

  const orders = await Order.find({
    deleted_at: null,
    order_status: ORDER_STATUS_IN_PROGRESS,
    from_date: { $gte: fromDateMin, $lte: fromDateMax },
    work_start_time: { $ne: "" },
  })
    .select("_id unique_id user_id partner_id franchise_id from_date work_start_time")
    .lean();

  for (const order of orders) {
    if (coveredOrderIds.has(String(order._id))) continue;

    const startAt = combineDateAndTime(order.from_date, order.work_start_time);
    if (!startAt || startAt < now || startAt > horizon) continue;

    candidates += 1;
    const recipientUserIds = uniqueObjectIds([order.user_id, order.partner_id]);
    if (!recipientUserIds.length) continue;

    await notify({
      eventKey: "SERVICE_REMINDER",
      recipientUserIds,
      context: { orderUniqueId: order.unique_id || "" },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: {
        order_id: order._id,
        order_unique_id: order.unique_id || "",
        reminder_type: "service",
      },
      dedupeKeyPrefix: `reminder.service:order:${order._id}:${reminderTimeBucket(startAt)}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  return { serviceReminderCandidates: candidates, serviceRemindersSent: notified };
};

const runQuoteReminders = async (now = new Date()) => {
  const { quotePendingStaleHours } = getReminderConfig();
  const staleBefore = new Date(now.getTime() - quotePendingStaleHours * 60 * 60 * 1000);
  let candidates = 0;
  let notified = 0;

  const pendingBucket = buildQuoteBucketFilter("pending");
  const pendingQuotes = pendingBucket
    ? await Quote.find({
        deleted_at: null,
        order_id: null,
        updated_at: { $lte: staleBefore },
        ...pendingBucket,
      })
        .select("_id quote_sequence_id partner_id franchise_id")
        .lean()
    : [];

  for (const quote of pendingQuotes) {
    if (!quote.partner_id) continue;
    candidates += 1;
    await notify({
      eventKey: "QUOTE_ACTION_REMINDER",
      recipientUserIds: [quote.partner_id],
      context: { quoteSequenceId: quote.quote_sequence_id || "" },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id || "",
        reminder_type: "quote_pending_partner",
      },
      dedupeKeyPrefix: `reminder.quote:pending:${quote._id}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  const acceptedBucket = buildQuoteBucketFilter("accepted");
  const acceptedQuotes = acceptedBucket
    ? await Quote.find({
        deleted_at: null,
        order_id: null,
        updated_at: { $lte: staleBefore },
        ...acceptedBucket,
      })
        .select("_id quote_sequence_id user_id franchise_id")
        .lean()
    : [];

  for (const quote of acceptedQuotes) {
    if (!quote.user_id) continue;
    candidates += 1;
    await notify({
      eventKey: "QUOTE_ACTION_REMINDER",
      recipientUserIds: [quote.user_id],
      context: { quoteSequenceId: quote.quote_sequence_id || "" },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id || "",
        reminder_type: "quote_accepted_customer",
      },
      dedupeKeyPrefix: `reminder.quote:accepted:${quote._id}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  const newBucket = buildQuoteBucketFilter("new");
  const newQuotes = newBucket
    ? await Quote.find({
        deleted_at: null,
        order_id: null,
        updated_at: { $lte: staleBefore },
        ...newBucket,
      })
        .select("_id quote_sequence_id user_id franchise_id")
        .lean()
    : [];

  for (const quote of newQuotes) {
    if (!quote.user_id || quote.partner_id) continue;
    candidates += 1;
    await notify({
      eventKey: "QUOTE_ACTION_REMINDER",
      recipientUserIds: [quote.user_id],
      context: { quoteSequenceId: quote.quote_sequence_id || "" },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id || "",
        reminder_type: "quote_new_customer",
      },
      dedupeKeyPrefix: `reminder.quote:new:${quote._id}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  return { quoteReminderCandidates: candidates, quoteRemindersSent: notified };
};

const runSubscriptionReminders = async (now = new Date()) => {
  const { subscriptionExpiringDays } = getReminderConfig();
  const horizon = new Date(now.getTime() + subscriptionExpiringDays * 24 * 60 * 60 * 1000);
  let candidates = 0;
  let notified = 0;

  const subscriptions = await PartnerSubscription.find({
    deleted_at: null,
    status: "active",
    expires_at: { $ne: null, $gte: now, $lte: horizon },
  })
    .populate("subscription_plan_id", "plan_name")
    .select("_id partner_id expires_at subscription_plan_id")
    .lean();

  for (const subscription of subscriptions) {
    if (!subscription.partner_id) continue;
    candidates += 1;

    const plan =
      subscription.subscription_plan_id &&
      typeof subscription.subscription_plan_id === "object"
        ? subscription.subscription_plan_id
        : null;
    const planName = plan?.plan_name || "";
    const expiryBucket = subscription.expires_at.toISOString().slice(0, 10);

    await notify({
      eventKey: "SUBSCRIPTION_EXPIRING_REMINDER",
      recipientUserIds: [subscription.partner_id],
      context: { planName, expiresAt: expiryBucket },
      entityType: "subscription",
      entityId: subscription._id,
      metadata: {
        subscription_id: subscription._id,
        expires_at: subscription.expires_at,
        reminder_type: "subscription_expiring",
      },
      dedupeKeyPrefix: `reminder.subscription:${subscription._id}:${expiryBucket}`,
      pushPreference: "reminder",
    });
    notified += 1;
  }

  return {
    subscriptionReminderCandidates: candidates,
    subscriptionRemindersSent: notified,
  };
};

const runAllReminders = async () => {
  const now = new Date();
  const [service, quote, subscription] = await Promise.all([
    runServiceReminders(now),
    runQuoteReminders(now),
    runSubscriptionReminders(now),
  ]);

  return {
    ok: true,
    ranAt: now.toISOString(),
    config: getReminderConfig(),
    ...service,
    ...quote,
    ...subscription,
  };
};

module.exports = {
  runServiceReminders,
  runQuoteReminders,
  runSubscriptionReminders,
  runAllReminders,
};
