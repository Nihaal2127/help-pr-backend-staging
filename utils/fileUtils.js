const fs = require('fs');
const path = require('path');

// Utility to check if a directory exists and create it if not
const createDirectoryIfNotExist = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Utility to get file extension
const getFileExtension = (fileName) => {
  return path.extname(fileName).toLowerCase();
};

// Utility to check if file type is valid (you can extend this based on your needs)
const isValidFileType = (file, allowedTypes = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']) => {
  const fileExtension = getFileExtension(file.originalname);
  return allowedTypes.includes(fileExtension);
};

module.exports = {
  createDirectoryIfNotExist,
  getFileExtension,
  isValidFileType,
};
