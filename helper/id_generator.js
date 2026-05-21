const User = require('../models/user');
const PartnerDocument = require('../models/partner_document');
const Category = require('../models/category');
const Service = require('../models/service');
const Order = require('../models/order');
const Quote = require('../models/quote');
const Ticket = require('../models/ticket');

const extractNumber = (str) => {
    const match = str.match(/\d+/); // Match one or more digits
    return match ? parseInt(match[0], 10) : null; // Convert to a number
};

const getNewRecordId = async (type) => {
    let records = [];
    if (type === 0) {
        records = await User.find().sort({ _id: -1 });
    } else {
        records = await User.find({ type: type }).sort({ _id: -1 });
    }
    if (records.length > 0) {
        const lastRecord = records[0];
        const registration_id = lastRecord.registration_id;
        const result = extractNumber(registration_id);
        const incId = result + 1;
        return incId;
    } else {
        return 1001;
    }
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

    let records = await User.find({type:2, verification_status: 2 }).sort({ _id: -1 });

    if (records.length > 0) {
        const lastRecord = records[0];
        const registration_id = lastRecord.verification_id;
        const result = extractNumber(registration_id);
        const incId = result + 1;
        return 'V' + incId;
    } else {
        return 'V1001';
    }
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
    getQuoteSequenceId,
};