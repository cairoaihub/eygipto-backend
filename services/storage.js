const axios=require('axios');
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {S3Client,PutObjectCommand,GetObjectCommand}=require('@aws-sdk/client-s3');
const {getSignedUrl}=require('@aws-sdk/s3-request-presigner');

// ==========================================
// 1.05 DigitalOcean Spaces Storage
// ==========================================

const STORAGE_ENABLED =
    process.env.STORAGE_TYPE === 'spaces' &&
    process.env.STORAGE_ENDPOINT &&
    process.env.STORAGE_BUCKET &&
    process.env.STORAGE_KEY &&
    process.env.STORAGE_SECRET;

if (!STORAGE_ENABLED) {
    console.warn(
        '🟡 DigitalOcean Spaces is not fully configured. Storage upload is disabled.'
    );
}

const spacesClient = STORAGE_ENABLED
    ? new S3Client({
        region: process.env.STORAGE_REGION || 'fra1',
        endpoint: process.env.STORAGE_ENDPOINT,
        credentials: {
            accessKeyId: process.env.STORAGE_KEY,
            secretAccessKey: process.env.STORAGE_SECRET
        },
        forcePathStyle: false
    })
    : null;

const STORAGE_BUCKET = process.env.STORAGE_BUCKET || '';
const STORAGE_CDN = (process.env.STORAGE_CDN || '').replace(/\/$/, '');
const AUTO_UPLOAD_TO_SPACES =
    String(process.env.AUTO_UPLOAD_TO_SPACES || 'false').toLowerCase() === 'true';
const STORAGE_SIGNED_URL_SECONDS = Math.min(
    Math.max(parseInt(process.env.STORAGE_SIGNED_URL_SECONDS || '3600', 10), 300),
    86400
);
const MAX_RESULT_DOWNLOAD_SIZE = parseInt(
    process.env.MAX_RESULT_DOWNLOAD_SIZE || 500 * 1024 * 1024,
    10
);

const UPLOAD_TMP_DIR = path.join(
    os.tmpdir(),
    'egypto-ai-secure-uploads'
);

fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const makeSafeStorageKey = (prefix, originalName = '') => {
    const ext = path.extname(originalName || '').toLowerCase();
    const safeExt = /^[.][a-z0-9]{1,10}$/.test(ext) ? ext : '';
    return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${safeExt}`;
};

const uploadLocalFileToSpaces = async (filePath, storageKey, contentType) => {
    if (!STORAGE_ENABLED || !spacesClient) {
        throw new Error('DigitalOcean Spaces غير مهيأ بشكل صحيح.');
    }

    await spacesClient.send(
        new PutObjectCommand({
            Bucket: STORAGE_BUCKET,
            Key: storageKey,
            Body: fs.createReadStream(filePath),
            ContentType: contentType || 'application/octet-stream',
            CacheControl: 'private, max-age=0, no-cache'
        })
    );

    return storageKey;
};

const createStorageReferenceUrl = async (storageKey) => {
    if (!storageKey) return null;

    if (!STORAGE_ENABLED || !spacesClient) {
        return STORAGE_CDN ? `${STORAGE_CDN}/${storageKey}` : null;
    }

    return getSignedUrl(
        spacesClient,
        new GetObjectCommand({
            Bucket: STORAGE_BUCKET,
            Key: storageKey
        }),
        { expiresIn: STORAGE_SIGNED_URL_SECONDS }
    );
};

const uploadResultUrlToSpaces = async (fileUrl, prefix = 'generated') => {
    if (!AUTO_UPLOAD_TO_SPACES || !STORAGE_ENABLED || !fileUrl) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(fileUrl);
    } catch (_) {
        throw new Error('رابط نتيجة التوليد غير صالح.');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('لا يسمح بتخزين نتيجة من رابط غير آمن.');
    }

    const response = await axios.get(fileUrl, {
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 3,
        validateStatus: (status) => status >= 200 && status < 300
    });

    const contentLength = Number(response.headers['content-length'] || 0);
    if (contentLength && contentLength > MAX_RESULT_DOWNLOAD_SIZE) {
        response.data.destroy();
        throw new Error('حجم نتيجة التوليد أكبر من الحد المسموح.');
    }

    const contentType = String(
        response.headers['content-type'] || 'application/octet-stream'
    ).split(';')[0].trim();

    const extByMime = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/x-wav': '.wav'
    };

    const tempPath = path.join(
        UPLOAD_TMP_DIR,
        `result-${crypto.randomUUID()}${extByMime[contentType] || ''}`
    );

    let bytes = 0;

    try {
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(tempPath);
            let settled = false;

            const fail = (error) => {
                if (settled) return;
                settled = true;
                response.data.destroy();
                output.destroy();
                reject(error);
            };

            response.data.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > MAX_RESULT_DOWNLOAD_SIZE) {
                    fail(new Error('حجم نتيجة التوليد أكبر من الحد المسموح.'));
                }
            });

            response.data.on('error', fail);
            output.on('error', fail);
            output.on('finish', () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            });
            response.data.pipe(output);
        });

        const storageKey = makeSafeStorageKey(
            prefix,
            `result${extByMime[contentType] || ''}`
        );

        await uploadLocalFileToSpaces(tempPath, storageKey, contentType);
        return storageKey;
    } finally {
        try {
            await fs.promises.unlink(tempPath);
        } catch (_) {}
    }
};

const normalizeTaskFileUrl = async (fileUrl) => {
    if (!fileUrl) return fileUrl;

    if (fileUrl.startsWith('spaces://')) {
        return createStorageReferenceUrl(
            fileUrl.slice('spaces://'.length)
        );
    }

    return fileUrl;
};


module.exports={STORAGE_ENABLED,spacesClient,STORAGE_BUCKET,STORAGE_CDN,AUTO_UPLOAD_TO_SPACES,STORAGE_SIGNED_URL_SECONDS,MAX_RESULT_DOWNLOAD_SIZE,UPLOAD_TMP_DIR,makeSafeStorageKey,uploadLocalFileToSpaces,createStorageReferenceUrl,uploadResultUrlToSpaces,normalizeTaskFileUrl};
