const multer=require('multer');
const fs=require('fs');
const path=require('path');
const {execFile}=require('child_process');
const util=require('util');
const execFileAsync=util.promisify(execFile);
const { UPLOAD_TMP_DIR } = require('../services/storage');

// ==========================================
// 1.1 إعدادات أمان الملفات وفلتر الأمان
// ==========================================

const MAX_UPLOAD_SIZE = parseInt(
    process.env.MAX_UPLOAD_SIZE || 50 * 1024 * 1024,
    10
);

const ALLOWED_UPLOAD_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/wave'
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp',
    '.mp4', '.mov',
    '.mp3', '.wav'
]);


const upload = multer({
    dest: UPLOAD_TMP_DIR,
    limits: {
        fileSize: MAX_UPLOAD_SIZE,
        files: 5
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();

        if (
            !ALLOWED_UPLOAD_MIMES.has(file.mimetype) ||
            !ALLOWED_UPLOAD_EXTENSIONS.has(ext)
        ) {
            return cb(new Error('نوع الملف غير مسموح به.'));
        }

        cb(null, true);
    }
});

const DANGEROUS_PROMPT_PATTERNS = [
    /child.{0,30}(sexual|nude|naked|porn)/i,
    /(sexual|porn|nude|naked).{0,30}child/i,
    /exploit.{0,30}(minor|child)/i,
    /(credit card|cvv|password|private key).{0,40}(steal|dump|exfiltrat)/i,
    /(malware|ransomware|keylogger).{0,40}(build|create|deploy)/i
];

const containsUnsafePrompt = (value) => {
    if (typeof value !== 'string') return false;
    return DANGEROUS_PROMPT_PATTERNS.some((pattern) => pattern.test(value));
};

const ethicalFilter = (req, res, next) => {
    const prompt = req.body?.prompt || req.body?.text || req.body?.script || '';

    if (containsUnsafePrompt(prompt)) {
        return res.status(400).json({
            error: 'هذا الطلب غير مسموح به وفق قواعد الأمان.'
        });
    }

    next();
};

const readFileSignature = async (filePath) => {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(32);
        const { bytesRead } = await handle.read(buffer, 0, 32, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
};

const signatureMatches = (signature, ext) => {
    const hex = signature.toString('hex').toLowerCase();

    if (['.jpg', '.jpeg'].includes(ext)) {
        return hex.startsWith('ffd8ff');
    }

    if (ext === '.png') {
        return hex.startsWith('89504e470d0a1a0a');
    }

    if (ext === '.webp') {
        return (
            hex.startsWith('52494646') &&
            signature.toString('ascii', 8, 12) === 'WEBP'
        );
    }

    if (ext === '.mp4' || ext === '.mov') {
        return signature.length >= 12 &&
            signature.toString('ascii', 4, 8) === 'ftyp';
    }

    if (ext === '.mp3') {
        return hex.startsWith('494433') ||
            hex.startsWith('fffb') ||
            hex.startsWith('fff3') ||
            hex.startsWith('fff2');
    }

    if (ext === '.wav') {
        return (
            hex.startsWith('52494646') &&
            signature.toString('ascii', 8, 12) === 'WAVE'
        );
    }

    return false;
};

const scanWithClamAV = async (filePath) => {
    if (process.env.CLAMAV_ENABLED !== 'true') {
        return { enabled: false, clean: true };
    }

    try {
        await execFileAsync(
            process.env.CLAMAV_COMMAND || 'clamdscan',
            ['--no-summary', filePath],
            { timeout: 120000 }
        );

        return { enabled: true, clean: true };
    } catch (error) {
        const output = `${error.stdout || ''}\n${error.stderr || ''}`;

        if (/FOUND/i.test(output)) {
            return { enabled: true, clean: false };
        }

        throw new Error('تعذر إكمال فحص مكافحة البرمجيات الخبيثة.');
    }
};

const secureUpload = [
    upload.any(),
    async (req, res, next) => {
        const files = req.files || [];

        try {
            for (const file of files) {
                const ext = path.extname(file.originalname || '').toLowerCase();

                const signature = await readFileSignature(file.path);

                if (!signatureMatches(signature, ext)) {
                    throw new Error('محتوى الملف لا يطابق نوعه الحقيقي.');
                }

                const scan = await scanWithClamAV(file.path);

                if (!scan.clean) {
                    throw new Error('تم رفض الملف بعد اكتشاف تهديد أمني.');
                }
            }

            next();
        } catch (error) {
            for (const file of files) {
                try {
                    await fs.promises.unlink(file.path);
                } catch (_) {}
            }

            return res.status(400).json({
                error: error.message || 'الملف المرفوع غير آمن.'
            });
        }
    }
];

const cleanupUploadedFiles = async (req) => {
    for (const file of req.files || []) {
        try {
            await fs.promises.unlink(file.path);
        } catch (_) {}
    }
};


module.exports={upload,secureUpload,ethicalFilter,cleanupUploadedFiles};
