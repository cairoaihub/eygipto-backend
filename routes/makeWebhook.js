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

module.exports=router;
