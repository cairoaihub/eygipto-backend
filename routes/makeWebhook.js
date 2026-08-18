const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../services/db');
const { makeWebhookSchema } = require('../config/schemas');
const { AUTO_UPLOAD_TO_SPACES, uploadResultUrlToSpaces } = require('../services/storage');
const router = express.Router();

// حماية مسار make-result من crash لو السر مش موجود
router.post('/api/webhook/make-result', async (req, res) => {
    try {
        const makeSecret = req.headers['x-make-secret'] || '';
        const expectedSecret = process.env.MAKE_WEBHOOK_SECRET || '';
        if (!expectedSecret || makeSecret.length !== expectedSecret.length || !crypto.timingSafeEqual(Buffer.from(makeSecret), Buffer.from(expectedSecret))) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        const parsed = makeWebhookSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid Webhook Body" });
        const { task_id, status, file_url, output_text, text, result_text } = parsed.data;
        if (status === 'success' && file_url) {
            let storedFileUrl = file_url;
            if (AUTO_UPLOAD_TO_SPACES) {
                try {
                    const storageKey = await uploadResultUrlToSpaces(file_url, `generated/${task_id}`);
                    if (storageKey) storedFileUrl = `spaces://${storageKey}`;
                } catch (e) { console.error(e); }
            }
            const { data: updatedTask } = await supabase.from('tasks').update({ status: 'success', file_url: storedFileUrl, output_text: output_text || text || result_text || null, updated_at: new Date() }).eq('id', task_id).eq('status', 'processing').select().single();
            if (!updatedTask) return res.status(404).json({ error: "Task not found or already processed" });
        } else {
            const { data: failedTask } = await supabase.from('tasks').update({ status: 'failed', updated_at: new Date() }).eq('id', task_id).eq('status', 'processing').select().single();
            if (failedTask && Number(failedTask.points_cost || 0) > 0) {
                await supabase.rpc('atomic_restore_points', { p_user_id: failedTask.user_id, p_amount: Number(failedTask.points_cost), p_task_id: task_id });
            }
        }
        res.status(200).json({ message: "Processed" });
    } catch (error) {
        console.error("Make Webhook Error:", error);
        res.status(500).json({ error: "Error processing webhook" });
    }
});

// ==========================================
// PoYo.ai direct callback - FINAL FIXED VERSION
// ==========================================

const extractPoyoTaskData = (payload) => {
    if (!payload) return {};
    if (payload.data && typeof payload.data === 'object') return payload.data;
    return payload;
};

const findResultUrl = (payloadData) => {
    const data = payloadData || {};
    // 1. ابحث في كل الاماكن المحتملة للرابط المباشر
    const directCandidates = [data.file_url, data.image_url, data.video_url, data.audio_url, data.result_url, data.output_url, data.url, data.output?.file_url, data.output?.url, data.result?.file_url, data.result?.url];
    for (const url of directCandidates) {
        if (typeof url === 'string' && /^https:\/\//i.test(url)) return url;
    }
    // 2. ابحث في مصفوفة files
    const files = Array.isArray(data.files) ? data.files : Array.isArray(data.output?.files) ? data.output.files : [];
    for (const file of files) {
        const candidates = [file?.file_url, file?.image_url, file?.video_url, file?.audio_url, file?.wav_url, file?.thumbnail, file?.url];
        const url = candidates.find(v => typeof v === 'string' && /^https:\/\//i.test(v));
        if (url) return url;
    }
    return null;
};

const processPoyoCallback = async (payload, myTaskId) => {
    const data = extractPoyoTaskData(payload);
    const poyoTaskId = data.task_id || data.poyo_task_id || payload?.task_id || payload?.poyo_task_id || null;
    const statusRaw = (data.status || payload?.status || '').toString().toLowerCase();
    const errorMessage = data.error_message || data.error || payload?.error_message || null;

    if (!statusRaw) throw new Error('PoYo callback is missing status.');

    let query = supabase.from('tasks').select('id,user_id,status,points_cost');
    if (myTaskId) {
        query = query.eq('id', myTaskId);
    } else if (poyoTaskId) {
        query = query.eq('poyo_task_id', poyoTaskId);
    } else {
        throw new Error('PoYo callback is missing both my_task_id and task_id.');
    }

    const { data: task, error: findError } = await query.maybeSingle();
    if (findError) throw new Error(`Failed to find task: ${findError.message}`);
    if (!task) {
        console.warn(`PoYo callback for unknown task my_task_id=${myTaskId} poyo_task_id=${poyoTaskId}`);
        return { notFound: true };
    }
    if (task.status !== 'processing') {
        console.log(`Task ${task.id} already ${task.status}, ignoring duplicate callback`);
        return { alreadyProcessed: true };
    }

    // حالات النجاح: finished, success, completed, succeeded
    if (['finished', 'success', 'completed', 'succeeded'].includes(statusRaw)) {
        const resultUrl = findResultUrl(data);
        if (!resultUrl) {
            throw new Error(`Task ${task.id} finished without a result URL. Payload: ${JSON.stringify(payload).slice(0,500)}`);
        }
        let storedFileUrl = resultUrl;
        if (AUTO_UPLOAD_TO_SPACES) {
            try {
                const storageKey = await uploadResultUrlToSpaces(resultUrl, `generated/${task.id}`);
                if (storageKey) storedFileUrl = `spaces://${storageKey}`;
            } catch (e) { console.error(`Storage upload failed for ${task.id}:`, e); }
        }
        const { error: updateError } = await supabase.from('tasks').update({ status: 'success', file_url: storedFileUrl, output_text: data.output_text || data.text || data.result_text || null, updated_at: new Date() }).eq('id', task.id).eq('status', 'processing');
        if (updateError) throw new Error(`Failed to update task to success: ${updateError.message}`);
        console.log(`✅ Task ${task.id} marked as success`);
        return { success: true };
    } else if (['failed', 'error', 'failure'].includes(statusRaw)) {
        const { data: failedTask, error: failError } = await supabase.from('tasks').update({ status: 'failed', output_text: errorMessage, updated_at: new Date() }).eq('id', task.id).eq('status', 'processing').select('id,user_id,points_cost').maybeSingle();
        if (failError) throw new Error(`Failed to update task to failed: ${failError.message}`);
        if (failedTask && Number(failedTask.points_cost || 0) > 0) {
            const { error: rpcError } = await supabase.rpc('atomic_restore_points', { p_user_id: failedTask.user_id, p_amount: Number(failedTask.points_cost), p_task_id: task.id });
            if (rpcError) console.error(`Refund failed for ${task.id}:`, rpcError);
            else console.log(`↩️ Points restored for task ${task.id}`);
        }
        return { failed: true };
    } else {
        throw new Error(`Unknown PoYo status: ${statusRaw}`);
    }
};

router.post('/api/webhook/poyo-result', async (req, res) => {
    const myTaskId = req.query.my_task_id;
    console.log(`📥 PoYo Callback hit! my_task_id=${myTaskId || 'NOT_PROVIDED'} status=${req.body?.status || req.body?.data?.status}`);
    try {
        await processPoyoCallback(req.body, myTaskId);
        return res.status(200).json({ received: true });
    } catch (error) {
        console.error('❌ PoYo Callback Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;
