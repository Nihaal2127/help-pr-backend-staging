const mongoose = require("mongoose");
const createBankAccountMiddleware = (req, res, next) => {
  const {
    partner_id,
    bank_name,
    account_holder_name,
    account_number,
    ifsc_code,
    branch_name,
    
  } = req.body;
  if (!partner_id || partner_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Partner id is required.'
    });
  } else {
    if (!mongoose.Types.ObjectId.isValid(partner_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid partner id.",
      });
    }
  }
  if (!bank_name || bank_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Bank name id is required.'
    });
  }
  if (!account_holder_name || account_holder_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account holder name id is required.'
    });
  }
  if (!account_number || account_number.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account number id is required.'
    });
  }
  if (!ifsc_code || ifsc_code.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'IFSC code id is required.'
    });
  }
  if (!branch_name || branch_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Branch name id is required.'
    });
  }
  next();
};

const updateBankAccountMiddleware = (req, res, next) => {
  const {
    partner_id,
    bank_name,
    account_holder_name,
    account_number,
    ifsc_code,
    branch_name,
  } = req.body;
  console.log('Partner Id',partner_id);
  if (partner_id !== undefined && partner_id.trim() === '') {
    if (!mongoose.Types.ObjectId.isValid(partner_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid partner id.",
      });
    }
  }
  if (bank_name !== undefined && bank_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Bank name id is required.'
    });
  }
  if (account_holder_name !== undefined && account_holder_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account holder name id is required.'
    });
  }
  if (account_number !== undefined && account_number.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Account number id is required.'
    });
  }
  if (ifsc_code !== undefined && ifsc_code.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'IFSC code id is required.'
    });
  }
  if (branch_name !== undefined && branch_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Branch name id is required.'
    });
  }

  next();
};
module.exports = { createBankAccountMiddleware, updateBankAccountMiddleware };
