const mongoose = require('mongoose');
const Quote = require('../../../models/quote');
const { attachPartnerServiceToQuotes } = require('../../../utils/quote_partner_service');
const { formatQuoteRecords } = require('../../../enum/quote_status_enum');
const { QUOTE_MOBILE_DETAIL_POPULATE } = require('../../../utils/mobile_quote_constants');

const HOME_QUOTES_PER_STATUS_LIMIT = 10;

const listHomeQuotesByStatus = async (partnerId, status) => {
  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));

  return Quote.find({
    partner_id: partnerOid,
    deleted_at: null,
    status,
  })
    .sort({ updated_at: -1, created_at: -1 })
    .limit(HOME_QUOTES_PER_STATUS_LIMIT)
    .populate(QUOTE_MOBILE_DETAIL_POPULATE)
    .lean();
};

const loadPartnerHomeQuotes = async (partnerId) => {
  const [pendingRows, acceptedRows] = await Promise.all([
    listHomeQuotesByStatus(partnerId, 'pending'),
    listHomeQuotesByStatus(partnerId, 'accepted'),
  ]);

  const allRows = [...pendingRows, ...acceptedRows];
  if (allRows.length > 0) {
    await attachPartnerServiceToQuotes(allRows);
  }

  return {
    pending: formatQuoteRecords(pendingRows),
    accepted: formatQuoteRecords(acceptedRows),
  };
};

module.exports = {
  loadPartnerHomeQuotes,
  HOME_QUOTES_PER_STATUS_LIMIT,
};
