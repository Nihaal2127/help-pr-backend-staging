const mongoose = require("mongoose");
async function checkObjectIdExists(model, objectIds,type) {
    try {
        if (!Array.isArray(objectIds)) {
            objectIds = [objectIds];
        }
        if (!objectIds.every(id => mongoose.Types.ObjectId.isValid(id))) {
            return { exists: false, message: `Invalid ${type}Ids format` };
        }
        
        const count = await model.countDocuments({ _id: { $in: objectIds } });
        
        if (count !== objectIds.length) {
            return { exists: false, message: `One or more  ${type}Ids not found.` };
        }
        
        return { exists: true };
    } catch (error) {
        console.error('Error checking ObjectId:', error);
        return { exists: false, message: 'Database error' };
    }
}

module.exports = {checkObjectIdExists};
