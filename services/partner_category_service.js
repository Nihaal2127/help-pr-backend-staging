const mongoose = require('mongoose');
const PartnerCategory = require('../models/partner_category');
const PartnerService = require('../models/partner_service');
const Service = require('../models/service');
const { onPartnerCategoriesDeactivated } = require('./catalog_cascade_service');

const toOid = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
};

function coerceNumber(v, defaultVal = 0) {
  if (v === undefined || v === null || v === '') return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

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
 * Partner signup: one document per category with all service ids for that category,
 * plus one partner_service row per service with description, price, tax, payment_type, minimum_deposit.
 * Does not call syncPartnerServicesFromPartnerCategories (that would drop pricing fields).
 *
 * @param {mongoose.Types.ObjectId} partnerId
 * @param {object[]} normalizedRows from normalizePartnerServices
 */
async function replacePartnerCategoriesFromSignupRows(partnerId, normalizedRows) {
  const partnerOid = toOid(partnerId);
  const byCat = new Map();
  for (const r of normalizedRows) {
    if (!r.category_id || !r.service_id) continue;
    const c = String(r.category_id);
    const s = String(r.service_id);
    if (!byCat.has(c)) byCat.set(c, new Set());
    byCat.get(c).add(s);
  }

  const catActiveByCat = new Map();
  for (const r of normalizedRows) {
    if (!r.category_id) continue;
    const c = String(r.category_id);
    if (r.category_is_active !== undefined) {
      catActiveByCat.set(c, r.category_is_active !== false);
    }
  }

  const pcDocs = [];
  for (const [catStr, set] of byCat) {
    pcDocs.push({
      partner_id: partnerOid,
      category_id: toOid(catStr),
      services: [...set].map((id) => toOid(id)),
      is_active: catActiveByCat.has(catStr) ? catActiveByCat.get(catStr) : true,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
  }
  if (pcDocs.length > 0) {
    await PartnerCategory.insertMany(pcDocs);
  }

  const detailLastByService = new Map();
  for (const r of normalizedRows) {
    if (!r.category_id || !r.service_id) continue;
    detailLastByService.set(String(r.service_id), r);
  }

  const psRows = [];
  for (const [sidStr, r] of detailLastByService) {
    const catStr = String(r.category_id);
    psRows.push({
      partner_id: partnerOid,
      category_id: toOid(catStr),
      service_id: toOid(sidStr),
      description: r.description != null ? String(r.description) : '',
      price: coerceNumber(r.price, 0),
      payment_type: r.payment_type != null ? String(r.payment_type).trim() : '',
      tax: coerceNumber(r.tax, 0),
      minimum_deposit: coerceNumber(r.minimum_deposit, 0),
      is_active: r.is_active !== false,
      is_accept_request: true,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
  }
  if (psRows.length > 0) {
    await PartnerService.insertMany(psRows);
  }

  const inactiveCategoryIds = new Set();
  for (const r of normalizedRows) {
    if (r.category_id && r.category_is_active === false) {
      inactiveCategoryIds.add(String(r.category_id));
    }
  }
  for (const doc of pcDocs) {
    if (doc.is_active === false && doc.category_id) {
      inactiveCategoryIds.add(String(doc.category_id));
    }
  }
  if (inactiveCategoryIds.size > 0) {
    try {
      await onPartnerCategoriesDeactivated(partnerOid, [...inactiveCategoryIds]);
    } catch (cascadeErr) {
      console.error('partner catalog inactive category cascade failed:', cascadeErr.message);
    }
  }
}

/**
 * Partner update: soft-delete existing catalog rows, then write normalized rows (same as signup).
 * @param {mongoose.Types.ObjectId} partnerId
 * @param {object[]} normalizedRows from normalizePartnerServices
 */
async function replacePartnerCatalogFromNormalizedRows(partnerId, normalizedRows) {
  const partnerOid = toOid(partnerId);
  const now = new Date();
  await PartnerCategory.updateMany(
    { partner_id: partnerOid, deleted_at: null },
    { $set: { deleted_at: now, updated_at: now } }
  );
  await PartnerService.updateMany(
    { partner_id: partnerOid, deleted_at: null },
    { $set: { deleted_at: now, updated_at: now } }
  );
  if (normalizedRows.length > 0) {
    await replacePartnerCategoriesFromSignupRows(partnerOid, normalizedRows);
  }
}

/**
 * Partner mobile update: keep existing catalog rows and only add/update incoming rows.
 * Does not soft-delete previous partner categories/services.
 * @param {mongoose.Types.ObjectId} partnerId
 * @param {object[]} normalizedRows from normalizePartnerServices
 */
async function mergePartnerCatalogFromNormalizedRows(partnerId, normalizedRows) {
  const partnerOid = toOid(partnerId);
  if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) return;

  const byCat = new Map();
  const detailLastByService = new Map();

  for (const r of normalizedRows) {
    if (!r.category_id || !r.service_id) continue;
    const catStr = String(r.category_id);
    const sidStr = String(r.service_id);
    if (!byCat.has(catStr)) byCat.set(catStr, new Set());
    byCat.get(catStr).add(sidStr);
    detailLastByService.set(sidStr, r);
  }

  for (const [catStr, serviceSet] of byCat) {
    await PartnerCategory.findOneAndUpdate(
      {
        partner_id: partnerOid,
        category_id: toOid(catStr),
        deleted_at: null,
      },
      {
        $set: { updated_at: new Date() },
        $setOnInsert: {
          partner_id: partnerOid,
          category_id: toOid(catStr),
          is_active: true,
          created_at: new Date(),
          deleted_at: null,
        },
        $addToSet: { services: { $each: [...serviceSet].map((id) => toOid(id)) } },
      },
      { upsert: true, new: true }
    );
  }

  for (const [sidStr, r] of detailLastByService) {
    const svcOid = toOid(sidStr);
    const catOid = toOid(r.category_id);
    const updateFields = {
      category_id: catOid,
      description: r.description != null ? String(r.description) : '',
      price: coerceNumber(r.price, 0),
      payment_type: r.payment_type != null ? String(r.payment_type).trim() : '',
      tax: coerceNumber(r.tax, 0),
      minimum_deposit: coerceNumber(r.minimum_deposit, 0),
      is_active: r.is_active !== false,
      is_accept_request: true,
      updated_at: new Date(),
      deleted_at: null,
    };

    let ps = await PartnerService.findOne({
      partner_id: partnerOid,
      service_id: svcOid,
      deleted_at: null,
    });

    if (!ps) {
      ps = await PartnerService.findOne({
        partner_id: partnerOid,
        service_id: svcOid,
      }).sort({ updated_at: -1 });
    }

    if (!ps) {
      await PartnerService.create({
        partner_id: partnerOid,
        service_id: svcOid,
        ...updateFields,
        created_at: new Date(),
      });
    } else {
      Object.assign(ps, updateFields);
      await ps.save();
    }
  }
}

module.exports = {
  syncPartnerServicesFromPartnerCategories,
  rebuildPartnerCategoriesFromPartnerServices,
  mergeServicesIntoPartnerCategories,
  replacePartnerCategoriesFromSignupRows,
  replacePartnerCatalogFromNormalizedRows,
  mergePartnerCatalogFromNormalizedRows,
  toOid,
};
