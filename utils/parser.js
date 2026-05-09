const parseBoolean = (value) => {
    if (value === undefined) return false;
    return value === 'true';
};

module.exports = {parseBoolean};