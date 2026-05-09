const mongoose = require("mongoose");
const PartnerBankAccount = require('../models/partner_bank_account');
const { validationResult } = require('express-validator');

const { applyPagination } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { getNewId } = require('../helper/id_generator');
const { validateObjectId } = require('../validator/form_validator');


const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filter = {
      deleted_at: null,
    };
    if (req.query.account_number) {
      filter.account_number = { $regex: new RegExp(req.query.account_number, "i") };
    }
    if (req.query.ifsc_code) {
      filter.ifsc_code = { $regex: new RegExp(req.query.ifsc_code, "i") };
    }
    if (req.query.branch_name) {
      filter.branch_name = { $regex: new RegExp(req.query.branch_name, "i") };
    }
    if (req.query.partner_id) {
      const validation = validateObjectId(req.query.partner_id, 'partner')
      if (validation.valid) {
        filter.partner_id = new mongoose.Types.ObjectId(req.query.partner_id);
      } else {
        return res.status(400).json({
          success: false,
          status: 400,
          message: validation.message,
        });
      }
    }
    const sort = { created_at: -1 };

    const projection = { password: 0, auth_token: 0 };
    const { data: bankAccounts, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerBankAccount,
      filter,
      page,
      limit,
      sort,
      projection,
    );
    const populatedBankAccounts = await PartnerBankAccount.populate(bankAccounts, {
      path: "partner_id",
    });
    const processedBankAccounts = populatedBankAccounts.map(partnerBankAccount => {
      const { partner_id, ...rest } = partnerBankAccount;
      return {
        ...rest,
        partner_id: partnerBankAccount.partner_id._id,
        partner_name: partnerBankAccount.partner_id.name,
      };
    })
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedBankAccounts,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      partner_id,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      is_primary,
      branch_name,
    } = req.body;
    const existingAccount = await PartnerBankAccount.findOne({
      account_number,
      deleted_at: null
    });
    if (existingAccount) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Account already exists.',
      });
    }
    const newAccount = new PartnerBankAccount({
      partner_id,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      is_primary,
      branch_name,
    });
    const savedAccount = await newAccount.save();

    if(is_primary === true){
      const existingPrimaryAccount = await PartnerBankAccount.findOne({
        partner_id:partner_id,
        is_primary: true,
        deleted_at: null
      });
      if (existingPrimaryAccount) {
        existingPrimaryAccount.is_primary = false;
        await existingPrimaryAccount.save()
      }
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account created successfully.',
    });
  } catch (error) {
    console.error('Error creating PartnerBankAccount:', error.message);
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
    const partnerBankAccount = await PartnerBankAccount.findById(id);

    if (!partnerBankAccount) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Bank account not found'
      });
    }


    Object.keys(updateData).forEach((key) => {
      partnerBankAccount[key] = updateData[key];
    });

    const updatedAccount = await partnerBankAccount.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account updated successfully',
      record: updatedAccount,
    });
  } catch (error) {
    console.error('Error updating PartnerBankAccount:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const changePrimaryAccount = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const { partner_id } = req.body;

  try {

    const partnerBankAccount = await PartnerBankAccount.findById(id);

    const oldPrimaryBankAccount = await PartnerBankAccount.findOne({ partner_id: partner_id, is_primary: true });

    if (!partnerBankAccount) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }
    if(oldPrimaryBankAccount){
      oldPrimaryBankAccount.is_primary = false;
      await oldPrimaryBankAccount.save();  
    }
    partnerBankAccount.is_primary = !partnerBankAccount.is_primary;
    await partnerBankAccount.save();
    

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Primary account change successfully',
    });
  } catch (error) {
    console.error('Error updating PartnerService:', error);
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
    const partnerBankAccount = await PartnerBankAccount.findById(id).populate('partner_id').lean();

    if (!partnerBankAccount) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Bank account not found'
      });
    }
    const response = {
      ...partnerBankAccount,
      partner_id: partnerBankAccount.partner_id._id,
      partner_name: partnerBankAccount.partner_id.name,
    };
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account fetched successfully',
      record: response,
    });
  } catch (error) {
    console.error('Error fetching PartnerBankAccount:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const deleteAccount = async (req, res) => {
  const { id } = req.params;

  try {
    const partnerBankAccount = await PartnerBankAccount.findById(id);

    if (!partnerBankAccount) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Bank account not found'
      });
    }

    if (partnerBankAccount.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Bank account is already deleted'
      });
    }

    partnerBankAccount.deleted_at = new Date();

    await partnerBankAccount.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting PartnerBankAccount:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};


const getPartnerPrimaryAccount = async (partner_id) => {
  try {
    const bankAccount = await PartnerBankAccount.findOne({ partner_id: partner_id, is_primary: true, deleted_at: null });
    return bankAccount;
  } catch (err) {
    return null;
  }
};
module.exports = { getAll, create, update, getById, deleteAccount, getPartnerPrimaryAccount, changePrimaryAccount };
