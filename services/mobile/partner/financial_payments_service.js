const mongoose = require('mongoose');
const User = require('../../../models/user');
const { resolveListSearchRegex } = require('../../../utils/list_query_helpers');
const {
    listPartnerFinancialOrderPayments,
    getPartnerFinancialOrderPaymentById,
} = require('../../order_financial_payments_service');

const USER_TYPE_PARTNER = 2;

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const assertPartner = async (partnerId) => {
    if (!mongoose.Types.ObjectId.isValid(String(partnerId))) {
        return fail(401, 'Invalid token.');
    }

    const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
    const partner = await User.findOne({
        _id: partnerOid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    })
        .select('_id')
        .lean();

    if (!partner) {
        return fail(404, 'Partner not found.');
    }

    return { ok: true, partnerOid };
};

const listFinancialPayments = async (partnerId, query = {}) => {
    try {
        const partnerResult = await assertPartner(partnerId);
        if (!partnerResult.ok) {
            return partnerResult;
        }

        const searchRegex = resolveListSearchRegex({ query: query || {} });
        return listPartnerFinancialOrderPayments(partnerResult.partnerOid, query, searchRegex);
    } catch (err) {
        console.error('listFinancialPayments', err.message);
        return fail(500, 'Internal server error.');
    }
};

const getFinancialPaymentById = async (partnerId, orderId) => {
    try {
        const partnerResult = await assertPartner(partnerId);
        if (!partnerResult.ok) {
            return partnerResult;
        }

        return getPartnerFinancialOrderPaymentById(partnerResult.partnerOid, orderId);
    } catch (err) {
        console.error('getFinancialPaymentById', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listFinancialPayments,
    getFinancialPaymentById,
};
