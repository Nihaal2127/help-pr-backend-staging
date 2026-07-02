const { handleImageUpload } = require('../helper/image_uploader');
const {
  getUploadType,
  isValidUploadType,
  isPrivateUploadType,
} = require('../enum/upload_type_enum');
const { toPublicImageUrl } = require('../helper/publicImageUrl');

const parseUploadType = (rawType) => {
  const type = parseInt(rawType, 10);
  if (!Number.isInteger(type) || !isValidUploadType(type)) {
    return null;
  }
  return type;
};

const uploadDocument = async (req, res) => {
    const type = parseUploadType(req.body.type);

    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'No file uploaded.'
        });
    }

    if (type === null) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid upload type. Use 1–7 (chat attachments: type 7).',
        });
    }

    try {
        const isPublic = !isPrivateUploadType(type);

        const image_urls = [];
        
        for (const file of files) {
            const imageUrl = await handleImageUpload(file, getUploadType(type), isPublic,null);
            image_urls.push(imageUrl);
        }
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'File uploaded successfully',
            records: image_urls.map(toPublicImageUrl),
        });

    } catch (error) {
        console.error('Error Upload document:', error);
        return res.status(500).json({ message: 'Error upload document' });
    }
};
const updateDocument = async (req, res) => {
    const type = parseUploadType(req.body.type);
    const update_file_urls = JSON.parse(req.body.update_file_urls);// req.body.update_file_urls;
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'No file uploaded.'
        });
    }

    if (type === null) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid upload type. Use 1–7 (chat attachments: type 7).',
        });
    }

    if (!update_file_urls || update_file_urls.length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'File url not provided'
        });
    }

    if (update_file_urls.length !== update_file_urls.length) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'File url and uploaded file count mismatch'
        });
    }

    try {
        const isPublic = !isPrivateUploadType(type);
        const image_urls = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const newURL = await handleImageUpload(file, getUploadType(type), isPublic, update_file_urls[i]);
            if (!update_file_urls || !update_file_urls[i]) {
                image_urls.push(newURL);
            }
        }
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'File uploaded successfully',
            records: image_urls.map(toPublicImageUrl),
        });

    } catch (error) {
        console.error('Error Upload document:', error);
        return res.status(500).json({ message: 'Error upload document' });
    }
};
module.exports = { uploadDocument, updateDocument }