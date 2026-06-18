/**
 * Backfill order group chats for orders missing chat_id.
 *
 * Usage: node scripts/backfill-order-chats.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/order");
const { createOrderChatForOrder } = require("../src/modules/chat/services/chatProvisioning.service");

const BATCH_SIZE = 100;

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error("Set MONGODB_URI or DB_URL");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected. Backfilling order chats...");

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let lastId = null;

  while (true) {
    const query = {
      deleted_at: null,
      $or: [{ chat_id: null }, { chat_id: { $exists: false } }],
    };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await Order.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!batch.length) {
      break;
    }

    for (const order of batch) {
      processed += 1;
      try {
        const chat = await createOrderChatForOrder(order);
        if (chat) {
          created += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`Order ${order._id}:`, error.message);
      }
    }

    lastId = batch[batch.length - 1]._id;
    console.log(`Processed ${processed} (created ${created}, skipped ${skipped}, failed ${failed})`);
  }

  console.log(
    `Done. processed=${processed} created=${created} skipped=${skipped} failed=${failed}`
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
