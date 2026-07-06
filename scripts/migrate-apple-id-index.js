/**
 * Fix apple_id unique index: sparse indexes still treat explicit null as a value.
 * This script unsets null/empty apple_id and recreates a partial unique index.
 *
 * Usage: node scripts/migrate-apple-id-index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const INDEX_NAME = 'apple_id_1';

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI / DB_URL)');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected.');

  const collection = mongoose.connection.collection('users');

  const unsetResult = await collection.updateMany(
    {
      $or: [{ apple_id: null }, { apple_id: '' }],
    },
    { $unset: { apple_id: '' } }
  );
  console.log('Unset null/empty apple_id on documents:', unsetResult.modifiedCount);

  const indexes = await collection.indexes();
  const hasAppleIdIndex = indexes.some((idx) => idx.name === INDEX_NAME);
  if (hasAppleIdIndex) {
    await collection.dropIndex(INDEX_NAME);
    console.log('Dropped old index:', INDEX_NAME);
  }

  await collection.createIndex(
    { apple_id: 1 },
    {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: {
        apple_id: { $exists: true, $type: 'string', $ne: '' },
      },
    }
  );
  console.log('Created partial unique index on apple_id');

  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
