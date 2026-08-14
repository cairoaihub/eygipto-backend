const rateLimit=require('express-rate-limit');

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: "طلبات كثيرة جداً."
    }
});

const generateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        error: "تم تجاوز الحد المسموح للتوليد."
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50
});


module.exports={generalLimiter,generateLimiter,authLimiter};
