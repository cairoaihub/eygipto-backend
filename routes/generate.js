const express=require('express');
const axios=require('axios');
const crypto=require('crypto');
const {supabase}=require('../services/db');
const {MODELS_PRICING,PROFIT_MARGIN,DOLLAR_TO_POINTS,CHAT_EXTRA_POINTS}=require('../config/pricing');
const {generateSchema}=require('../config/schemas');
const {authenticateUser}=require('../middlewares/auth');
const {requireActiveSubscription,requirePositiveBalance}=require('../middlewares/subscription');
const {secureUpload,ethicalFilter,cleanupUploadedFiles}=require('../middlewares/uploadSecurity');
const {STORAGE_ENABLED,AUTO_UPLOAD_TO_SPACES,makeSafeStorageKey,uploadLocalFileToSpaces,createStorageReferenceUrl}=require('../services/storage');
const {getPoyoModel,buildPoyoInput}= require('./poyoAdapter');
const router=express.Router();

router.post(
    '/api/generate',
    authenticateUser,
    requireActiveSubscription,
    requirePositiveBalance,
    secureUpload,
    ethicalFilter,
    async (req, res) => {
        try {
            const parsed = generateSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
            }
            const { prompt, modelName, style, usageAmount, inputTokens, outputTokens } = parsed.data;
            const userId = req.user.id;
            const modelData = MODELS_PRICING[modelName];
            let poyoCost;
            if (modelName === 'claude-sonnet-5') { poyoCost = 0; } else { poyoCost = modelData.cost * usageAmount; }
            const pointsCost = modelName === 'claude-sonnet-5' ? CHAT_EXTRA_POINTS : Math.ceil(poyoCost * PROFIT_MARGIN * DOLLAR_TO_POINTS);
            const tempTaskId = crypto.randomUUID();

            if (pointsCost > 0) {
                const { data: isDeducted, error: deductError } = await supabase.rpc('atomic_deduct_points', { p_user_id: userId, p_amount: pointsCost, p_task_id: tempTaskId });
                if (deductError || !isDeducted) {
                    return res.status(403).json({ error: "رصيد النقاط لا يكفي أو تم الخصم مسبقاً." });
                }
            }

            const { data: task, error: taskError } = await supabase.from('tasks').insert({ id: tempTaskId, user_id: userId, prompt, model_used: modelName, points_cost: pointsCost, poyo_cost: poyoCost, status: 'processing' }).select().single();
            if (taskError) {
                if (pointsCost > 0) {
                    await supabase.rpc('atomic_restore_points', { p_user_id: userId, p_amount: pointsCost, p_task_id: tempTaskId });
                }
                await cleanupUploadedFiles(req);
                return res.status(500).json({ error: "فشل إنشاء المهمة." });
            }

            const poyoModel = getPoyoModel(modelName);
            if (!poyoModel) {
                if (pointsCost > 0) { await supabase.rpc('atomic_restore_points', { p_user_id: userId, p_amount: pointsCost, p_task_id: task.id }); }
                await supabase.from('tasks').update({ status: 'failed', updated_at: new Date() }).eq('id', task.id).eq('status', 'processing');
                await cleanupUploadedFiles(req);
                return res.status(400).json({ error: `الموديل ${modelName} غير مهيأ لمسار PoYo الحالي.` });
            }

            const makePayload = { task_id: task.id, prompt, model: modelName, poyo_model: poyoModel, style, callback_url: process.env.POYO_CALLBACK_URL };
            const referenceFiles = [];
            if ((req.files || []).length > 0) {
                if (!STORAGE_ENABLED || !AUTO_UPLOAD_TO_SPACES) {
                    await cleanupUploadedFiles(req);
                    return res.status(503).json({ error: 'تخزين الملفات غير مهيأ حاليًا.' });
                }
                for (const file of req.files) {
                    const storageKey = makeSafeStorageKey(`uploads/${userId}`, file.originalname);
                    await uploadLocalFileToSpaces(file.path, storageKey, file.mimetype);
                    const signedUrl = await createStorageReferenceUrl(storageKey);
                    referenceFiles.push({ name: file.originalname, type: file.mimetype, storage_key: storageKey, url: signedUrl });
                }
                makePayload.reference_files = referenceFiles;
            }

            try {
                makePayload.poyo_input_json = buildPoyoInput({ modelName, prompt, style, referenceFiles });
            } catch (adapterError) {
                if (pointsCost > 0) { await supabase.rpc('atomic_restore_points', { p_user_id: userId, p_amount: pointsCost, p_task_id: task.id }); }
                await supabase.from('tasks').update({ status: 'failed', updated_at: new Date() }).eq('id', task.id).eq('status', 'processing');
                await cleanupUploadedFiles(req);
                return res.status(400).json({ error: adapterError.message || 'إعدادات الموديل غير صالحة.' });
            }

            if (modelName === 'claude-sonnet-5') {
                makePayload.input_tokens = inputTokens;
                makePayload.output_tokens = outputTokens;
            }

            let makeResponse;
            try {
                makeResponse = await axios.post(process.env.MAKE_WEBHOOK_IMAGE_GEN, makePayload, {
                    timeout: 10000,
                    headers: { 'Content-Type': 'application/json', ...(process.env.MAKE_WEBHOOK_API_KEY ? { 'x-make-apikey': process.env.MAKE_WEBHOOK_API_KEY } : {}) }
                });
            } catch (err) {
                const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout');
                if (isTimeout) {
                    console.log(`Make timeout but task ${task.id} likely accepted, keeping as processing`);
                    await cleanupUploadedFiles(req);
                    return res.status(202).json({ message: "تم استلام الطلب وجاري المعالجة", taskId: task.id, cost: pointsCost });
                }
                console.error('Make.com API Error:', err.message);
                const { data: updatedTask } = await supabase.from('tasks').update({ status: 'failed', updated_at: new Date() }).eq('id', task.id).eq('status', 'processing').select().single();
                if (updatedTask && pointsCost > 0) { await supabase.rpc('atomic_restore_points', { p_user_id: userId, p_amount: pointsCost, p_task_id: task.id }); }
                await cleanupUploadedFiles(req);
                return res.status(502).json({ error: 'تعذر إرسال مهمة التوليد إلى خدمة المعالجة.' });
            }

            // FIXED: قبول كل اشكال poyo_task_id وعدم اعتبار غيابه فشل
            const poyoTaskId = makeResponse?.data?.poyo_task_id || makeResponse?.data?.data?.task_id || makeResponse?.data?.task_id || null;
            if (poyoTaskId && typeof poyoTaskId === 'string') {
                const { error: poyoTaskUpdateError } = await supabase.from('tasks').update({ poyo_task_id: poyoTaskId, updated_at: new Date() }).eq('id', task.id).eq('status', 'processing');
                if (poyoTaskUpdateError) { console.error(`Failed to save PoYo task ID for ${task.id}:`, poyoTaskUpdateError); }
            } else {
                console.warn(`Make accepted task ${task.id} without poyo_task_id, will rely on my_task_id callback`);
            }

            await cleanupUploadedFiles(req);
            return res.status(202).json({ message: "جاري المعالجة", taskId: task.id, cost: pointsCost });

        } catch (error) {
            console.error("Generate Error:", error);
            await cleanupUploadedFiles(req);
            return res.status(500).json({ error: "خطأ داخلي" });
        }
    }
);
module.exports=router;
