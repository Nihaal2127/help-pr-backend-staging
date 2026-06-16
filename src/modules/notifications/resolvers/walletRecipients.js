const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

const resolveWalletRecipients = (ledgerEntry, options = {}) => {
  const { extraUserIds = [] } = options;
  const ids = new Set();

  addId(ids, ledgerEntry?.partner_id);
  extraUserIds.forEach((id) => addId(ids, id));

  return [...ids];
};

module.exports = {
  resolveWalletRecipients,
};
