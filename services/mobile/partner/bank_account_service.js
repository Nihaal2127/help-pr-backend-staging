const PartnerBankAccount = require('../../../models/partner_bank_account');
const { assertActivePartner } = require('../shared/partner_access_helpers');
const { fail, ok } = require('../../../utils/mobile_service_result');

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
    const partnerResult = await assertActivePartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
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
