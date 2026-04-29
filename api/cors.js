// api/cors.js
module.exports = (req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS;

    // যদি ALLOWED_ORIGINS সেট করা না থাকে অথবা '*' হয়, তাহলে সবাইকে অনুমতি দাও
    if (!allowedOrigins || allowedOrigins === '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
        // একাধিক ডোমেইন কমা দিয়ে আলাদা করে দাও
        const origins = allowedOrigins.split(',').map(o => o.trim());
        const requestOrigin = req.headers.origin;

        // রিকোয়েস্টের Origin যদি অনুমোদিত তালিকায় থাকে, তাহলে সেই Origin-টি হেডারে বসিয়ে দাও
        if (origins.includes(requestOrigin)) {
            res.setHeader('Access-Control-Allow-Origin', requestOrigin);
            res.setHeader('Vary', 'Origin'); // ক্যাশিং-এর জন্য ভালো
        }
        // যদি না থাকে, তাহলে আমরা হয়তো কোনো Access-Control-Allow-Origin সেট করব না,
        // এতে ব্রাউজার রিকোয়েস্ট ব্লক করবে। (অথবা তুমি চাইলে '*' দিতে পারো)
    }

    // বাকি CORS হেডার
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
};
