/**
 * Backfill partner_service.payment_type from the master service document
 * when the partner row is missing or blank.
 *
 * Usage (from help-pr-backend-staging/):
 *   node scripts/backfill-partner-service-payment-type.js
 *   node scripts/backfill-partner-service-payment-type.js --dry-run
 *   node scripts/backfill-partner-service-payment-type.js --include-deleted
 */
require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');
const PartnerService = require('../models/partner_service');
const Service = require('../models/service');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const BATCH_SIZE = 200;
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const INCLUDE_DELETED = args.has('--include-deleted');

const trimPaymentType = (value) => (value != null ? String(value).trim() : '');

const isBlankPaymentType = (value) => trimPaymentType(value) === '';

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error('Set MONGO_URI, MONGODB_URI, or DB_URL');
    process.exit(1);
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    family: 4,
  });
  console.log(
    `Connected. Backfilling partner_service.payment_type${DRY_RUN ? ' (dry-run)' : ''}...`
  );

  const filter = {
    $or: [
      { payment_type: { $exists: false } },
      { payment_type: null },
      { payment_type: '' },
    ],
  };
  if (!INCLUDE_DELETED) {
    filter.deleted_at = null;
  }

  let processed = 0;
  let updated = 0;
  let skippedNoService = 0;
  let skippedNoMaster = 0;
  let skippedMasterBlank = 0;
  let lastId = null;

  while (true) {
    const query = { ...filter };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await PartnerService.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id service_id payment_type')
      .lean();

    if (batch.length === 0) break;

    const serviceIds = [
      ...new Set(
        batch
          .map((row) => (row.service_id ? String(row.service_id) : ''))
          .filter(Boolean)
      ),
    ];

    const masterDocs =
      serviceIds.length === 0
        ? []
        : await Service.find({ _id: { $in: serviceIds } })
            .select('_id payment_type')
            .lean();
    const masterPaymentType = new Map(
      masterDocs.map((s) => [String(s._id), trimPaymentType(s.payment_type)])
    );

    const ops = [];
    const now = new Date();

    for (const row of batch) {
      processed += 1;
      lastId = row._id;

      if (!isBlankPaymentType(row.payment_type)) continue;

      if (!row.service_id) {
        skippedNoService += 1;
        continue;
      }

      const serviceKey = String(row.service_id);
      if (!masterPaymentType.has(serviceKey)) {
        skippedNoMaster += 1;
        continue;
      }

      const paymentType = masterPaymentType.get(serviceKey);
      if (!paymentType) {
        skippedMasterBlank += 1;
        continue;
      }

      updated += 1;
      ops.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { payment_type: paymentType, updated_at: now } },
        },
      });
    }

    if (!DRY_RUN && ops.length > 0) {
      await PartnerService.bulkWrite(ops, { ordered: false });
    }

    console.log(`Processed ${processed}, would-update/updated ${updated}...`);
  }

  console.log(
    [
      'Done.',
      `processed=${processed}`,
      `${DRY_RUN ? 'would_update' : 'updated'}=${updated}`,
      `skipped_no_service_id=${skippedNoService}`,
      `skipped_master_not_found=${skippedNoMaster}`,
      `skipped_master_blank=${skippedMasterBlank}`,
    ].join(' ')
  );

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
