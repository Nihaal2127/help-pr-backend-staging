/**
 * One-time migration: payment-based partner wallet credits.
 *
 * 1. Soft-delete legacy order-level credits (no order_payment_id).
 * 2. Soft-delete legacy partner order_payment debits.
 * 3. Re-sync credits from completed partner order_payment rows per order.
 *
 * Usage (from help-pr-backend-staging):
 *   node scripts/migrate-partner-wallet-payment-credits.js
 *   node scripts/migrate-partner-wallet-payment-credits.js --dry-run
 */
require('dotenv').config();
const connectDB = require('../config/db');
const Order = require('../models/order');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const { syncAllPartnerOrderPaymentsForOrder } = require('../services/partner_wallet_order_service');

const dryRun = process.argv.includes('--dry-run');

const run = async () => {
    await connectDB();

    const now = new Date();
    const legacyCreditFilter = {
        transaction_type: 'credit',
        deleted_at: null,
        order_payment_id: null,
        payout_id: null,
        $or: [{ financial_order_id: null }, { financial_order_id: { $exists: false } }],
        order_id: { $ne: null },
    };

    const legacyCredits = await PartnerWalletLedger.countDocuments(legacyCreditFilter);
    const legacyDebits = await PartnerWalletLedger.countDocuments({
        transaction_type: 'debit',
        deleted_at: null,
        order_payment_id: { $ne: null },
        payout_id: null,
    });

    console.log(`Legacy order-level credits to retire: ${legacyCredits}`);
    console.log(`Legacy partner-payment debits to retire: ${legacyDebits}`);

    if (!dryRun) {
        await PartnerWalletLedger.updateMany(legacyCreditFilter, {
            $set: { deleted_at: now, updated_at: now },
        });
        await PartnerWalletLedger.updateMany(
            {
                transaction_type: 'debit',
                deleted_at: null,
                order_payment_id: { $ne: null },
                payout_id: null,
            },
            { $set: { deleted_at: now, updated_at: now } }
        );
    }

    const orders = await Order.find({ partner_id: { $ne: null }, deleted_at: null })
        .select('_id unique_id')
        .lean();

    console.log(`Re-syncing wallet for ${orders.length} orders with a partner...`);

    let synced = 0;
    for (const order of orders) {
        if (!dryRun) {
            await syncAllPartnerOrderPaymentsForOrder(order._id);
        }
        synced += 1;
        if (synced % 100 === 0) {
            console.log(`  ${synced}/${orders.length}`);
        }
    }

    console.log(dryRun ? 'Dry run complete (no writes).' : 'Migration complete.');
    process.exit(0);
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
