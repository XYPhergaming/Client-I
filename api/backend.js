// api/backend.js
const express = require('express');
const cors = require('./cors');
const firebaseConfig = require('./firebase');
const cloudinaryConfig = require('./cloudinary');
const script = require('./script'); // তোমার গোপন লজিক ইম্পোর্ট

const app = express();
app.use(express.json());
app.use(cors);

// GET /api/config - ফ্রন্টএন্ডকে প্রয়োজনীয় কনফিগ পাঠানো
app.get('/api/config', (req, res) => {
    res.json({
        firebase: firebaseConfig,
        cloudinary: cloudinaryConfig,
        recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || ''
    });
});

// GET /api/status - সার্ভার চেক
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/custom-logic - তোমার গোপন লজিক ব্যবহারের উদাহরণ
app.post('/api/custom-logic', script.handleCustomLogic);

// ভবিষ্যতে আরও এন্ডপয়েন্ট এখানে যোগ করবে

module.exports = app;
