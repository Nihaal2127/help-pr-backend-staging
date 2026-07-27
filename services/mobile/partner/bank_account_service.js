const PartnerBankAccount = require('../../../models/partner_bank_account');
const { assertActivePartner, assertVerifiedPartner } = require('../shared/partner_access_helpers');
const { fail, ok } = require('../../../utils/mobile_service_result');
const {
  formatBankAccountRecord,
  normalizeOnePartnerBankAccount,
  assertBankAccountNumberAvailable,
  clearOtherPrimaryBankAccounts,
  ensurePartnerHasPrimaryBankAccount,
} = require('./partner_bank_account_helpers');

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

const loadPartnerOwnedBankAccount = async (partnerOid, accountId) => {
  if (!accountId) {
    return fail(400, 'Invalid bank account id.');
  }

  const account = await PartnerBankAccount.findOne({
    _id: accountId,
    partner_id: partnerOid,
    deleted_at: null,
  });

  if (!account) {
    return fail(404, 'Bank account not found.');
  }

  return ok(200, { account });
};

const parseOptionalPrimaryFlag = (body) => {
  if (body.is_primary === undefined && body.primary_bank_account === undefined) {
    return undefined;
  }
  const raw = body.is_primary ?? body.primary_bank_account;
  if (raw === true || raw === false) return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
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

const createPartnerBankAccount = async (partnerId, body) => {
  try {
    const partnerResult = await assertVerifiedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const normalized = normalizeOnePartnerBankAccount(body);
    if (!normalized) {
      return fail(400, 'Invalid bank account payload.');
    }

    const existing = await PartnerBankAccount.findOne({
      partner_id: partnerOid,
      account_number: normalized.account_number,
      deleted_at: null,
    }).lean();
    if (existing) {
      return fail(409, 'Bank account with this account number already exists.');
    }

    const availability = await assertBankAccountNumberAvailable(
      partnerOid,
      normalized.account_number
    );
    if (!availability.ok) {
      return availability;
    }

    const hasAny = await PartnerBankAccount.exists({
      partner_id: partnerOid,
      deleted_at: null,
    });
    const isPrimary = normalized.is_primary === true || !hasAny;

    if (isPrimary) {
      await clearOtherPrimaryBankAccounts(partnerOid);
    }

    const now = new Date();
    const created = await PartnerBankAccount.create({
      partner_id: partnerOid,
      bank_name: normalized.bank_name,
      account_holder_name: normalized.account_holder_name,
      account_number: normalized.account_number,
      ifsc_code: normalized.ifsc_code,
      branch_name: normalized.branch_name,
      is_primary: isPrimary,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });

    return ok(200, {
      message: 'Bank account created successfully.',
      record: formatBankAccountRecord(created),
    });
  } catch (err) {
    console.error('createPartnerBankAccount', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updatePartnerBankAccount = async (partnerId, accountId, body) => {
  try {
    const partnerResult = await assertVerifiedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const owned = await loadPartnerOwnedBankAccount(partnerOid, accountId);
    if (!owned.ok) {
      return owned;
    }

    const account = owned.data.account;
    const updates = {};
    const now = new Date();

    if (body.bank_name !== undefined) {
      updates.bank_name = String(body.bank_name).trim();
    }
    if (body.branch_name !== undefined) {
      updates.branch_name = String(body.branch_name).trim();
    }
    if (body.account_holder_name !== undefined || body.account_name !== undefined) {
      updates.account_holder_name = String(
        body.account_holder_name ?? body.account_name
      ).trim();
    }
    if (body.ifsc_code !== undefined) {
      updates.ifsc_code = String(body.ifsc_code).trim().toUpperCase();
    }
    if (body.account_number !== undefined) {
      const nextAccountNumber = String(body.account_number).trim();
      if (nextAccountNumber !== account.account_number) {
        const duplicate = await PartnerBankAccount.findOne({
          partner_id: partnerOid,
          account_number: nextAccountNumber,
          deleted_at: null,
          _id: { $ne: account._id },
        }).lean();
        if (duplicate) {
          return fail(409, 'Bank account with this account number already exists.');
        }

        const availability = await assertBankAccountNumberAvailable(
          partnerOid,
          nextAccountNumber
        );
        if (!availability.ok) {
          return availability;
        }
        updates.account_number = nextAccountNumber;
      }
    }

    const primaryFlag = parseOptionalPrimaryFlag(body);
    if (primaryFlag === null) {
      return fail(400, 'is_primary must be true or false.');
    }
    if (primaryFlag === true) {
      await clearOtherPrimaryBankAccounts(partnerOid, account._id);
      updates.is_primary = true;
    } else if (primaryFlag === false) {
      updates.is_primary = false;
    }

    if (Object.keys(updates).length === 0) {
      return ok(200, {
        message: 'Bank account updated successfully.',
        record: formatBankAccountRecord(account),
      });
    }

    Object.assign(account, updates, { updated_at: now });
    await account.save();

    if (primaryFlag === false) {
      await ensurePartnerHasPrimaryBankAccount(partnerOid);
    }

    const refreshed = await PartnerBankAccount.findById(account._id).lean();

    return ok(200, {
      message: 'Bank account updated successfully.',
      record: formatBankAccountRecord(refreshed),
    });
  } catch (err) {
    console.error('updatePartnerBankAccount', err.message);
    return fail(500, 'Internal server error.');
  }
};

const setPartnerBankAccountPrimary = async (partnerId, accountId) => {
  try {
    const partnerResult = await assertVerifiedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const owned = await loadPartnerOwnedBankAccount(partnerOid, accountId);
    if (!owned.ok) {
      return owned;
    }

    const account = owned.data.account;
    await clearOtherPrimaryBankAccounts(partnerOid, account._id);
    account.is_primary = true;
    account.updated_at = new Date();
    await account.save();

    return ok(200, {
      message: 'Primary bank account updated successfully.',
      record: formatBankAccountRecord(account),
    });
  } catch (err) {
    console.error('setPartnerBankAccountPrimary', err.message);
    return fail(500, 'Internal server error.');
  }
};

const deletePartnerBankAccount = async (partnerId, accountId) => {
  try {
    const partnerResult = await assertVerifiedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const owned = await loadPartnerOwnedBankAccount(partnerOid, accountId);
    if (!owned.ok) {
      return owned;
    }

    const account = owned.data.account;
    const wasPrimary = account.is_primary === true;
    const now = new Date();

    account.deleted_at = now;
    account.updated_at = now;
    account.is_primary = false;
    await account.save();

    if (wasPrimary) {
      await ensurePartnerHasPrimaryBankAccount(partnerOid);
    }

    return ok(200, {
      message: 'Bank account deleted successfully.',
    });
  } catch (err) {
    console.error('deletePartnerBankAccount', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerBankAccounts,
  createPartnerBankAccount,
  updatePartnerBankAccount,
  setPartnerBankAccountPrimary,
  deletePartnerBankAccount,
};
