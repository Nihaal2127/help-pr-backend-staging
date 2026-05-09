const PartnerPaymentStatus = new Map([
  [1, 'Pending'],
  [2, 'Completed'],
  [3, 'Return'],
]);

const getPartnerPaymentStatus = (key) => PartnerPaymentStatus.get(key) || "";
const getPartnerPaymentStatusKey = (value) => {
  for (let [key, val] of PartnerPaymentStatus.entries()) {
    if (val === value) return key;
  }
  return null;
};
module.exports = {
  getPartnerPaymentStatus,
  getPartnerPaymentStatusKey,
}