const express = require('express');
const awsServerlessExpress = require('aws-serverless-express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db'); // Database connection
const compression = require('compression'); // Compress responses
const path = require('path');
const http = require('http');

const authRoutes = require('./routes/auth_routes');
const userRoutes = require('./routes/user_routes');
const otpRoutes = require('./routes/otp_routes');
const countRoutes = require('./routes/count_routes');
const stateRoutes = require('./routes/state_routes');
const cityRoutes = require('./routes/city_routes');
const areaRoutes = require('./routes/area_routes');
const franchiseRoutes = require('./routes/franchise_routes');
const franchiseCategoryRoutes = require('./routes/franchise_category_routes');
const franchiseServiceManagementRoutes = require('./routes/franchise_service_management_routes');
const subscriptionPlanRoutes = require('./routes/subscription_plan_routes');
const offerRoutes = require('./routes/offer_routes');
const partnerSubscriptionRoutes = require('./routes/partner_subscription_routes');
const categoryRoutes = require('./routes/category_routes');
const serviceRoutes = require('./routes/service_routes');
const partnerServiceRoutes = require('./routes/partner_service_routes');
const partnerCategoryRoutes = require('./routes/partner_category_routes');
const partnerDocumentRoutes = require('./routes/partner_document_routes');
const documentRoutes = require('./routes/document_routes');
const documentUploadRoutes = require('./routes/document_upload_routes');
const bankAccountRoutes = require('./routes/partner_bank_account_routes');
const orderRoutes = require('./routes/order_routes');
const orderAdditionalChargeRoutes = require('./routes/order_additional_charge_routes');
const orderPaymentRoutes = require('./routes/order_payment_routes');
const quoteRoutes = require('./routes/quote_routes');
const orderService = require('./routes/order_service_routes');
const addressRoutes = require('./routes/address_routes');
const taxRoutes = require('./routes/tax_routes');
const ticketRoutes = require('./routes/ticket_routes');
const disputeRoutes = require('./routes/dispute_routes');
const notificationTestRoutes = require('./routes/notification_test_routes');
const razorpayRoutes = require('./routes/razorpay_routes');
const notificationSettingsRoutes = require('./routes/notification_settings_routes');
const dashboardRoutes = require('./routes/dashboard_routes');
const exportRoutes = require('./routes/export_routes');
const userHomeCountsRoutes = require('./routes/user_home_counts_routes');
const quoteSettingsRoutes = require('./routes/quote_settings_routes');
const contentManagementRoutes = require('./routes/content_management_routes');
const expenseCategoryManagementRoutes = require('./routes/expense_category_management_routes');
const expenseManagementRoutes = require('./routes/expense_management_routes');
const partnerPayoutRoutes = require('./routes/partner_payout_routes');
const refundRoutes = require('./routes/refund_routes');
const partnerPostRoutes = require('./routes/partner_post_routes');
const partnersRoutes = require('./routes/partners_routes');
const appointmentRoutes = require('./routes/appointment_routes');
const { notificationRoutes } = require('./src/modules/notifications');
const mobileRoutes = require('./routes/mobile');
const { publicImageUrlsResponseMiddleware } = require('./middleware/public_image_urls_response_middleware');
const { logPublicImageUrlConfig } = require('./helper/publicImageUrl');

// Load environment variables
dotenv.config();
logPublicImageUrlConfig();

// Connect to the database
connectDB();
// let isDbConnected = false;

// const connectDBOnce = async () => {
//   if (isDbConnected) return;

//   try {
//     await connectDB();
//     isDbConnected = true;
//     console.log("✅ MongoDB connected");
//   } catch (err) {
//     console.error("❌ MongoDB error:", err);
//   }
// };

// Initialize Express app
const app = express();

// Razorpay webhook must verify HMAC against the raw body (before express.json parses it).
const { handleRazorpayWebhook } = require('./controllers/razorpay_controller');
app.post(
    '/api/razorpay/razorpayWebhook',
    express.raw({ type: 'application/json' }),
    handleRazorpayWebhook
);

// Middleware
// app.use(cors()); // Enable CORS
// app.use(cors({
//   exposedHeaders: ['Content-Disposition']
// }));
app.use(express.json({ limit: '10mb' })); // Limit request body size for security
app.use(publicImageUrlsResponseMiddleware);
// app.use(compression()); // Compress response bodies for better performance

// Serve static files from the "uploads" directory
// if (process.env.NODE_ENV !== 'production') {
//   app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
//   app.use(cors({
//     exposedHeaders: ['Content-Disposition']
//   }));
 
// }

// Behind API Gateway / load balancers (AWS Lambda uses X-Forwarded-For).
app.set('trust proxy', true);
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Encoding'],
  exposedHeaders: ['Content-Disposition']
}));
app.options('*', cors());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api', countRoutes);
app.use('/api/state', stateRoutes);
app.use('/api/city', cityRoutes);
app.use('/api/area', areaRoutes);
app.use('/api/franchise', franchiseRoutes);
app.use('/api/franchise-category', franchiseCategoryRoutes);
app.use('/api/franchise-service', franchiseServiceManagementRoutes);
app.use('/api/subscription-plan', subscriptionPlanRoutes);
app.use('/api/offer', offerRoutes);
app.use('/api/partner-subscription', partnerSubscriptionRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/partner_service', partnerServiceRoutes);
app.use('/api/partner_category', partnerCategoryRoutes);
app.use('/api/partner_document', partnerDocumentRoutes);
app.use('/api/document', documentRoutes);
app.use('/api/document_upload', documentUploadRoutes);
app.use('/api/bank_account', bankAccountRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/order-additional-charges', orderAdditionalChargeRoutes);
app.use('/api/order-payments', orderPaymentRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/order_service', orderService);
app.use('/api/address', addressRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/dispute', disputeRoutes);
app.use('/api/notification_settings', notificationSettingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/notification', notificationTestRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/user_home_counts', userHomeCountsRoutes);
app.use('/api/quote_settings', quoteSettingsRoutes);
app.use('/api/content-management', contentManagementRoutes);
app.use('/api/expense-category-management', expenseCategoryManagementRoutes);
app.use('/api/expense-management', expenseManagementRoutes);
app.use('/api/partner_payout', partnerPayoutRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/partner-post', partnerPostRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/appointment', appointmentRoutes);

// Chat REST and Socket.IO run on the separate Chat Service (VPS). Lambda provisions via HTTP only.

app.use('/api/mobile', mobileRoutes);

// app.use('/login', loginRoute);

// Must be before the dev `app.get('*')` catch-all so /health returns JSON
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Serve static frontend files (for production)
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', '/html/success.html'))
  );
}

// Global Error Handler (optional)
const { formatUploadErrorResponse } = require('./utils/multer_error_handler');
app.use((err, req, res, next) => {
  console.error(err.stack);
  const uploadError = formatUploadErrorResponse(err);
  if (uploadError) {
    return res.status(uploadError.status).json({
      success: false,
      status: uploadError.status,
      message: uploadError.message,
    });
  }
  res.status(500).json({
    success: false,
    status: 500,
    message: 'Internal server error.',
  });
});

// serves static files
app.use(express.static(path.join(__dirname, 'public')));

// Start the HTTP server for local / VM deploys. Lambda uses exports.handler only.
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isLambda) {
  const PORT = process.env.PORT || 5001;
  http.createServer(app).listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Chat APIs: use help-pr-chat-service (CHAT_SERVICE_BASE_URL).');
  }).on('error', (err) => {
    console.error('HTTP server failed to start:', err.message);
  });
} else {
  console.log('AWS Lambda: HTTP server not started (using exports.handler).');
}

const server = awsServerlessExpress.createServer(app);
// exports.handler = (event, context) => {
//   return awsServerlessExpress.proxy(server, event, context, 'CALLBACK', (err, response) => {
//     if (!err) {
//       response.headers = {
//         ...response.headers,
//         "Access-Control-Allow-Origin": "*",
//         "Access-Control-Allow-Methods": "OPTIONS, GET, POST, PUT, DELETE",
//         "Access-Control-Allow-Headers": "Content-Type, Authorization,Accept-Encoding",
//         "Access-Control-Expose-Headers": "Content-Disposition"
//       };
//       if (response.headers["Content-Type"] === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
//         response.isBase64Encoded = true;
//       }
//     }
//     context.succeed(response);
//   });
// };
// exports.handler = async (event, context) => {
//   return await awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
// };
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    await connectDB();
  } catch (err) {
    console.error('Lambda connectDB failed:', err);
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        status: 503,
        message: 'Database unavailable.',
      }),
    };
  }
  return awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
};

console.log("Server is running...");
//testing the git 12345678
//hellos