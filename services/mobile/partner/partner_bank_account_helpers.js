const mongoose = require('mongoose');
const PartnerBankAccount = require('../../../models/partner_bank_account');
const { fail, okPass } = require('../../../utils/mobile_service_result');

const parseJsonIfString = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const toPartnerOid = (partnerId) => {
  if (partnerId instanceof mongoose.Types.ObjectId) return partnerId;
  return new mongoose.Types.ObjectId(String(partnerId));
};

const toAccountOid = (accountId) => {
  if (accountId instanceof mongoose.Types.ObjectId) return accountId;
  return new mongoose.Types.ObjectId(String(accountId));
};

const isTruthyPrimaryFlag = (value) =>
  value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true';

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

const normalizeOnePartnerBankAccount = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rawPrimary = parsed.is_primary ?? parsed.primary_bank_account ?? false;
  const normalizedPrimary =
    typeof rawPrimary === 'string' ? rawPrimary.trim().toLowerCase() === 'true' : rawPrimary === true;
  const accountNumber =
    parsed.account_number != null ? String(parsed.account_number).trim() : '';
  if (!accountNumber) return null;
  return {
    account_holder_name: String(parsed.account_holder_name ?? parsed.account_name ?? '').trim(),
    account_number: accountNumber,
    ifsc_code: String(parsed.ifsc_code ?? '').trim().toUpperCase(),
    bank_name: String(parsed.bank_name ?? '').trim(),
    branch_name: String(parsed.branch_name ?? '').trim(),
    is_primary: normalizedPrimary,
  };
};

const resolvePartnerBankInputFromBody = (body) => {
  const hasFlatBankFields =
    body.bank_name !== undefined ||
    body.branch_name !== undefined ||
    body.account_holder_name !== undefined ||
    body.account_name !== undefined ||
    body.account_number !== undefined ||
    body.ifsc_code !== undefined;

  let raw = body.bank_account;
  if (raw === undefined && hasFlatBankFields) {
    raw = {
      account_name: body.account_name,
      account_holder_name: body.account_holder_name,
      account_number: body.account_number,
      ifsc_code: body.ifsc_code,
      bank_name: body.bank_name,
      branch_name: body.branch_name,
      primary_bank_account: body.primary_bank_account,
      is_primary: body.is_primary,
    };
  }

  const parsed = parseJsonIfString(raw, raw);
  const isArrayPayload = Array.isArray(parsed);
  const accounts = [];

  if (isArrayPayload) {
    for (const item of parsed) {
      const row = normalizeOnePartnerBankAccount(item);
      if (row) accounts.push(row);
    }
  } else {
    const row = normalizeOnePartnerBankAccount(parsed);
    if (row) accounts.push(row);
  }

  return { accounts, isArrayPayload };
};

const normalizePartnerBankAccount = (payload) => {
  const { accounts } = resolvePartnerBankInputFromBody({ bank_account: payload });
  return accounts[0] ?? null;
};

const assertBankAccountNumberAvailable = async (partnerOid, accountNumber) => {
  const takenByOther = await PartnerBankAccount.findOne({
    account_number: accountNumber,
    deleted_at: null,
    partner_id: { $ne: partnerOid },
  }).lean();
  if (takenByOther) {
    return fail(409, 'Account number already exists.');
  }
  return okPass();
};

const applyPrimaryBankAccountFlags = (accounts) => {
  const rows = accounts.map((acc) => ({ ...acc, is_primary: acc.is_primary === true }));
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary);
  if (firstPrimaryIdx === -1 && rows.length > 0) {
    rows[0].is_primary = true;
    return rows;
  }
  return rows.map((r, i) => ({
    ...r,
    is_primary: i === firstPrimaryIdx,
  }));
};

const clearAllPrimaryBankAccounts = async (partnerOid) => {
  const normalizedPartnerOid = toPartnerOid(partnerOid);
  await PartnerBankAccount.updateMany(
    { partner_id: normalizedPartnerOid, deleted_at: null },
    { $set: { is_primary: false, updated_at: new Date() } }
  );
};

const clearOtherPrimaryBankAccounts = async (partnerOid, excludeAccountId = null) => {
  const normalizedPartnerOid = toPartnerOid(partnerOid);
  if (excludeAccountId == null) {
    await clearAllPrimaryBankAccounts(normalizedPartnerOid);
    return;
  }

  await PartnerBankAccount.updateMany(
    {
      partner_id: normalizedPartnerOid,
      deleted_at: null,
      _id: { $ne: toAccountOid(excludeAccountId) },
    },
    { $set: { is_primary: false, updated_at: new Date() } }
  );
};

const setPrimaryBankAccountForPartner = async (partnerOid, accountId) => {
  const normalizedPartnerOid = toPartnerOid(partnerOid);
  const normalizedAccountOid = toAccountOid(accountId);
  const now = new Date();

  await clearAllPrimaryBankAccounts(normalizedPartnerOid);

  const updated = await PartnerBankAccount.findOneAndUpdate(
    {
      _id: normalizedAccountOid,
      partner_id: normalizedPartnerOid,
      deleted_at: null,
    },
    { $set: { is_primary: true, updated_at: now } },
    { new: true }
  );

  return updated;
};

const reconcilePartnerBankAccountPrimaries = async (partnerOid) => {
  const normalizedPartnerOid = toPartnerOid(partnerOid);
  const accounts = await PartnerBankAccount.find({
    partner_id: normalizedPartnerOid,
    deleted_at: null,
  })
    .select('_id is_primary updated_at created_at')
    .lean();

  if (accounts.length === 0) return null;

  const primaries = accounts.filter((account) => isTruthyPrimaryFlag(account.is_primary));
  if (primaries.length === 1) {
    return primaries[0]._id;
  }

  const winner =
    primaries.length > 1
      ? primaries.sort(
          (a, b) =>
            new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        )[0]
      : accounts.sort(
          (a, b) =>
            new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        )[0];

  await clearAllPrimaryBankAccounts(normalizedPartnerOid);
  await PartnerBankAccount.updateOne(
    { _id: winner._id },
    { $set: { is_primary: true, updated_at: new Date() } }
  );

  return winner._id;
};

const ensurePartnerHasPrimaryBankAccount = async (partnerOid) => {
  const normalizedPartnerOid = toPartnerOid(partnerOid);
  const accounts = await PartnerBankAccount.find({
    partner_id: normalizedPartnerOid,
    deleted_at: null,
  })
    .select('_id is_primary updated_at created_at')
    .lean();

  if (accounts.length === 0) return;

  const primaries = accounts.filter((account) => isTruthyPrimaryFlag(account.is_primary));
  if (primaries.length === 1) {
    if (primaries[0].is_primary === true) return;
    await PartnerBankAccount.updateOne(
      { _id: primaries[0]._id },
      { $set: { is_primary: true, updated_at: new Date() } }
    );
    return;
  }

  if (primaries.length > 1) {
    await reconcilePartnerBankAccountPrimaries(normalizedPartnerOid);
    return;
  }

  const next = accounts.sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  )[0];

  await clearAllPrimaryBankAccounts(normalizedPartnerOid);
  await PartnerBankAccount.updateOne(
    { _id: next._id },
    { $set: { is_primary: true, updated_at: new Date() } }
  );
};

async function upsertPartnerBankAccountForPartner(partnerId, normalizedBankAccount) {
  if (!normalizedBankAccount) return okPass();
  const bankAccountNumber = String(normalizedBankAccount.account_number || '').trim();
  if (!bankAccountNumber) return okPass();

  const partnerOid = toPartnerOid(partnerId);

  const availability = await assertBankAccountNumberAvailable(partnerOid, bankAccountNumber);
  if (!availability.ok) return availability;

  let account = await PartnerBankAccount.findOne({
    partner_id: partnerOid,
    account_number: bankAccountNumber,
    deleted_at: null,
  });
  if (!account && normalizedBankAccount.is_primary === true) {
    account = await PartnerBankAccount.findOne({
      partner_id: partnerOid,
      deleted_at: null,
      is_primary: true,
    });
  }

  const fields = {
    bank_name: normalizedBankAccount.bank_name,
    account_holder_name: normalizedBankAccount.account_holder_name,
    account_number: bankAccountNumber,
    ifsc_code: normalizedBankAccount.ifsc_code,
    branch_name: normalizedBankAccount.branch_name,
    is_primary: normalizedBankAccount.is_primary === true,
    updated_at: new Date(),
  };

  if (normalizedBankAccount.is_primary === true) {
    if (account) {
      await clearOtherPrimaryBankAccounts(partnerOid, account._id);
    } else {
      await clearAllPrimaryBankAccounts(partnerOid);
    }
  }

  if (account) {
    Object.assign(account, fields);
    await account.save();
  } else {
    const hasAny = await PartnerBankAccount.exists({ partner_id: partnerOid, deleted_at: null });
    await PartnerBankAccount.create({
      partner_id: partnerOid,
      ...fields,
      is_primary: fields.is_primary || !hasAny,
      created_at: new Date(),
      deleted_at: null,
    });
  }
  return okPass();
}

async function replacePartnerBankAccountsForPartner(partnerId, normalizedAccounts) {
  if (!Array.isArray(normalizedAccounts) || normalizedAccounts.length === 0) {
    return okPass();
  }

  const partnerOid = toPartnerOid(partnerId);

  const seenNumbers = new Set();
  for (const acc of normalizedAccounts) {
    const bankAccountNumber = String(acc.account_number || '').trim();
    if (!bankAccountNumber) {
      return fail(400, 'Account number is required.');
    }
    if (seenNumbers.has(bankAccountNumber)) {
      return fail(400, 'Duplicate account number in bank accounts.');
    }
    seenNumbers.add(bankAccountNumber);
    const availability = await assertBankAccountNumberAvailable(partnerOid, bankAccountNumber);
    if (!availability.ok) return availability;
  }

  const rows = applyPrimaryBankAccountFlags(normalizedAccounts);
  const now = new Date();

  await PartnerBankAccount.updateMany(
    { partner_id: partnerOid, deleted_at: null },
    { $set: { deleted_at: now, updated_at: now } }
  );

  await PartnerBankAccount.insertMany(
    rows.map((acc) => ({
      partner_id: partnerOid,
      bank_name: acc.bank_name,
      account_holder_name: acc.account_holder_name,
      account_number: acc.account_number,
      ifsc_code: acc.ifsc_code,
      branch_name: acc.branch_name,
      is_primary: acc.is_primary === true,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }))
  );

  return okPass();
}

module.exports = {
  formatBankAccountRecord,
  normalizeOnePartnerBankAccount,
  normalizePartnerBankAccount,
  resolvePartnerBankInputFromBody,
  assertBankAccountNumberAvailable,
  applyPrimaryBankAccountFlags,
  clearAllPrimaryBankAccounts,
  clearOtherPrimaryBankAccounts,
  setPrimaryBankAccountForPartner,
  reconcilePartnerBankAccountPrimaries,
  ensurePartnerHasPrimaryBankAccount,
  upsertPartnerBankAccountForPartner,
  replacePartnerBankAccountsForPartner,
  toPartnerOid,
  toAccountOid,
  isTruthyPrimaryFlag,
};
