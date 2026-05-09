const OrderType = new Map([
  [1, 'Admin'],
  [2, 'App'],
]);

const getOrdeType = (key) => OrderType.get(key) || "";
const getOrdeTypeKey = (value) => {
  for (let [key, val] of OrderType.entries()) {
    if (val === value) return key;
  }
  return null;
};

module.exports = {
  getOrdeType,
  getOrdeTypeKey,
}