#!/usr/bin/env node
/**
 * One-off sync: align franchise_category / franchise_service mappings with global catalogue state.
 *
 * For every global category or service that is inactive (and not a pending request row), applies the
 * same cascade used by PUT /api/category/:id and PUT /api/service/:id.
 *
 * Usage (from help-pr-backend-staging/):
 *   node scripts/sync-global-catalog-to-franchise-mappings.js
 *   node scripts/sync-global-catalog-to-franchise-mappings.js --dry-run
 *
 * Requires MONGO_URI in .env (same as the API).
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Category = require('../models/category');
const Service = require('../models/service');
const {
    cascadeGlobalCategoryInactive,
    cascadeGlobalServiceInactive,
} = require('../utils/global_catalog_cascade');

const parseArgs = () => ({
    dryRun: process.argv.includes('--dry-run'),
});

const globalInactiveFilter = {
    deleted_at: null,
    is_request: false,
    is_active: false,
};

const run = async () => {
    const { dryRun } = parseArgs();

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Add it to help-pr-backend-staging/.env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected to MongoDB');
    if (dryRun) console.log('DRY RUN — no documents will be modified\n');

    const categoryQuery = { ...globalInactiveFilter };
    const serviceQuery = { ...globalInactiveFilter };

    const [inactiveCategories, inactiveServices] = await Promise.all([
        Category.find(categoryQuery).select('_id name category_id is_active').lean(),
        Service.find(serviceQuery).select('_id name service_id category_id is_active').lean(),
    ]);

    console.log(`Found ${inactiveCategories.length} globally inactive categor${inactiveCategories.length === 1 ? 'y' : 'ies'}`);
    console.log(`Found ${inactiveServices.length} globally inactive service(s)\n`);

    const stats = {
        categoriesProcessed: 0,
        servicesProcessed: 0,
        categoryErrors: 0,
        serviceErrors: 0,
    };

    for (const cat of inactiveCategories) {
        const label = cat.name || cat.category_id || cat._id.toString();
        if (dryRun) {
            console.log(`[dry-run] Would cascade inactive category: ${label} (${cat._id})`);
            stats.categoriesProcessed += 1;
            continue;
        }
        try {
            await cascadeGlobalCategoryInactive(cat._id);
            console.log(`Synced category: ${label} (${cat._id})`);
            stats.categoriesProcessed += 1;
        } catch (err) {
            stats.categoryErrors += 1;
            console.error(`Failed category ${cat._id}: ${err.message}`);
        }
    }

    for (const svc of inactiveServices) {
        const label = svc.name || svc.service_id || svc._id.toString();
        if (dryRun) {
            console.log(`[dry-run] Would cascade inactive service: ${label} (${svc._id})`);
            stats.servicesProcessed += 1;
            continue;
        }
        try {
            await cascadeGlobalServiceInactive(svc._id);
            console.log(`Synced service: ${label} (${svc._id})`);
            stats.servicesProcessed += 1;
        } catch (err) {
            stats.serviceErrors += 1;
            console.error(`Failed service ${svc._id}: ${err.message}`);
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Categories: ${stats.categoriesProcessed} processed, ${stats.categoryErrors} error(s)`);
    console.log(`Services:   ${stats.servicesProcessed} processed, ${stats.serviceErrors} error(s)`);
    if (dryRun) {
        console.log('\nRe-run without --dry-run to apply changes.');
    }

    await mongoose.disconnect();
    process.exit(stats.categoryErrors + stats.serviceErrors > 0 ? 1 : 0);
};

run().catch((err) => {
    console.error('Sync failed:', err);
    mongoose.disconnect().finally(() => process.exit(1));
});
