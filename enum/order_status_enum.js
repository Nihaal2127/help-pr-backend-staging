const OrderStatus = new Map([
  [1, 'Pending'],
  [2, 'In-progress'],
  [3, 'Completed'],
  [4, 'Cancelled'],
]);

const getOrderStatus = (key) => OrderStatus.get(key) || "";
const getOrderStatusKey = (value) => {
  for (let [key, val] of OrderStatus.entries()) {
    if (val === value) return key;
  }
  return null;
};

module.exports = {
  getOrderStatus,
  getOrderStatusKey,
}