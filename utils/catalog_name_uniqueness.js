const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCatalogName = (name) => String(name ?? '').trim();

/** Case-insensitive global name uniqueness among non-deleted catalog rows. */
const globalCatalogNameExistsQuery = (trimmedName, excludeId = null) => {
    const query = {
        deleted_at: null,
        name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
    };
    if (excludeId) {
        query._id = { $ne: excludeId };
    }
    return query;
};

const categoryNameExistsQuery = (name, excludeId = null) =>
    globalCatalogNameExistsQuery(normalizeCatalogName(name), excludeId);

const serviceNameExistsQuery = (name, excludeId = null) =>
    globalCatalogNameExistsQuery(normalizeCatalogName(name), excludeId);

const findExistingCatalogNames = async (Model, names) => {
    const trimmed = [...new Set(names.map(normalizeCatalogName).filter(Boolean))];
    if (trimmed.length === 0) return [];
    return Model.find({
        deleted_at: null,
        $or: trimmed.map((n) => ({ name: new RegExp(`^${escapeRegExp(n)}$`, 'i') })),
    })
        .select('name')
        .lean();
};

const importFileDuplicateNamesMessage = (normalizedNames, label) => {
    const seen = new Set();
    for (const n of normalizedNames) {
        const key = n.toLowerCase();
        if (seen.has(key)) {
            return `Duplicate ${label} names in import file (case-insensitive).`;
        }
        seen.add(key);
    }
    return null;
};

module.exports = {
    normalizeCatalogName,
    categoryNameExistsQuery,
    serviceNameExistsQuery,
    findExistingCatalogNames,
    importFileDuplicateNamesMessage,
};
