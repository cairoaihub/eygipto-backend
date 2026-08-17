const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../services/db');
const { makeWebhookSchema } = require('../config/schemas');
const { AUTO_UPLOAD_TO_SPACES, uploadResultUrlToSpaces } = require('../services/storage');
const router = express.Router();

router.post(
    '/api/webhook/make-result',
    async (req, res) => {
        try {
            const makeSecret = req.headers['x-make-secret'] || '';
            const expectedSecret = process.env.MAKE_WEBHOOK_SECRET;

            if (
                makeSecret.length !== expectedSecret.length ||
                !crypto.timingSafeEqual(Buffer.from(makeSecret), Buffer.from(expectedSecret))
            ) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            const parsed = makeWebhookSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: "Invalid Webhook Body" });
            }

            const { task_id, status, file_url, output_text, text, result_text } = parsed.data;

            if (status === 'success' && file_url) {
                let storedFileUrl = file_url;
                if (AUTO_UPLOAD_TO_SPACES) {
                    try {
                        const storageKey = await uploadResultUrlToSpaces(file_url, `generated/${task_id}`);
                        if (storageKey) storedFileUrl = `spaces://${storageKey}`;
                    } catch (storageError) {
                        console.error(`Storage upload failed for task ${task_id}:`, storageError);
                    }
                }

                const { data: updatedTask } = await supabase
                    .from('tasks')
                    .update({
                        status: 'success',
                        file_url: storedFileUrl,
                        output_text: output_text || text || result_text || null,
                        updated_at: new Date()
                    })
                    .eq('id', task_id)
                    .eq('status', 'processing')
                    .select()
                    .single();

                if (!updatedTask) return res.status(404).json({ error: "Task not found or already processed" });
            } else {
                const { data: failedTask } = await supabase
                    .from('tasks')
                    .update({ status: 'failed', updated_at: new Date() })
                    .eq('id', task_id)
                    .eq('status', 'processing')
                    .select()
                    .single();

                if (failedTask && Number(failedTask.points_cost || 0) > 0) {
                    await supabase.rpc('atomic_restore_points', {
                        p_user_id: failedTask.user_id,
                        p_amount: Number(failedTask.points_cost),
                        p_task_id: task_id
                    });
                }
            }
            res.status(200).json({ message: "Processed" });
        } catch (error) {
            console.error("Make Webhook Error:", error);
            res.status(500).json({ error: "Error processing webhook" });
        }
    }
);

// ==========================================
// PoYo.ai direct callback
// ==========================================

const extractPoyoTaskData = (payload) => {
    return payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
};

const findResultUrl = (files = []) => {
    for (const file of Array.isArray(files) ? files : []) {
        const candidates = [file?.file_url, file?.image_url, file?.video_url, file?.audio_url, file?.wav_url, file?.thumbnail];
        const url = candidates.find(value => typeof value === 'string' && /^https:\/\//i.test(value));
        if (url) return url;
    }
    return null;
};

const processPoyoCallback = async (payload, myTaskId) => {
    const data = extractPoyoTaskData(payload);
    const poyoTaskId = data.task_id;
    const status = data.status;
    const files = Array.isArray(data.files) ? data.files : [];
    const errorMessage = data.error_message || null;

    if (!status) throw new Error('PoYo callback is missing status.');

    // البحث عن المهمة باستخدام myTaskId (إذا توفر) أو poyoTaskId
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
        console.warn(`PoYo callback received for unknown task (myTaskId: ${myTaskId}, poyoTaskId: ${poyoTaskId})`);
        return;
    }

    if (task.status !== 'processing') return;

    if (status === 'finished') {
        const resultUrl = findResultUrl(files);
        if (!resultUrl) throw new Error(`Task ${task.id} finished without a result URL.`);

        let storedFileUrl = resultUrl;
        if (AUTO_UPLOAD_TO_SPACES) {
            const storageKey = await uploadResultUrlToSpaces(resultUrl, `generated/${task.id}`);
            if (storageKey) storedFileUrl = `spaces://${storageKey}`;
        }

        await supabase.from('tasks')
            .update({ status: 'success', file_url: storedFileUrl, output_text: data.output_text || data.text || data.result_text || null, updated_at: new Date() })
            .eq('id', task.id)
            .eq('status', 'processing');
    } else if (status === 'failed') {
        const { data: failedTask } = await supabase.from('tasks')
            .update({ status: 'failed', output_text: errorMessage, updated_at: new Date() })
            .eq('id', task.id)
            .eq('status', 'processing')
            .select('id,user_id,points_cost')
            .maybeSingle();

        if (failedTask && Number(failedTask.points_cost || 0) > 0) {
            await supabase.rpc('atomic_restore_points', {
                p_user_id: failedTask.user_id,
                p_amount: Number(failedTask.points_cost),
                p_task_id: task.id
            });
        }
    }
};

router.post('/api/webhook/poyo-result', async (req, res) => {
    res.status(200).json({ received: true });

    // استخراج my_task_id من رابط الـ Query
    const myTaskId = req.query.my_task_id;

    setImmediate(() => {
        processPoyoCallback(req.body, myTaskId).catch(error => {
            console.error('PoYo Callback Processing Error:', error);
        });
    });
});

module.exports = router;
