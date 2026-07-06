#!/usr/bin/env node
/**
 * Seed bootstrap config collections into MongoDB (run from your laptop).
 *
 * Collections: subscription_plans, quote_settings, user_home_counts
 *
 * Usage (from help-pr-backend-staging/):
 *   node scripts/seed-bootstrap-config.js
 *   node scripts/seed-bootstrap-config.js --dry-run
 *   node scripts/seed-bootstrap-config.js --force   # replace existing singleton docs
 *
 * Env: MONGO_URI (or MONGODB_URI / DB_URL) in .env here or in repo root ../.env
 */
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Windows: Node SRV lookup often fails with ISP DNS; Lambda is unaffected.
if (process.platform === 'win32' && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const loadEnv = () => {
  const dotenv = require('dotenv');
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`Loaded env from ${envPath}`);
      return;
    }
  }
  dotenv.config();
};

const parseExtendedDoc = (doc) => {
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === '__v') continue;
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$oid')) {
      out[key] = new mongoose.Types.ObjectId(value.$oid);
    } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$date')) {
      out[key] = new Date(value.$date);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const readSeedArray = (relativePath) => {
  const filePath = path.join(__dirname, '..', '..', 'db-data', relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed file not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`${relativePath} must be a JSON array`);
  }
  return raw.map(parseExtendedDoc);
};

const maskUri = (uri) => String(uri).replace(/:([^:@/]+)@/, ':***@');

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  loadEnv();

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI / DB_URL) in .env');
    process.exit(1);
  }

  console.log(`Target: ${maskUri(uri)}`);
  if (dryRun) console.log('DRY RUN — no writes');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // --- subscription_plans ---
  const plans = readSeedArray('helper.subscription_plans.json');
  const plansCol = db.collection('subscription_plans');
  const existingPlans = await plansCol
    .find({ deleted_at: null, plan_name: { $in: plans.map((p) => p.plan_name) } })
    .project({ plan_name: 1 })
    .toArray();

  if (existingPlans.length > 0 && !force) {
    console.log(
      `subscription_plans: skip (${existingPlans.length} plan(s) already exist: ${existingPlans.map((p) => p.plan_name).join(', ')})`
    );
  } else if (dryRun) {
    console.log(`subscription_plans: would insert ${plans.length} plan(s)`);
  } else {
    if (existingPlans.length > 0 && force) {
      await plansCol.deleteMany({ plan_name: { $in: plans.map((p) => p.plan_name) } });
      console.log('subscription_plans: removed existing plans (--force)');
    }
    const result = await plansCol.insertMany(plans, { ordered: false });
    console.log(`subscription_plans: inserted ${result.insertedCount} plan(s)`);
  }

  // --- quote_settings (singleton) ---
  const quoteSettings = readSeedArray('helper.quote_settings.json');
  const quoteDoc = quoteSettings[0];
  const quoteCol = db.collection('quote_settings');
  const existingQuote = await quoteCol.findOne({});

  if (existingQuote && !force) {
    console.log(`quote_settings: skip (document already exists _id=${existingQuote._id})`);
  } else if (dryRun) {
    console.log('quote_settings: would insert 1 document');
  } else {
    if (existingQuote && force) {
      await quoteCol.deleteMany({});
      console.log('quote_settings: removed existing document (--force)');
    }
    await quoteCol.insertOne(quoteDoc);
    console.log('quote_settings: inserted 1 document');
  }

  // --- user_home_counts (singleton) ---
  const homeCounts = readSeedArray('helper.user_home_counts.json');
  const homeDoc = homeCounts[0];
  const homeCol = db.collection('user_home_counts');
  const existingHome = await homeCol.findOne({});

  if (existingHome && !force) {
    console.log(`user_home_counts: skip (document already exists _id=${existingHome._id})`);
  } else if (dryRun) {
    console.log('user_home_counts: would insert 1 document');
  } else {
    if (existingHome && force) {
      await homeCol.deleteMany({});
      console.log('user_home_counts: removed existing document (--force)');
    }
    await homeCol.insertOne(homeDoc);
    console.log('user_home_counts: inserted 1 document');
  }

  // Summary
  const counts = {
    subscription_plans: await plansCol.countDocuments({ deleted_at: null }),
    quote_settings: await quoteCol.countDocuments({}),
    user_home_counts: await homeCol.countDocuments({}),
  };
  console.log('Final counts:', counts);

  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
