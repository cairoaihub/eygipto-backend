const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');

const {
    generalLimiter,
    generateLimiter,
    authLimiter
} = require('./middlewares/rateLimit');

const systemRoutes = require('./routes/system');
const userPricingRoutes = require('./routes/userPricing');
const generateRoutes = require('./routes/generate');
const makeWebhookRoutes = require('./routes/makeWebhook');
const tasksRoutes = require('./routes/tasks');
const paymentRoutes = require('./routes/payment');
const projectRoutes = require('./routes/projects');

const {
    cleanupUploadedFiles
} = require('./middlewares/uploadSecurity');

const app = express();

/* =========================================================
   SECURITY
========================================================= */

app.use(helmet());

/* =========================================================
   CORS
========================================================= */

const defaultAllowedOrigins = [
    'https://www.eygiptoai.online',
    'https://eygiptoai.online',
    'https://eygipto-frontend-2h2u-git-main-cairo2.vercel.app',
    'https://eygipto-frontend-2h2u-jcigofyem-cairo2.vercel.app'
];

const allowedCorsOrigins = (
    process.env.ALLOWED_CORS_ORIGINS ||
    process.env.ALLOWED_CORS_ORIGIN ||
    defaultAllowedOrigins.join(',')
)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: function (origin, callback) {
            // Allow server-to-server / tools that do not send Origin
            if (!origin) {
                return callback(null, true);
            }

            if (allowedCorsOrigins.includes(origin)) {
                return callback(null, true);
            }

            console.warn(`CORS blocked origin: ${origin}`);

            return callback(
                new Error(`CORS origin not allowed: ${origin}`)
            );
        },

        credentials: true,

        methods: [
            'GET',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'OPTIONS'
        ],

        allowedHeaders: [
            'Origin',
            'X-Requested-With',
            'Content-Type',
            'Accept',
            'Authorization'
        ]
    })
);

/* =========================================================
   BODY PARSING
========================================================= */

app.use(express.json());

/* =========================================================
   LOGGING
========================================================= */

app.use(morgan('combined'));

/* =========================================================
   RATE LIMITING
========================================================= */

app.use('/api/', generalLimiter);

app.use('/api/generate', generateLimiter);

app.use('/api/user/', authLimiter);

/* =========================================================
   ROUTES
========================================================= */

app.use('/', systemRoutes);

app.use('/', userPricingRoutes);

app.use('/', generateRoutes);

app.use('/', makeWebhookRoutes);

app.use('/', tasksRoutes);

app.use('/', paymentRoutes);

app.use('/', projectRoutes);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(async (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        await cleanupUploadedFiles(req);

        return res.status(400).json({
            error:
                err.code === 'LIMIT_FILE_SIZE'
                    ? 'حجم الملف أكبر من الحد المسموح.'
                    : 'فشل رفع الملف.'
        });
    }

    if (err) {
        await cleanupUploadedFiles(req);

        console.error('Unhandled API Error:', err);

        return res.status(500).json({
            error: 'خطأ داخلي في الخادم'
        });
    }

    next();
});

/* =========================================================
   EXPORT
========================================================= */

module.exports = app;
