const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeFranchiseName = (name) => String(name ?? '').trim();

/** Case-insensitive global franchise name uniqueness (non-deleted rows only). */
const franchiseNameExistsQuery = (trimmedName, excludeId = null) => {
    const query = {
        deleted_at: null,
        name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
    };
    if (excludeId) {
        query._id = { $ne: excludeId };
    }
    return query;
};

const findConflictingFranchiseName = async (Franchise, name, excludeId = null) => {
    const trimmedName = normalizeFranchiseName(name);
    if (!trimmedName) {
        return null;
    }
    return Franchise.findOne(franchiseNameExistsQuery(trimmedName, excludeId));
};

module.exports = {
    normalizeFranchiseName,
    franchiseNameExistsQuery,
    findConflictingFranchiseName,
};
