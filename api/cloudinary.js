// api/cloudinary.js
// Cloudinary কনফিগ (ফ্রন্টএন্ডে পাঠানোর জন্য)
module.exports = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET
};