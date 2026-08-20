const Franchise = require('../models/franchise');
const {
    findConflictingFranchiseName,
    normalizeFranchiseName,
} = require('../utils/franchise_name_uniqueness');

const FRANCHISE_NAME_CONFLICT_MESSAGE = 'Franchise name already exists.';

/** Normalize city_id to an array (accepts a single id string for backward compatibility). */
const normalizeCityIdField = (val) => {
    if (val === undefined || val === null || val === '') return val;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return trimmed;
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed;
            } catch (_) {
                /* fall through */
            }
        }
        if (trimmed.includes(',')) {
            return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return [trimmed];
    }
    return [val];
};

const ensureFranchiseNameUniqueMiddleware = async (req, res, next) => {
    try {
        const trimmedName = normalizeFranchiseName(req.body.name);
        if (!trimmedName) {
            return next();
        }
        const existing = await findConflictingFranchiseName(Franchise, trimmedName);
        if (existing) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: FRANCHISE_NAME_CONFLICT_MESSAGE,
            });
        }
        return next();
    } catch (error) {
        console.error('ensureFranchiseNameUniqueMiddleware', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const ensureFranchiseNameUniqueOnUpdateMiddleware = async (req, res, next) => {
    if (req.body.name === undefined) {
        return next();
    }
    try {
        const trimmedName = normalizeFranchiseName(req.body.name);
        if (!trimmedName) {
            return next();
        }
        const existing = await findConflictingFranchiseName(
            Franchise,
            trimmedName,
            req.params.id
        );
        if (existing) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: FRANCHISE_NAME_CONFLICT_MESSAGE,
            });
        }
        return next();
    } catch (error) {
        console.error('ensureFranchiseNameUniqueOnUpdateMiddleware', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const createFranchiseMiddleware = (req, res, next) => {
    const body = req.body;
    if (body.city_id !== undefined) {
        body.city_id = normalizeCityIdField(body.city_id);
    }
    const {
        name,
        state_id,
        city_id,
        is_active,
        area_id,
    } = body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Franchise name is required.',
        });
    }
    if (!state_id || state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State is required.',
        });
    }
    if (!city_id || !Array.isArray(city_id) || city_id.length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City is required.',
        });
    }
    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.',
        });
    }
    if (area_id !== undefined && area_id !== null && !Array.isArray(area_id)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Area must be an array.',
        });
    }
    const { services, categories } = body;
    if (services !== undefined && services !== null && !Array.isArray(services)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Services must be an array.',
        });
    }
    if (categories !== undefined && categories !== null && !Array.isArray(categories)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Categories must be an array.',
        });
    }
    next();
};

const updateFranchiseMiddleware = (req, res, next) => {
    const body = req.body;
    if (body.city_id !== undefined) {
        body.city_id = normalizeCityIdField(body.city_id);
    }
    const { name, state_id, city_id, contact, area_id } = body;

    if (name !== undefined && name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Franchise name is required.',
        });
    }
    if (state_id !== undefined && state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State is required.',
        });
    }
    if (city_id !== undefined) {
        if (!Array.isArray(city_id) || city_id.length === 0) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'City is required.',
            });
        }
    }
    if (contact !== undefined && String(contact).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Contact is required.',
        });
    }
    if (area_id !== undefined && area_id !== null && !Array.isArray(area_id)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Area must be an array.',
        });
    }
    const { services, categories } = body;
    if (services !== undefined && services !== null && !Array.isArray(services)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Services must be an array.',
        });
    }
    if (categories !== undefined && categories !== null && !Array.isArray(categories)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Categories must be an array.',
        });
    }
    next();
};

module.exports = {
    createFranchiseMiddleware,
    updateFranchiseMiddleware,
    ensureFranchiseNameUniqueMiddleware,
    ensureFranchiseNameUniqueOnUpdateMiddleware,
};
