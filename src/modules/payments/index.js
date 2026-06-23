const razorpayService = require('./razorpay.service');
const webhookDispatcher = require('./webhook.dispatcher');
const orderOnlinePayment = require('./services/orderOnlinePayment.service');

module.exports = {
    ...razorpayService,
    ...webhookDispatcher,
    ...orderOnlinePayment,
};
