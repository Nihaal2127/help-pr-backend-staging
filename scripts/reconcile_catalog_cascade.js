/**
 * One-time reconciliation: align franchise arrays and partner catalog rows with
 * globally inactive / deleted categories and services.
 *
 * Usage (from help-pr-backend-staging): node scripts/reconcile_catalog_cascade.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');
const {
    onGlobalCategoryDeactivated,
    onGlobalServiceDeactivated,
} = require('../services/catalog_cascade_service');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('Set MONGODB_URI or MONGO_URI');
        process.exit(1);
    }
    await mongoose.connect(uri);
    console.log('Connected. Reconciling catalog cascades...');

    const inactiveCategories = await Category.find({
        deleted_at: null,
        $or: [{ is_active: false }, { is_request: true }],
    }).select('_id');

    for (const cat of inactiveCategories) {
        const r = await onGlobalCategoryDeactivated(cat._id);
        console.log('category', cat._id.toString(), r);
    }

    const deletedCategories = await Category.find({
        deleted_at: { $ne: null },
    }).select('_id');
    for (const cat of deletedCategories) {
        const r = await onGlobalCategoryDeactivated(cat._id);
        console.log('deleted category', cat._id.toString(), r);
    }

    const inactiveServices = await Service.find({
        deleted_at: null,
        $or: [{ is_active: false }, { is_request: true }],
    }).select('_id');

    for (const svc of inactiveServices) {
        const r = await onGlobalServiceDeactivated(svc._id);
        console.log('service', svc._id.toString(), r);
    }

    const deletedServices = await Service.find({
        deleted_at: { $ne: null },
    }).select('_id');
    for (const svc of deletedServices) {
        const r = await onGlobalServiceDeactivated(svc._id);
        console.log('deleted service', svc._id.toString(), r);
    }

    console.log('Done.');
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
