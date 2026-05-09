const Document = require('../models/document');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { validationResult } = require('express-validator');

const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;
    const is_optional = req.query.is_optional !== undefined ? parseBoolean(req.query.is_optional) : null;
    const filter = {
      deleted_at: null,
      ...(req.query.is_active && { is_active: is_active }),
      ...(req.query.is_optional && { is_optional: is_optional }),
    };

    if (req.query.name) {
      filter.name = { $regex: new RegExp(req.query.name, "i") }; // Case-insensitive match
    }

    const sort = { created_at: -1 };

    const { data: documents, totalCount, totalPages, currentPage } = await applyPagination(
      Document,
      filter,
      page,
      limit,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document List list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: documents,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      name,
      is_optional,
      is_active
    } = req.body;

    const existingDocument = await Document.findOne({ name, deleted_at: null });

    if (existingDocument) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Document List name already exists.',
      });
    }
    const newDocument = new Document({
      name,
      is_optional,
      is_active,
    });

    const savedDocument = await newDocument.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Document List created successfully.',
      record: savedDocument,
    });
  } catch (error) {
    console.error('Error creating Document:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = req.body;

  try {

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (req.body.name) {
      const name = req.body.name
      const existingDocument = await Document.findOne({
        $or: [
          { name },
        ],
        deleted_at: null,
        _id: { $ne: id },
      });

      if (existingDocument) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'Document List name already exists.',
        });
      }
    }

    Object.keys(updateData).forEach((key) => {
      document[key] = updateData[key];
    });


    const updatedDocument = await document.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document List updated successfully',
      record: updatedDocument,
    });
  } catch (error) {
    console.error('Error updating Document:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getById = async (req, res) => {
  const { id } = req.params;

  try {
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'Document List fetched successfully',
      record: document,
    });
  } catch (error) {
    console.error('Error fetching Document:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteDocument = async (req, res) => {
  const { id } = req.params;

  try {

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (document.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Document is already deleted'
      });
    }


    document.deleted_at = new Date();


    await document.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Document:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getDropDown = async (req, res) => {

  try {

    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    const { data: documents, } = await applyDropDownFilter(
      Document,
      filter,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document list fetched successfully.',
      records: documents,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getDocumentList = async () => {
  try {
    const documents = await Document.find({ is_active: true, deleted_at: null });
    return documents;
  } catch (err) {
    return [];
  }
};
module.exports = { getAll, create, update, getById, deleteDocument, getDropDown,getDocumentList };