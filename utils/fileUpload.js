const multer = require("multer");

// Create a centralized Multer configuration
const upload = multer({
  
  storage: multer.memoryStorage(), // Store files in memory for processing
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
  fileFilter: (req, file, cb) => {
    console.log('File Type ',file.mimetype);
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg","application/pdf"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, JPG, PNG, and Pdf file are allowed"), false);
    }
    cb(null, true);
  },
});
const uploadImages = multer({
  
  storage: multer.memoryStorage(), // Store files in memory for processing
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, and JPG images are allowed"), false);
    }
    cb(null, true);
  },
});

const uploadPdf = multer({
  dest: '/tmp',
 limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["application/pdf"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only Pdf is allowed"), false);
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadPdf, uploadImages };