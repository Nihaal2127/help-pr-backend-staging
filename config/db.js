const mongoose = require('mongoose');

let isConnected = false; // Track connection status globally

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000, // 10 seconds
    });

    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (error) {
    isConnected = false;
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
};

module.exports = connectDB;