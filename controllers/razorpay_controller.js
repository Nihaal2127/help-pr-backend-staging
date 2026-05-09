const axios = require('axios');
const crypto = require('crypto');
const Order = require('../models/order');
const path = require('path');

const generatePaymentLink = async (name, email, contact, amount) => {
    try {
        const response = await axios.post(
            'https://api.razorpay.com/v1/payment_links',
            {
                amount: amount * 100,
                currency: 'INR',
                accept_partial: false,
                customer: {
                    name,
                    email,
                    contact
                },
                notify: {
                    sms: true,
                    email: true
                },
                reminder_enable: true,
                callback_url: `${process.env.BASE_URL}/api/razorpay/callback`,
                callback_method: 'get'
            },
            {
                auth: {
                    username: process.env.RAZORPAY_KEY_ID,
                    password: process.env.RAZORPAY_KEY_SECRET
                }
            }
        );
        return {
            success: true,
            payment_url: response.data.short_url,
            transaction_id: response.data.id
        };
    } catch (error) {
        console.error(error?.response?.data || error.message);
        return {
            success: false,
            error: 'Failed to create payment link'
        };
    }
}

const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');

    if (generatedSignature !== signature) {
        console.log('Signature mismatch');
        return res.status(400).send('Invalid signature');
    }

    const event = body.event;

    if (event === 'payment_link.paid') {
        const payment = body.payload.payment_link.entity;
        const paymentLinkId = payment.id;
        const order = await Order.findOne({ transaction_id: paymentLinkId });

        if (order) {
            order.is_paid = true;
            await order.save();
            console.log(`✅ Marked order ${order._id} as paid`);
        } else {
            console.log('⚠️ No matching order found for payment link ID:', paymentLinkId);
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Razorpay payment verified',
        });
    }

    return res.status(200).json({
        success: true,
        status: 200,
        message: 'Razorpay webhook received',
    });
}

const razorpayCallback = async (req, res) => {
    res.sendFile(path.join(__dirname, '../public/html/success.html'));
};

module.exports = { generatePaymentLink, handleRazorpayWebhook, razorpayCallback };