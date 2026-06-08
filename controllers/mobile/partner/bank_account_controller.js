const { listPartnerBankAccounts } = require('../../../services/mobile/partner/bank_account_service');

const listHandler = async (req, res) => {
  try {
    const result = await listPartnerBankAccounts(req.user.id, { search: req.query.search });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      data: result.data.data,
    });
  } catch (error) {
    console.error('mobile partner bank accounts list', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listHandler,
};
