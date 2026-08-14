const express=require('express');
const cors=require('cors');
const helmet=require('helmet');
const morgan=require('morgan');
const multer=require('multer');
const {generalLimiter,generateLimiter,authLimiter}=require('./middlewares/rateLimit');
const systemRoutes=require('./routes/system');
const userPricingRoutes=require('./routes/userPricing');
const generateRoutes=require('./routes/generate');
const makeWebhookRoutes=require('./routes/makeWebhook');
const tasksRoutes=require('./routes/tasks');
const paymentRoutes=require('./routes/payment');
const projectRoutes=require('./routes/projects');
const {cleanupUploadedFiles}=require('./middlewares/uploadSecurity');
const app=express();

app.use(helmet());
app.use(cors({origin:process.env.ALLOWED_CORS_ORIGIN || 'https://egypto.ai'}));
app.use(express.json());
app.use(morgan('combined'));
app.use('/api/',generalLimiter);
app.use('/api/generate',generateLimiter);
app.use('/api/user/',authLimiter);
app.use('/',systemRoutes);
app.use('/',userPricingRoutes);
app.use('/',generateRoutes);
app.use('/',makeWebhookRoutes);
app.use('/',tasksRoutes);
app.use('/',paymentRoutes);
app.use('/',projectRoutes);

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

module.exports=app;
