const ResolveStatus = new Map([
  [1, 'Pending'],
  [2, 'Resolve'],
  [3, 'Unresolve'],
]);

const getResolveStatus = (key) => ResolveStatus.get(key) || "";
const getResolveStatusKey = (value) => {
  for (let [key, val] of ResolveStatus.entries()) {
    if (val === value) return key;
  }
  return null;
};

module.exports = {
  getResolveStatus,
  getResolveStatusKey,
}