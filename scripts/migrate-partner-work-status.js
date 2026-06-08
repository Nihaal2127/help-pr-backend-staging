/**
 * Backfill partner_work_status and partner_work_status_info on existing orders.
 *
 * Usage: node scripts/migrate-partner-work-status.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/order');
const {
  PARTNER_WORK_STATUS_PENDING,
  PARTNER_WORK_STATUS_IN_PROGRESS,
  PARTNER_WORK_STATUS_COMPLETED,
  buildPartnerWorkStatusInfo,
  touchPartnerWorkStatusInfo,
} = require('../enum/partner_work_status_enum');
const { ORDER_STATUS_COMPLETED } = require('../enum/order_status_enum');

const BATCH_SIZE = 200;

const resolveWorkStatusForOrder = (order) => {
  if (order.order_status === ORDER_STATUS_COMPLETED) {
    return PARTNER_WORK_STATUS_COMPLETED;
  }
  if (order.partner_work_status === PARTNER_WORK_STATUS_IN_PROGRESS) {
    return PARTNER_WORK_STATUS_IN_PROGRESS;
  }
  return PARTNER_WORK_STATUS_PENDING;
};

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGODB_URI or DB_URL');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Migrating partner_work_status...');

  let processed = 0;
  let updated = 0;
  let lastId = null;

  while (true) {
    const query = { deleted_at: null };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await Order.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id order_status partner_work_status partner_work_status_info')
      .lean();

    if (batch.length === 0) break;

    for (const row of batch) {
      processed += 1;
      lastId = row._id;

      const targetStatus = resolveWorkStatusForOrder(row);
      const needsStatus = row.partner_work_status !== targetStatus;
      const needsInfo =
        !Array.isArray(row.partner_work_status_info) ||
        row.partner_work_status_info.length === 0;

      if (!needsStatus && !needsInfo) continue;

      const order = await Order.findById(row._id);
      if (!order) continue;

      if (needsInfo) {
        order.partner_work_status_info = buildPartnerWorkStatusInfo();
      }

      if (needsStatus) {
        order.partner_work_status = targetStatus;
        touchPartnerWorkStatusInfo(order, targetStatus, null, 'migration');
      }

      order.updated_at = new Date();
      await order.save();
      updated += 1;
    }

    console.log(`Processed ${processed}, updated ${updated}...`);
  }

  console.log(`Done. Processed ${processed} orders, updated ${updated}.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
