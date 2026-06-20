const razorpayService = require('./razorpay.service');
const webhookDispatcher = require('./webhook.dispatcher');

module.exports = {
    ...razorpayService,
    ...webhookDispatcher,
};
