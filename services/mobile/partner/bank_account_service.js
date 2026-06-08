const mongoose = require('mongoose');
const PartnerBankAccount = require('../../../models/partner_bank_account');
const User = require('../../../models/user');

const USER_TYPE_PARTNER = 2;

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const formatBankAccountRecord = (doc) => {
  const row = doc && doc.toObject ? doc.toObject() : { ...doc };
  return {
    _id: row._id,
    partner_id: row.partner_id,
    bank_name: row.bank_name ?? '',
    account_holder_name: row.account_holder_name ?? '',
    account_number: row.account_number ?? '',
    ifsc_code: row.ifsc_code ?? '',
    branch_name: row.branch_name ?? '',
    is_primary: row.is_primary === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
};

const bankAccountMatchesSearch = (record, search) => {
  if (!search) return true;
  const term = String(search).trim().toLowerCase();
  if (!term) return true;

  const haystacks = [
    record.bank_name,
    record.branch_name,
    record.account_holder_name,
    record.account_number,
    record.ifsc_code,
  ];

  return haystacks.some((value) => String(value ?? '').toLowerCase().includes(term));
};

const listPartnerBankAccounts = async (partnerId, { search } = {}) => {
  try {
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

    const normalizedSearch =
      search !== undefined && search !== null ? String(search).trim() : '';

    const rows = await PartnerBankAccount.find({
      partner_id: partnerOid,
      deleted_at: null,
    })
      .sort({ is_primary: -1, created_at: -1 })
      .lean();

    const formatted = rows.map(formatBankAccountRecord);
    const data =
      normalizedSearch === ''
        ? formatted
        : formatted.filter((record) => bankAccountMatchesSearch(record, normalizedSearch));

    return ok(200, {
      message: 'Bank accounts fetched successfully.',
      data,
    });
  } catch (err) {
    console.error('listPartnerBankAccounts', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerBankAccounts,
};
