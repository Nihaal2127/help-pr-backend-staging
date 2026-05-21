/**
 * Archived — was exported from helper/id_generator.js for financial_order.create only.
 * Order unique ids use getOrderId() on the active order module.
 */
const extractNumber = (str) => {
    const match = str.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
};

const getFinancialOrderUniqueId = async (FinancialOrderModel) => {
    const records = await FinancialOrderModel.find({ order_unique_id: { $regex: /^ORD-?\d+$/i } })
        .select('order_unique_id')
        .lean();

    let maxNum = 1000;
    for (const row of records) {
        const n = extractNumber(row.order_unique_id);
        if (n !== null && n > maxNum) {
            maxNum = n;
        }
    }
    return 'ORD-' + (maxNum + 1);
};

module.exports = { getFinancialOrderUniqueId };
