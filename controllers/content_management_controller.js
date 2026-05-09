const mongoose = require("mongoose");
const ContentManagement = require("../models/content_management");

const MAX_PAGE_SIZE = 100;

const parsePagination = (query) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const create = async (req, res) => {
  try {
    const { title, description } = req.body;

    const existingRecord = await ContentManagement.findOne({
      title,
      deleted_at: null
    });

    if (existingRecord) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Title already exists."
      });
    }

    const record = new ContentManagement({
      title,
      description
    });

    const savedRecord = await record.save();

    return res.status(201).json({
      success: true,
      status: 201,
      message: "Content created successfully.",
      record: savedRecord
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const getAll = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = req.query.search ? String(req.query.search).trim() : "";
    const sortKeyRaw = req.query.sort_by || req.query.sort;
    const sortBy = sortKeyRaw ? String(sortKeyRaw).trim() : "created_at";
    const sortOrder = req.query.sort_order === "asc" ? 1 : -1;
    const allowedSortFields = {
      id: "_id",
      title: "title",
      created_at: "created_at",
      date: "created_at"
    };
    const sortField = allowedSortFields[sortBy] || "created_at";

    const filter = { deleted_at: null };
    if (search) {
      const escaped = escapeRegex(search);
      const or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } }
      ];
      if (/^[a-fA-F0-9]{24}$/.test(search) && mongoose.Types.ObjectId.isValid(search)) {
        or.push({ _id: new mongoose.Types.ObjectId(search) });
      }
      filter.$or = or;
    }

    const [records, totalItems] = await Promise.all([
      ContentManagement.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limit),
      ContentManagement.countDocuments(filter)
    ]);
    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Content list fetched successfully.",
      totalItems,
      totalPages,
      currentPage: page,
      records
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await ContentManagement.findOne({ _id: id, deleted_at: null });

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Content not found."
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Content fetched successfully.",
      record
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const record = await ContentManagement.findOne({ _id: id, deleted_at: null });

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Content not found."
      });
    }

    if (updateData.title) {
      const duplicateTitle = await ContentManagement.findOne({
        _id: { $ne: id },
        title: updateData.title,
        deleted_at: null
      });

      if (duplicateTitle) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: "Title already exists."
        });
      }
    }

    Object.keys(updateData).forEach((key) => {
      record[key] = updateData[key];
    });
    record.updated_at = new Date();

    const updatedRecord = await record.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Content updated successfully.",
      record: updatedRecord
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await ContentManagement.findOne({ _id: id, deleted_at: null });

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Content not found."
      });
    }

    record.deleted_at = new Date();
    record.updated_at = new Date();
    await record.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Content deleted successfully."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

module.exports = { create, getAll, getById, update, remove };
