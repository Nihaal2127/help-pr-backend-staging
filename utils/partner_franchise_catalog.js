const mongoose = require('mongoose');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const FranchiseCategory = require('../models/franchise_category');
const FranchiseService = require('../models/franchise_service');
const Service = require('../models/service');

/**
 * Categories / services allowed under a franchise: franchise document lists intersected with
 * mapping active_categories / active_services when present; services whose category is inactive are excluded.
 *
 * @param {mongoose.Types.ObjectId|string} franchiseId
 * @returns {{ ok: true, categoryIds: mongoose.Types.ObjectId[], serviceIds: mongoose.Types.ObjectId[] } | { ok: false, status: number, message: string }}
 */
async function resolveFranchiseCatalogByFranchiseId(franchiseId) {
  const fid =
    franchiseId instanceof mongoose.Types.ObjectId
      ? franchiseId
      : new mongoose.Types.ObjectId(String(franchiseId));

  const franchise = await Franchise.findOne({
    _id: fid,
    deleted_at: null,
  }).select('categories services');
  if (!franchise) {
    return { ok: false, status: 404, message: 'Franchise not found.' };
  }

  const franchiseCatIds = Array.isArray(franchise.categories) ? franchise.categories : [];
  const franchiseSvcIds = Array.isArray(franchise.services) ? franchise.services : [];

  const [fc, fsRow] = await Promise.all([
    FranchiseCategory.findOne({ franchise_id: fid, deleted_at: null })
      .sort({ created_at: -1 })
      .select('active_categories')
      .lean(),
    FranchiseService.findOne({ franchise_id: fid, deleted_at: null })
      .sort({ created_at: -1 })
      .select('active_services')
      .lean(),
  ]);

  let categoryIds;
  if (fc && Array.isArray(fc.active_categories)) {
    const allow = new Set(fc.active_categories.map((x) => x.toString()));
    categoryIds = franchiseCatIds.filter((cid) => allow.has(cid.toString()));
  } else {
    categoryIds = franchiseCatIds;
  }

  let serviceIdsFromFranchise;
  if (fsRow && Array.isArray(fsRow.active_services)) {
    const allow = new Set(fsRow.active_services.map((x) => x.toString()));
    serviceIdsFromFranchise = franchiseSvcIds.filter((sid) => allow.has(sid.toString()));
  } else {
    serviceIdsFromFranchise = franchiseSvcIds;
  }

  const categoryAllow = new Set(categoryIds.map((c) => c.toString()));
  const svcDocs =
    serviceIdsFromFranchise.length === 0
      ? []
      : await Service.find({
          _id: { $in: serviceIdsFromFranchise },
          deleted_at: null,
        })
          .select('category_id')
          .lean();

  const serviceIds = svcDocs
    .filter((s) => s.category_id && categoryAllow.has(s.category_id.toString()))
    .map((s) => s._id);

  return { ok: true, categoryIds, serviceIds };
}

/**
 * Same resolution as {@link resolveFranchiseCatalogByFranchiseId} using the partner user's linked franchise.
 * @param {mongoose.Types.ObjectId|string} partnerId
 */
async function resolvePartnerFranchiseCatalog(partnerId) {
  const user = await User.findOne({ _id: partnerId, deleted_at: null }).select('franchise_id');
  if (!user) {
    return { ok: false, status: 401, message: 'User not found.' };
  }
  if (!user.franchise_id) {
    return { ok: false, status: 400, message: 'Partner account is not linked to a franchise.' };
  }
  return resolveFranchiseCatalogByFranchiseId(user.franchise_id);
}

module.exports = {
  resolveFranchiseCatalogByFranchiseId,
  resolvePartnerFranchiseCatalog,
};
