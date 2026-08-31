const verifier = require('./verifier');
const config = require('./config');

module.exports = {
    ...config,
    ...verifier,
};
