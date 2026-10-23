const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

// Configure Cloudinary with your credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Set up the storage engine
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine folder and resource type based on file type
    let folder = 'vendira_products';
    let resource_type = 'auto'; // automatically detects if it's an image or video

    if (file.mimetype.includes('video')) {
      folder = 'vendira_videos';
      resource_type = 'video';
    }

    return {
      folder: folder,
      resource_type: resource_type,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'mp4', 'mov'],
    };
  },
});

const upload = multer({ storage: storage });

module.exports = upload;