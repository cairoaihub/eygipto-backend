const express=require('express');
const {supabase}=require('../services/db');
const {authenticateUser}=require('../middlewares/auth');
const {normalizeTaskFileUrl}=require('../services/storage');
const router=express.Router();

router.get(
    '/api/tasks',
    authenticateUser,
    async (req, res) => {

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from('tasks')
                    .select(`
                        id,
                        prompt,
                        model_used,
                        status,
                        file_url,
                        output_text,
                        points_cost,
                        poyo_cost,
                        created_at,
                        updated_at
                    `)
                    .eq(
                        'user_id',
                        req.user.id
                    )
                    .order(
                        'created_at',
                        {
                            ascending:
                                false
                        }
                    )
                    .limit(50);

            if (error) {

                console.error(
                    'Tasks Fetch Error:',
                    error.message
                );

                return res.status(500).json({
                    error:
                        'فشل جلب مهام التوليد'
                });
            }

            const normalizedTasks = await Promise.all(
                (data || []).map(async (task) => ({
                    ...task,
                    file_url: await normalizeTaskFileUrl(task.file_url)
                }))
            );

            return res.status(200).json(
                normalizedTasks
            );

        } catch (error) {

            console.error(
                'Tasks Fetch Internal Error:',
                error
            );

            return res.status(500).json({
                error:
                    'خطأ داخلي أثناء جلب المهام'
            });
        }
    }
);

// ==========================================
// جلب مهمة واحدة للمستخدم الحالي
// ==========================================

router.get(
    '/api/tasks/:taskId',
    authenticateUser,
    async (req, res) => {

        try {

            const {
                taskId
            } =
                req.params;

            if (
                !/^[0-9a-fA-F-]{36}$/.test(
                    taskId
                )
            ) {

                return res.status(400).json({
                    error:
                        'معرّف المهمة غير صالح'
                });
            }

            const {
                data,
                error
            } =
                await supabase
                    .from('tasks')
                    .select(`
                        id,
                        prompt,
                        model_used,
                        status,
                        file_url,
                        output_text,
                        points_cost,
                        poyo_cost,
                        created_at,
                        updated_at
                    `)
                    .eq(
                        'id',
                        taskId
                    )
                    .eq(
                        'user_id',
                        req.user.id
                    )
                    .single();

            if (
                error ||
                !data
            ) {

                return res.status(404).json({
                    error:
                        'المهمة غير موجودة'
                });
            }

            const normalizedTask = {
                ...data,
                file_url: await normalizeTaskFileUrl(data.file_url)
            };

            return res.status(200).json(
                normalizedTask
            );

        } catch (error) {

            console.error(
                'Task Fetch Internal Error:',
                error
            );

            return res.status(500).json({
                error:
                    'خطأ داخلي أثناء جلب المهمة'
            });
        }
    }
);

module.exports=router;
