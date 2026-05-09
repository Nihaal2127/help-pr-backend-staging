const sanitizeInput = (input) => {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special regex characters
};

module.exports = {sanitizeInput}