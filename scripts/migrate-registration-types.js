/**
 * Backfill user.registration_type to the clarified mapping:
 *   1 OTP, 2 Google, 3 Apple, 4 admin registered, 5 email and password
 *
 * Existing Google (2) and Apple (3) self-signups are left unchanged.
 * Admin-created users (is_from_web or created_by_id) become 4.
 * Remaining accounts with a password become 5; everything else becomes 1 (OTP).
 *
 * Usage:
 *   node scripts/migrate-registration-types.js --dry-run
 *   node scripts/migrate-registration-types.js
 */
require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');

// Node on Windows often fails mongodb+srv SRV lookups via the system resolver.
if (process.platform === 'win32' && typeof dns.setServers === 'function') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (_) {
    // Keep the default resolver if this environment disallows setServers.
  }
}
const {
  REGISTRATION_TYPE_OTP,
  REGISTRATION_TYPE_GOOGLE,
  REGISTRATION_TYPE_APPLE,
  REGISTRATION_TYPE_ADMIN,
  REGISTRATION_TYPE_EMAIL_PASSWORD,
  getRegistrationTypeLabel,
} = require('../constants/registration_types');

const ADMIN_FILTER = {
  $or: [
    { is_from_web: true },
    { created_by_id: { $type: 'objectId' } },
  ],
};

const HAS_PASSWORD_FILTER = {
  password: { $exists: true, $type: 'string', $ne: '' },
};

const EMAIL_PASSWORD_FILTER = {
  $nor: [ADMIN_FILTER],
  registration_type: { $nin: [REGISTRATION_TYPE_GOOGLE, REGISTRATION_TYPE_APPLE] },
  ...HAS_PASSWORD_FILTER,
};

const OTP_FILTER = {
  $nor: [ADMIN_FILTER],
  registration_type: { $nin: [REGISTRATION_TYPE_GOOGLE, REGISTRATION_TYPE_APPLE] },
  $or: [{ password: { $exists: false } }, { password: null }, { password: '' }],
};

const dryRun = process.argv.includes('--dry-run');

const printDistribution = async (collection, label) => {
  const rows = await collection
    .aggregate([{ $group: { _id: '$registration_type', count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .toArray();
  console.log(label);
  if (rows.length === 0) {
    console.log('  (no users)');
    return;
  }
  for (const row of rows) {
    const name = getRegistrationTypeLabel(row._id) || `unknown (${row._id})`;
    console.log(`  ${row._id} ${name}: ${row.count}`);
  }
};

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI / DB_URL)');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection('users');
  console.log(dryRun ? 'Dry run. No documents will be updated.' : 'Connected. Migrating registration_type...');

  await printDistribution(collection, 'Current distribution:');

  const adminCount = await collection.countDocuments(ADMIN_FILTER);
  const emailPasswordCount = await collection.countDocuments(EMAIL_PASSWORD_FILTER);
  const otpCount = await collection.countDocuments(OTP_FILTER);

  console.log('Planned writes:');
  console.log(`  → ${REGISTRATION_TYPE_ADMIN} admin: ${adminCount}`);
  console.log(`  → ${REGISTRATION_TYPE_EMAIL_PASSWORD} email and password: ${emailPasswordCount}`);
  console.log(`  → ${REGISTRATION_TYPE_OTP} OTP (non-Google/Apple leftovers): ${otpCount}`);

  if (dryRun) {
    await mongoose.disconnect();
    console.log('Dry run complete.');
    return;
  }

  const adminResult = await collection.updateMany(ADMIN_FILTER, {
    $set: { registration_type: REGISTRATION_TYPE_ADMIN },
  });
  console.log('Set admin (4):', adminResult.modifiedCount);

  const emailResult = await collection.updateMany(EMAIL_PASSWORD_FILTER, {
    $set: { registration_type: REGISTRATION_TYPE_EMAIL_PASSWORD },
  });
  console.log('Set email and password (5):', emailResult.modifiedCount);

  const otpResult = await collection.updateMany(OTP_FILTER, {
    $set: { registration_type: REGISTRATION_TYPE_OTP },
  });
  console.log('Set OTP (1):', otpResult.modifiedCount);

  await printDistribution(collection, 'Updated distribution:');
  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
