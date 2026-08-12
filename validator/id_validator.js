const mongoose = require("mongoose");

async function checkObjectIdExists(model, objectIds, type) {
    try {
        if (!Array.isArray(objectIds)) {
            objectIds = [objectIds];
        }
        const typeLabel = String(type || "")
            .trim()
            .replace(/_/g, " ");
        const capitalizedType = typeLabel
            ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
            : "ID";

        if (!objectIds.every(id => mongoose.Types.ObjectId.isValid(id))) {
            return { exists: false, message: `Invalid ${capitalizedType} ID format.` };
        }
        
        const count = await model.countDocuments({ _id: { $in: objectIds } });
        
        if (count !== objectIds.length) {
            return { exists: false, message: `One or more ${capitalizedType} IDs not found.` };
        }
        
        return { exists: true };
    } catch (error) {
        console.error('Error checking ObjectId:', error);
        return { exists: false, message: 'Database error' };
    }
}

module.exports = {checkObjectIdExists};
