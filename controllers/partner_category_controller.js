const mongoose = require('mongoose');
const PartnerCategory = require('../models/partner_category');
const PartnerService = require('../models/partner_service');
const Category = require('../models/category');
const { applyPagination } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { validateObjectId } = require('../validator/form_validator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { rebuildPartnerCategoriesFromPartnerServices } = require('../services/partner_category_service');

const ensurePartnerCategoryRowsExist = async (partnerOid) => {
  const partnerId =
    partnerOid instanceof mongoose.Types.ObjectId ? partnerOid : new mongoose.Types.ObjectId(partnerOid);
  const [pc, ps] = await Promise.all([
    PartnerCategory.countDocuments({ partner_id: partnerId, deleted_at: null }),
    PartnerService.countDocuments({ partner_id: partnerId, deleted_at: null }),
  ]);
  if (pc === 0 && ps > 0) {
    await rebuildPartnerCategoriesFromPartnerServices(partnerId);
  }
};

// GET /api/partner_category/myCategories
const getMyCategories = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    await ensurePartnerCategoryRowsExist(partnerId);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const filter = { partner_id: partnerId, deleted_at: null };
    if (req.query.is_active !== undefined && req.query.is_active !== '') {
      filter.is_active = parseBoolean(req.query.is_active);
    }

    if (req.query.name) {
      const cats = await Category.find({
        name: { $regex: new RegExp(sanitizeInput(String(req.query.name)), 'i') },
        deleted_at: null,
      }).select('_id');
      if (cats.length === 0) {
        return res.status(200).json({
          success: true,
          status: 200,
          message: 'Partner categories fetched successfully.',
          totalItems: 0,
          totalPages: 0,
          currentPage: page,
          records: [],
        });
      }
      filter.category_id = { $in: cats.map((c) => c._id) };
    }

    const sort = { created_at: -1 };
    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerCategory,
      filter,
      page,
      limit,
      sort,
      {},
      [
        { path: 'category_id', select: 'name desc image_url is_active approval_status' },
        { path: 'services', select: 'name desc price tax image_url category_id is_active approval_status' },
      ]
    );

    const records = data.map((row) => ({
      _id: row._id,
      partner_id: row.partner_id,
      category_id: row.category_id?._id || row.category_id,
      category_name: row.category_id?.name || null,
      category_desc: row.category_id?.desc || null,
      category_image_url: row.category_id?.image_url || null,
      services: Array.isArray(row.services)
        ? row.services.map((s) =>
            s && typeof s === 'object' && s._id
              ? {
                  _id: s._id,
                  name: s.name,
                  desc: s.desc,
                  price: s.price,
                  tax: s.tax,
                  image_url: s.image_url,
                  category_id: s.category_id,
                }
              : s
          )
        : [],
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner categories fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records,
    });
  } catch (err) {
    console.error('getMyCategories error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// GET /api/partner_category/getAll?page=&limit=&partner_id=
const getAll = async (req, res) => {
  try {
    if (!req.query.partner_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'partner_id query parameter is required.',
      });
    }
    const pr = validateObjectId(req.query.partner_id, 'partner');
    if (!pr.valid) {
      return res.status(400).json({ success: false, status: 400, message: pr.message });
    }
    const partnerId = new mongoose.Types.ObjectId(req.query.partner_id);
    await ensurePartnerCategoryRowsExist(partnerId);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const filter = { partner_id: partnerId, deleted_at: null };
    if (req.query.is_active !== undefined && req.query.is_active !== '') {
      filter.is_active = parseBoolean(req.query.is_active);
    }
    if (req.query.name) {
      const cats = await Category.find({
        name: { $regex: new RegExp(sanitizeInput(String(req.query.name)), 'i') },
        deleted_at: null,
      }).select('_id');
      if (cats.length === 0) {
        return res.status(200).json({
          success: true,
          status: 200,
          message: 'Partner categories fetched successfully.',
          totalItems: 0,
          totalPages: 0,
          currentPage: page,
          records: [],
        });
      }
      filter.category_id = { $in: cats.map((c) => c._id) };
    }

    const sort = { created_at: -1 };
    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerCategory,
      filter,
      page,
      limit,
      sort,
      {},
      [
        { path: 'category_id', select: 'name desc image_url' },
        { path: 'services', select: 'name desc price image_url category_id' },
      ]
    );

    const records = data.map((row) => ({
      _id: row._id,
      partner_id: row.partner_id,
      category_id: row.category_id?._id || row.category_id,
      category_name: row.category_id?.name || null,
      services: Array.isArray(row.services)
        ? row.services.map((s) =>
            s && typeof s === 'object' && s._id
              ? { _id: s._id, name: s.name, desc: s.desc, price: s.price, image_url: s.image_url }
              : s
          )
        : [],
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner categories fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records,
    });
  } catch (err) {
    console.error('partner_category getAll error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = { getMyCategories, getAll };
