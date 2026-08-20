/**
 * Migrate franchise.city_id / city_name from single values to arrays.
 * Idempotent: skips documents where city_id is already an array.
 *
 * Usage: node scripts/migrate-franchise-city-to-array.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI / DB_URL)');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected.');

  const collection = mongoose.connection.collection('franchises');

  const cursor = collection.find({
    $or: [
      { city_id: { $exists: true, $not: { $type: 'array' } } },
      { city_name: { $exists: true, $not: { $type: 'array' } } },
    ],
  });

  let scanned = 0;
  let modified = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const update = {};

    if (doc.city_id != null && !Array.isArray(doc.city_id)) {
      update.city_id = [doc.city_id];
    } else if (doc.city_id == null) {
      update.city_id = [];
    }

    if (doc.city_name != null && !Array.isArray(doc.city_name)) {
      update.city_name = [String(doc.city_name)];
    } else if (doc.city_name == null) {
      update.city_name = [];
    }

    if (Object.keys(update).length === 0) continue;

    const result = await collection.updateOne({ _id: doc._id }, { $set: update });
    if (result.modifiedCount > 0) modified += 1;
  }

  console.log(`Scanned ${scanned} franchise(s) needing shape fix; modified ${modified}.`);

  // Ensure multikey index on city_id exists (safe if already present).
  try {
    await collection.createIndex({ city_id: 1 });
    console.log('Ensured index on city_id.');
  } catch (err) {
    console.warn('Index ensure note:', err.message);
  }

  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
