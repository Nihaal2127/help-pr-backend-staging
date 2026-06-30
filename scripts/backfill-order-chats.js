/**
 * Backfill order group chats for orders missing chat_id via Chat Service.
 *
 * Requires:
 *   CHAT_SERVICE_ENABLED=true
 *   CHAT_SERVICE_BASE_URL
 *   CHAT_SERVICE_INTERNAL_API_KEY
 *   MONGO_URI (or MONGODB_URI)
 *
 * Usage: node scripts/backfill-order-chats.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/order");
const { provisionOrderChat, isChatServiceEnabled } = require("../services/chat_service_client");

const BATCH_SIZE = 100;

const run = async () => {
  if (!isChatServiceEnabled()) {
    console.error("Set CHAT_SERVICE_ENABLED=true, CHAT_SERVICE_BASE_URL, and CHAT_SERVICE_INTERNAL_API_KEY");
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error("Set MONGO_URI, MONGODB_URI, or DB_URL");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected. Backfilling order chats via Chat Service...");

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
        const result = await provisionOrderChat(order._id);
        if (result.ok && result.chatId) {
          await Order.updateOne(
            { _id: order._id },
            { $set: { chat_id: result.chatId, updated_at: new Date() } }
          );
          created += result.created ? 1 : 0;
          if (!result.created) {
            skipped += 1;
          }
        } else {
          failed += 1;
          console.error(`Order ${order._id}:`, result.message || "provision failed");
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
