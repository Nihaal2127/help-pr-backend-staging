const express = require('express');
const awsServerlessExpress = require('aws-serverless-express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db'); // Database connection
const compression = require('compression'); // Compress responses
const path = require('path');
const { Server } = require('socket.io');
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
const partnerSubscriptionRoutes = require('./routes/partner_subscription_routes');
const categoryRoutes = require('./routes/category_routes');
const serviceRoutes = require('./routes/service_routes');
const partnerServiceRoutes = require('./routes/partner_service_routes');
const partnerDocumentRoutes = require('./routes/partner_document_routes');
const documentRoutes = require('./routes/document_routes');
const documentUploadRoutes = require('./routes/document_upload_routes');
const bankAccountRoutes = require('./routes/partner_bank_account_routes');
const orderRoutes = require('./routes/order_routes');
const quoteRoutes = require('./routes/quote_routes');
const orderService = require('./routes/order_service_routes');
const addressRoutes = require('./routes/address_routes');
const taxRoutes = require('./routes/tax_routes');
const ticketRoutes = require('./routes/ticket_routes');
const notificationTestRoutes = require('./routes/notification_test_routes');
const razorpayRoutes = require('./routes/razorpay_routes');
const notificationSettingsRoutes = require('./routes/notification_settings_routes');
const dashboardRoutes = require('./routes/dashboard_routes');
const exportRoutes = require('./routes/export_routes');
const userHomeCountsRoutes = require('./routes/user_home_counts_routes');
const contentManagementRoutes = require('./routes/content_management_routes');
const expenseCategoryManagementRoutes = require('./routes/expense_category_management_routes');
const expenseManagementRoutes = require('./routes/expense_management_routes');
const { chatRoutes, registerChatSocket } = require('./src/modules/chat');

// Load environment variables
dotenv.config();
 
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

// Middleware
// app.use(cors()); // Enable CORS
// app.use(cors({
//   exposedHeaders: ['Content-Disposition']
// }));
app.use(express.json({ limit: '10mb' })); // Limit request body size for security
// app.use(compression()); // Compress response bodies for better performance

// Serve static files from the "uploads" directory
// if (process.env.NODE_ENV !== 'production') {
//   app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
//   app.use(cors({
//     exposedHeaders: ['Content-Disposition']
//   }));
 
// }

//for ip 09-05-2025
app.set('trust proxy', 1);
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
app.use('/api/partner-subscription', partnerSubscriptionRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/partner_service', partnerServiceRoutes);
app.use('/api/partner_document', partnerDocumentRoutes);
app.use('/api/document', documentRoutes);
app.use('/api/document_upload', documentUploadRoutes);
app.use('/api/bank_account', bankAccountRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/order_service', orderService);
app.use('/api/address', addressRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/notification_settings', notificationSettingsRoutes);
app.use('/api/notification', notificationTestRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/user_home_counts', userHomeCountsRoutes);
app.use('/api/content-management', contentManagementRoutes);
app.use('/api/expense-category-management', expenseCategoryManagementRoutes);
app.use('/api/expense-management', expenseManagementRoutes);
app.use('/api/chat', chatRoutes);

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
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Server error', error: err.message });
});

// serves static files
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5001;
  //app.listen(PORT, () => {
    const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  registerChatSocket(io);

  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  }).on('error', (err) => {
    console.error('HTTP server failed to start:', err.message);
  });
} else {
  console.log(
    'NODE_ENV=production: local HTTP server not started (use NODE_ENV=development or unset for localhost).'
  );
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
  return await awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
};

console.log("Server is running...");
//testing the git 123456