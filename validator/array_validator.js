const isArray = (data) => {
    if (!Array.isArray(data) || data.length === 0) {
        return false
    }
    return true
};
module.exports = { isArray };