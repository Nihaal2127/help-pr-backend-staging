/**
 * Recompute payment rollups (incl. zero pending for cancelled/refunded) and partner wallet on all active orders.
 * Run after fixing partner rollup logic (entitlement-based allowance).
 *
 *   node scripts/resync-partner-payment-rollups.js
 *   node scripts/resync-partner-payment-rollups.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/order");
const { syncOrderPaymentStatus } = require("../services/order_payment_status_service");

const dryRun = process.argv.includes("--dry-run");

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error("Set MONGODB_URI or DB_URL");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const orders = await Order.find({ deleted_at: null }).select("_id unique_id").lean();
  let updated = 0;
  for (const row of orders) {
    if (dryRun) {
      console.log(`[dry-run] would sync ${row.unique_id || row._id}`);
      continue;
    }
    await syncOrderPaymentStatus(row._id);
    updated += 1;
    if (updated % 100 === 0) {
      console.log(`Synced ${updated}/${orders.length}...`);
    }
  }
  console.log(
    dryRun
      ? `Dry run: ${orders.length} orders would be synced.`
      : `Done: synced ${updated} orders.`
  );
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
