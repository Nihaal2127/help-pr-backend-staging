const mongoose = require('mongoose');
const PartnerCategory = require('../models/partner_category');
const PartnerService = require('../models/partner_service');
const Service = require('../models/service');

const toOid = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
};

/**
 * Build desired partner_service rows from partner_category documents
 * (not deleted, is_active). Skips services whose global category_id does not match the row.
 */
async function syncPartnerServicesFromPartnerCategories(partnerOid) {
  const partnerId = toOid(partnerOid);
  const pcRows = await PartnerCategory.find({
    partner_id: partnerId,
    deleted_at: null,
    is_active: true,
  })
    .select('category_id services')
    .lean();

  const allServiceIds = [];
  for (const row of pcRows) {
    const list = Array.isArray(row.services) ? row.services : [];
    for (const sid of list) {
      if (sid) allServiceIds.push(toOid(sid));
    }
  }
  const uniqueIds = [...new Map(allServiceIds.map((id) => [String(id), id])).values()];
  const svcDocs =
    uniqueIds.length === 0
      ? []
      : await Service.find({ _id: { $in: uniqueIds }, deleted_at: null }).select('_id category_id').lean();
  const svcCat = new Map(svcDocs.map((s) => [String(s._id), s.category_id ? String(s.category_id) : null]));

  const desired = new Map();
  for (const row of pcRows) {
    const catStr = row.category_id ? String(row.category_id) : '';
    if (!catStr) continue;
    const catOid = toOid(row.category_id);
    const list = Array.isArray(row.services) ? row.services : [];
    for (const sid of list) {
      if (!sid) continue;
      const sKey = String(sid);
      if (svcCat.get(sKey) !== catStr) continue;
      desired.set(sKey, catOid);
    }
  }

  const existingActive = await PartnerService.find({
    partner_id: partnerId,
    deleted_at: null,
  }).select('_id service_id category_id');

  for (const doc of existingActive) {
    const sid = doc.service_id?.toString();
    if (!sid || !desired.has(sid)) {
      doc.deleted_at = new Date();
      doc.updated_at = new Date();
      await doc.save();
    } else if (String(doc.category_id) !== String(desired.get(sid))) {
      doc.category_id = desired.get(sid);
      doc.updated_at = new Date();
      await doc.save();
    }
  }

  for (const [sidStr, catOid] of desired) {
    const svcOid = toOid(sidStr);
    let ps = await PartnerService.findOne({
      partner_id: partnerId,
      service_id: svcOid,
      deleted_at: null,
    });
    if (!ps) {
      ps = await PartnerService.findOne({
        partner_id: partnerId,
        service_id: svcOid,
        deleted_at: { $ne: null },
      }).sort({ updated_at: -1 });
    }
    if (!ps) {
      await PartnerService.create({
        partner_id: partnerId,
        service_id: svcOid,
        category_id: catOid,
        is_accept_request: true,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
    } else if (ps.deleted_at) {
      ps.deleted_at = null;
      ps.category_id = catOid;
      ps.updated_at = new Date();
      await ps.save();
    }
  }
}

/**
 * After bulk partner_service writes (admin import, deletes, etc.), rebuild partner_category
 * from active partner_service rows. Preserves per-category is_active when possible.
 */
async function rebuildPartnerCategoriesFromPartnerServices(partnerOid) {
  const partnerId = toOid(partnerOid);
  const rows = await PartnerService.find({
    partner_id: partnerId,
    deleted_at: null,
  })
    .select('category_id service_id')
    .lean();

  const byCat = new Map();
  for (const r of rows) {
    if (!r.category_id || !r.service_id) continue;
    const k = String(r.category_id);
    if (!byCat.has(k)) byCat.set(k, new Set());
    byCat.get(k).add(String(r.service_id));
  }

  const prev = await PartnerCategory.find({ partner_id: partnerId, deleted_at: null }).lean();
  const isActiveByCat = new Map(prev.map((p) => [String(p.category_id), p.is_active]));

  await PartnerCategory.updateMany(
    { partner_id: partnerId, deleted_at: null },
    { $set: { deleted_at: new Date(), updated_at: new Date() } }
  );

  const toInsert = [];
  for (const [catStr, idSet] of byCat) {
    toInsert.push({
      partner_id: partnerId,
      category_id: toOid(catStr),
      services: [...idSet].map((id) => toOid(id)),
      is_active: isActiveByCat.has(catStr) ? isActiveByCat.get(catStr) : true,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
  }
  if (toInsert.length > 0) {
    await PartnerCategory.insertMany(toInsert);
  }
}

/**
 * @param {mongoose.Types.ObjectId} partnerId
 * @param {{ category_id: any, service_id: any }[]} entries
 */
async function mergeServicesIntoPartnerCategories(partnerId, entries) {
  for (const { category_id, service_id } of entries) {
    const catOid = toOid(category_id);
    const svcOid = toOid(service_id);
    if (!catOid || !svcOid) continue;
    await PartnerCategory.findOneAndUpdate(
      {
        partner_id: partnerId,
        category_id: catOid,
        deleted_at: null,
      },
      {
        $set: { updated_at: new Date() },
        $setOnInsert: {
          partner_id: partnerId,
          category_id: catOid,
          is_active: true,
          created_at: new Date(),
          deleted_at: null,
          services: [],
        },
        $addToSet: { services: svcOid },
      },
      { upsert: true, new: true }
    );
  }
}

/**
 * Partner signup: one document per category with all service ids for that category.
 * @param {mongoose.Types.ObjectId} partnerId
 * @param {{ category_id: any, service_id: any }[]} normalizedRows from normalizePartnerServices
 */
async function replacePartnerCategoriesFromSignupRows(partnerId, normalizedRows) {
  const byCat = new Map();
  for (const r of normalizedRows) {
    if (!r.category_id || !r.service_id) continue;
    const c = String(r.category_id);
    if (!byCat.has(c)) byCat.set(c, new Set());
    byCat.get(c).add(String(r.service_id));
  }
  const docs = [];
  for (const [catStr, set] of byCat) {
    docs.push({
      partner_id: partnerId,
      category_id: toOid(catStr),
      services: [...set].map((id) => toOid(id)),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
  }
  if (docs.length > 0) {
    await PartnerCategory.insertMany(docs);
  }
  await syncPartnerServicesFromPartnerCategories(partnerId);
}

module.exports = {
  syncPartnerServicesFromPartnerCategories,
  rebuildPartnerCategoriesFromPartnerServices,
  mergeServicesIntoPartnerCategories,
  replacePartnerCategoriesFromSignupRows,
  toOid,
};
