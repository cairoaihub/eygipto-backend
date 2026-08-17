const express=require('express');
const crypto=require('crypto');
const {supabase}=require('../services/db');
const {makeWebhookSchema}=require('../config/schemas');
const {AUTO_UPLOAD_TO_SPACES,uploadResultUrlToSpaces}=require('../services/storage');
const router=express.Router();

router.post(
    '/api/webhook/make-result',
    async (req, res) => {

        try {

            const makeSecret =
                req.headers[
                    'x-make-secret'
                ] || '';

            const expectedSecret =
                process.env.MAKE_WEBHOOK_SECRET;

            if (
                makeSecret.length !==
                expectedSecret.length ||
                !crypto.timingSafeEqual(
                    Buffer.from(makeSecret),
                    Buffer.from(expectedSecret)
                )
            ) {

                return res.status(403).json({
                    error:
                        "Unauthorized"
                });
            }

            const parsed =
                makeWebhookSchema.safeParse(
                    req.body
                );

            if (!parsed.success) {

                return res.status(400).json({
                    error:
                        "Invalid Webhook Body"
                });
            }

        const {
    task_id,
    status,
    file_url,
    output_text,
    text,
    result_text
} = parsed.data;

            if (
                status === 'success' &&
                file_url
            ) {

                let storedFileUrl = file_url;

                if (AUTO_UPLOAD_TO_SPACES) {
                    try {
                        const storageKey = await uploadResultUrlToSpaces(
                            file_url,
                            `generated/${task_id}`
                        );

                        if (storageKey) {
                            storedFileUrl = `spaces://${storageKey}`;
                        }
                    } catch (storageError) {
                        console.error(
                            `Storage upload failed for task ${task_id}:`,
                            storageError
                        );

                        // لا نفقد نتيجة ناجحة من Make إذا تعذر التخزين؛
                        // نحتفظ بالرابط الأصلي كخطة احتياطية.
                    }
                }

                const {
                    data:
                        updatedTask
                } =
                    await supabase
                        .from('tasks')
                        .update({
                            status:
                                'success',

                            file_url: storedFileUrl,

                            output_text:
                                output_text ||
                                text ||
                                result_text ||
                                null,

                            updated_at:
                                new Date()
                        })
                        .eq(
                            'id',
                            task_id
                        )
                        .eq(
                            'status',
                            'processing'
                        )
                        .select()
                        .single();

                if (!updatedTask) {

                    return res.status(404).json({
                        error:
                            "Task not found or already processed"
                    });
                }

            } else {

                const {
                    data:
                        failedTask
                } =
                    await supabase
                        .from('tasks')
                        .update({
                            status:
                                'failed',

                            updated_at:
                                new Date()
                        })
                        .eq(
                            'id',
                            task_id
                        )
                        .eq(
                            'status',
                            'processing'
                        )
                        .select()
                        .single();

                if (failedTask) {

                    const refundAmount = Number(failedTask.points_cost || 0);

                    if (refundAmount > 0) {
                        const {
                            error:
                                refundErr
                        } =
                            await supabase.rpc(
                                'atomic_restore_points',
                                {
                                    p_user_id:
                                        failedTask.user_id,

                                    p_amount:
                                        refundAmount,

                                    p_task_id:
                                        task_id
                                }
                            );

                        if (refundErr) {
                            console.error(
                                `CRITICAL: Refund failed from Make webhook ${task_id}`,
                                refundErr
                            );
                        }
                    }
                }
            }

            res.status(200).json({
                message:
                    "Processed"
            });

        } catch (error) {

            console.error(
                "Make Webhook Error:",
                error
            );

            res.status(500).json({
                error:
                    "Error processing webhook"
            });
        }
    }
);


// ==========================================
// PoYo.ai direct callback
// PoYo -> Backend (Make is not involved here)
// ==========================================

const extractPoyoTaskData = (payload) => {
    // PoYo's unified generation webhook uses { code, data: {...} }.
    // Some music webhooks may arrive as the inner object directly, so support both.
    return payload?.data && typeof payload.data === 'object'
        ? payload.data
        : payload || {};
};

const findResultUrl = (files = []) => {
    for (const file of Array.isArray(files) ? files : []) {
        const candidates = [
            file?.file_url,
            file?.image_url,
            file?.video_url,
            file?.audio_url,
            file?.wav_url,
            file?.thumbnail
        ];
        const url = candidates.find(value => typeof value === 'string' && /^https:\/\//i.test(value));
        if (url) return url;
    }
    return null;
};

const processPoyoCallback = async (payload) => {
    const data = extractPoyoTaskData(payload);
    const poyoTaskId = data.task_id;
    const status = data.status;
    const files = Array.isArray(data.files) ? data.files : [];
    const errorMessage = data.error_message || null;

    if (!poyoTaskId || !status) {
        throw new Error('PoYo callback is missing task_id or status.');
    }

    const { data: task, error: findError } = await supabase
        .from('tasks')
        .select('id,user_id,status,points_cost')
        .eq('poyo_task_id', poyoTaskId)
        .maybeSingle();

    if (findError) {
        throw new Error(`Failed to find task for PoYo task ${poyoTaskId}: ${findError.message}`);
    }

    // Unknown callbacks are acknowledged but not allowed to mutate data.
    if (!task) {
        console.warn(`PoYo callback received for unknown task: ${poyoTaskId}`);
        return;
    }

    // Idempotency: retries or duplicate callbacks must not double-refund or overwrite a final task.
    if (task.status !== 'processing') {
        console.log(`PoYo callback already processed for ${poyoTaskId}; status=${task.status}`);
        return;
    }

    if (status === 'finished') {
        const resultUrl = findResultUrl(files);

        if (!resultUrl) {
            throw new Error(`PoYo task ${poyoTaskId} finished without a supported result URL.`);
        }

        let storedFileUrl = resultUrl;

        if (AUTO_UPLOAD_TO_SPACES) {
            const storageKey = await uploadResultUrlToSpaces(
                resultUrl,
                `generated/${task.id}`
            );

            if (storageKey) {
                storedFileUrl = `spaces://${storageKey}`;
            }
        }

        const { data: updatedTask, error: updateError } = await supabase
            .from('tasks')
            .update({
                status: 'success',
                file_url: storedFileUrl,
                output_text: data.output_text || data.text || data.result_text || null,
                updated_at: new Date()
            })
            .eq('id', task.id)
            .eq('status', 'processing')
            .select('id')
            .maybeSingle();

        if (updateError) {
            throw new Error(`Failed to update completed task ${task.id}: ${updateError.message}`);
        }

        if (!updatedTask) {
            console.log(`Task ${task.id} was finalized by another callback.`);
        }

        return;
    }

    if (status === 'failed') {
        const { data: failedTask, error: updateError } = await supabase
            .from('tasks')
            .update({
                status: 'failed',
                output_text: errorMessage,
                updated_at: new Date()
            })
            .eq('id', task.id)
            .eq('status', 'processing')
            .select('id,user_id,points_cost')
            .maybeSingle();

        if (updateError) {
            throw new Error(`Failed to mark task ${task.id} as failed: ${updateError.message}`);
        }

        if (failedTask && Number(failedTask.points_cost || 0) > 0) {
            const { error: refundError } = await supabase.rpc(
                'atomic_restore_points',
                {
                    p_user_id: failedTask.user_id,
                    p_amount: Number(failedTask.points_cost),
                    p_task_id: task.id
                }
            );

            if (refundError) {
                console.error(`CRITICAL: Refund failed for PoYo callback ${task.id}`, refundError);
            }
        }
    }
};

router.post(
    '/api/webhook/poyo-result',
    async (req, res) => {
        // PoYo requires a fast 2xx acknowledgement (within 10 seconds).
        // Heavy work such as downloading to Spaces happens after acknowledgement.
        res.status(200).json({ received: true });

        setImmediate(() => {
            processPoyoCallback(req.body).catch(error => {
                console.error('PoYo Callback Processing Error:', error);
            });
        });
    }
);

module.exports=router;
