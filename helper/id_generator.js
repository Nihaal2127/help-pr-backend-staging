const User = require('../models/user');
const PartnerDocument = require('../models/partner_document');
const Category = require('../models/category');
const Service = require('../models/service');
const Order = require('../models/order');
const Quote = require('../models/quote');
const Ticket = require('../models/ticket');
const Appointment = require('../models/appointment');

const extractNumber = (str) => {
    if (str === undefined || str === null || str === '') return null;
    const match = String(str).match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
};

const USER_ID_PREFIX_BY_TYPE = {
    1: 'A',
    2: 'P',
    3: 'E',
    4: 'U',
    5: 'SA',
    6: 'ST',
};

const QUERY_MAX_TIME_MS = 8000;

const maxNumericSuffixFromRows = (rows, field, fallback = 1000) => {
    let maxNum = fallback;
    for (const row of rows) {
        const n = extractNumber(row?.[field]);
        if (n !== null && n > maxNum) {
            maxNum = n;
        }
    }
    return maxNum;
};

const maxNumericSuffixFromFind = async (filter, field) => {
    const rows = await User.find(filter)
        .select(field)
        .lean()
        .maxTimeMS(QUERY_MAX_TIME_MS);
    return maxNumericSuffixFromRows(rows, field);
};

const aggregateMaxNumericSuffix = async (match, field) => {
    const pipeline = [
        { $match: match },
        {
            $project: {
                num: {
                    $convert: {
                        input: {
                            $getField: {
                                field: 'match',
                                input: {
                                    $regexFind: {
                                        input: `$${field}`,
                                        regex: /\d+/,
                                    },
                                },
                            },
                        },
                        to: 'int',
                        onError: null,
                        onNull: null,
                    },
                },
            },
        },
        { $match: { num: { $ne: null } } },
        { $group: { _id: null, max: { $max: '$num' } } },
    ];

    const result = await User.aggregate(pipeline).option({ maxTimeMS: QUERY_MAX_TIME_MS });
    return result[0]?.max ?? 1000;
};

const getNewRecordId = async (type) => {
    const resolveMax = async (match, field) => {
        try {
            return await aggregateMaxNumericSuffix(match, field);
        } catch (err) {
            console.error('getNewRecordId aggregation failed, using find fallback:', err.message);
            return await maxNumericSuffixFromFind(match, field);
        }
    };

    if (type === 0) {
        const maxNum = await resolveMax(
            { registration_id: { $type: 'string', $regex: /^R\d+/i } },
            'registration_id'
        );
        return maxNum + 1;
    }

    const prefix = USER_ID_PREFIX_BY_TYPE[type];
    if (!prefix) {
        const maxNum = await resolveMax(
            { registration_id: { $type: 'string', $regex: /^R\d+/i } },
            'registration_id'
        );
        return maxNum + 1;
    }

    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const maxNum = await resolveMax(
        {
            type,
            user_id: { $type: 'string', $regex: new RegExp(`^${escapedPrefix}\\d+`, 'i') },
        },
        'user_id'
    );
    return maxNum + 1;
};
const getNewId = async (type) => {
    const newId = await getNewRecordId(type);
    if (type === 1) {
        return 'A' + newId;
    } else if (type === 2) {
        return 'P' + newId;
    } else if (type === 3) {
        return 'E' + newId;
    } else if (type === 4) {
        return 'U' + newId;
    } else if (type === 5) {
        return 'SA' + newId;
    } else if (type === 6) {
        return 'ST' + newId;
    } else {
        return 'R' + newId;
    }

};
const getVerificationId = async () => {
    const match = {
        type: 2,
        verification_status: 2,
        verification_id: { $type: 'string', $regex: /^V\d+/i },
    };
    let maxNum = 1000;
    try {
        maxNum = await aggregateMaxNumericSuffix(match, 'verification_id');
    } catch (err) {
        console.error('getVerificationId aggregation failed, using find fallback:', err.message);
        maxNum = await maxNumericSuffixFromFind(match, 'verification_id');
    }
    return 'V' + (maxNum + 1);
};
const getCategoryId = async () => {

    let records = await Category.find().sort({ _id: -1 });

    if (records.length > 0) {
        const lastRecord = records[0];
        const category_id = lastRecord.category_id;
        const result = extractNumber(category_id);
        const incId = result + 1;
        return 'C' + incId;
    } else {
        return 'C1001';
    }
};
const getServiceId = async () => {
    let records = await Service.find().sort({ _id: -1 });
    if (records.length > 0) {
        const lastRecord = records[0];
        const service_id = lastRecord.service_id;
        const result = extractNumber(service_id);
        const incId = result + 1;
        return 'S' + incId;
    } else {
        return 'S1001';
    }
};
const getOrderId = async () => {
    let records = await Order.find().sort({ _id: -1 });
    if (records.length > 0) {
        const lastRecord = records[0];
        const unique_id = lastRecord.unique_id;
        const result = extractNumber(unique_id);
        const incId = result + 1;
        return 'O' + incId;
    } else {
        return 'O1001';
    }
};
const getOfferId = async () => {
    const Offer = require('../models/offer');
    const records = await Offer.find({ unique_id: { $regex: /^OFF\d+$/i } })
        .select('unique_id')
        .lean();

    let maxNum = 1000;
    for (const row of records) {
        const n = extractNumber(row.unique_id);
        if (n !== null && n > maxNum) {
            maxNum = n;
        }
    }
    return 'OFF' + (maxNum + 1);
};
const getTicketId = async () => {
    let records = await Ticket.find().sort({ _id: -1 });
    if (records.length > 0) {
        const lastRecord = records[0];
        const unique_id = lastRecord.unique_id;
        const result = extractNumber(unique_id);
        const incId = result + 1;
        return 'T' + incId;
    } else {
        return 'T1001';
    }
};

const getAppointmentId = async () => {
    const records = await Appointment.find({ unique_id: { $regex: /^AP\d+$/i } })
        .select('unique_id')
        .lean();

    let maxNum = 1000;
    for (const row of records) {
        const n = extractNumber(row.unique_id);
        if (n !== null && n > maxNum) {
            maxNum = n;
        }
    }
    return 'AP' + (maxNum + 1);
};

const getDisputeId = async () => {
    const Dispute = require('../models/dispute');
    const records = await Dispute.find({ unique_id: { $regex: /^D\d+$/i } })
        .select('unique_id')
        .lean();

    let maxNum = 1000;
    for (const row of records) {
        const n = extractNumber(row.unique_id);
        if (n !== null && n > maxNum) {
            maxNum = n;
        }
    }
    return 'D' + (maxNum + 1);
};

const getQuoteSequenceId = async () => {
    let records = await Quote.find().sort({ _id: -1 });
    if (records.length > 0) {
        const lastRecord = records[0];
        const seq = lastRecord.quote_sequence_id;
        const result = extractNumber(seq);
        if (result === null) {
            return 'Q1001';
        }
        const incId = result + 1;
        return 'Q' + incId;
    } else {
        return 'Q1001';
    }
};

module.exports = {
    getNewId,
    getVerificationId,
    getCategoryId,
    getServiceId,
    getOrderId,
    getOfferId,
    getTicketId,
    getAppointmentId,
    getDisputeId,
    getQuoteSequenceId,
};