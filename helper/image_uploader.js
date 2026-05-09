const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { createDirectoryIfNotExist, isValidFileType } = require('../utils/fileUtils');
const { handleError } = require('../middleware/error_middleware');

const sanitizeFileName = (name = '') => {
    const normalized = String(name).trim().replace(/\s+/g, '_');
    return normalized.replace(/[^a-zA-Z0-9._-]/g, '');
};

const normalizeS3Key = (value = '') => {
    return String(value)
        .replace(/^https?:\/\/[^/]+\//i, '')
        .replace(/^\/+/, '')
        .trim();
};

const toBuffer = (value) => {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value !== "string") {
        throw new Error("Invalid file buffer received for upload.");
    }

    const dataUriMatch = value.match(/^data:.*;base64,(.+)$/);
    const base64Candidate = dataUriMatch ? dataUriMatch[1] : value.trim();
    const isLikelyBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(base64Candidate);
    if (!isLikelyBase64) {
        throw new Error("Invalid base64 string received for upload.");
    }
    return Buffer.from(base64Candidate, "base64");
};

// Function to upload image locally
const uploadImageToLocal = async (file, type, existingPath = null) => {
    try {
        const folderPath = path.join(process.env.LOCAL_IMAGE_DIR, type);
        createDirectoryIfNotExist(folderPath); // Ensure the directory exists

        if (!isValidFileType(file)) {
            throw new Error('Invalid file type');
        }

        // If an existingPath is provided, overwrite the existing file
        const safeOriginalName = sanitizeFileName(file.originalname);
        const fileName = existingPath ? path.basename(existingPath) : `${uuidv4()}_${safeOriginalName}`;
        const filePath = path.join(folderPath, fileName);

        await fs.promises.writeFile(filePath, toBuffer(file.buffer));
        return filePath;
    } catch (error) {
        handleError(error); // Handle error if any during file upload
    }
};

const uploadImageToS3 = async (file, type,isPublic, existingKey = null) => {

    let s3Client;

    if (process.env.NODE_ENV !== 'production'){
        s3Client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
    } else {
        s3Client = new S3Client();
    }
    const bucketName = process.env.AWS_S3_BUCKET;
    if (!bucketName) {
        throw new Error('S3 bucket name is not defined in environment variables.');
    }

    try {
        const folderName = `${type}`;
        const safeOriginalName = sanitizeFileName(file.originalname);
        const normalizedExistingKey = existingKey ? normalizeS3Key(existingKey) : null;
        const fileName = normalizedExistingKey || `${folderName}/${uuidv4()}_${safeOriginalName}`;
        const fileBuffer = toBuffer(file.buffer);

        const uploadParams = {
            Bucket: bucketName,
            Key: fileName,
            Body: fileBuffer,
            ContentType: file.mimetype,
            ContentLength: fileBuffer.length,
            // ACL: isPublic ? 'public-read' : 'private',
        };

        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);

        const imageUrl = `${fileName}`;
        return imageUrl;
    } catch (error) {
        console.error('Error uploading image to s3:', error);
        throw new Error('Error uploading image to S3');
    }
}

// Centralized function to handle image upload (either local or S3)
const handleImageUpload = async (file, type, isPublic, existingKey = null) => {
    if (process.env.NODE_ENV === 'production') {
        return await uploadImageToS3(file, type, isPublic, existingKey); // Upload to S3 in production
    } else {
        return await uploadImageToLocal(file, type, existingKey); // Upload to local storage in development
    }
};

module.exports = { handleImageUpload };
