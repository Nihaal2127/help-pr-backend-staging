const QuoteSettings = require('../models/quote_settings');
const { validationResult } = require('express-validator');

const SETTING_FIELDS = [
    'free_quotes_per_user',
    'no_of_quotes',
    'quotes_price',
];

const pickSettingFields = (body) => {
    const data = {};
    SETTING_FIELDS.forEach((field) => {
        if (body[field] !== undefined) {
            data[field] = body[field];
        }
    });
    return data;
};

const create = async (req, res) => {
    try {
        const existing = await QuoteSettings.findOne({});
        if (existing) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Quote settings already exist. Use update instead.',
                record: existing,
            });
        }

        const settingData = pickSettingFields(req.body);
        const newQuoteSettings = new QuoteSettings(settingData);
        const savedQuoteSettings = await newQuoteSettings.save();

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Quote settings created successfully.',
            record: savedQuoteSettings,
        });
    } catch (error) {
        console.error('Error creating quote settings:', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const update = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            status: 400,
            errors: errors.array(),
        });
    }

    const { id } = req.params;
    const updateData = pickSettingFields(req.body);

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'At least one quote setting field is required.',
        });
    }

    try {
        const quoteSettings = await QuoteSettings.findById(id);

        if (!quoteSettings) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'No record found.',
            });
        }

        Object.keys(updateData).forEach((key) => {
            quoteSettings[key] = updateData[key];
        });
        quoteSettings.updated_at = new Date();

        const updatedQuoteSettings = await quoteSettings.save();

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Quote settings updated successfully.',
            record: updatedQuoteSettings,
        });
    } catch (error) {
        console.error('Error updating quote settings:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const get = async (req, res) => {
    try {
        const quoteSettings = await QuoteSettings.findOne({});

        if (!quoteSettings) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'No record found.',
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Quote settings fetched successfully.',
            record: quoteSettings,
        });
    } catch (error) {
        console.error('Error fetching quote settings:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = { create, update, get };
