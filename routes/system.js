const express=require('express');
const {supabase}=require('../services/db');
const {authenticateUser,requireAdmin}=require('../middlewares/auth');
const router=express.Router();

router.get(
    '/health',
    (req, res) =>
        res.status(200).json({
            status: 'ok',
            timestamp: new Date()
        })
);

router.get(
    '/api/admin/stats',
    authenticateUser,
    requireAdmin,
    async (req, res) => {

        const {
            count: usersCount
        } =
            await supabase
                .from('users')
                .select('*', {
                    count: 'exact',
                    head: true
                });

        const {
            count: tasksCount
        } =
            await supabase
                .from('tasks')
                .select('*', {
                    count: 'exact',
                    head: true
                });

        const {
            count: txCount
        } =
            await supabase
                .from('transactions')
                .select('*', {
                    count: 'exact',
                    head: true
                })
                .eq(
                    'status',
                    'success'
                );

        res.status(200).json({
            usersCount,
            tasksCount,
            successfulTransactions:
                txCount
        });
    }
);

setInterval(
    async () => {

        try {

            const fifteenMinsAgo =
                new Date(
                    Date.now() -
                    15 * 60 * 1000
                ).toISOString();

            const {
                data: stuckTasks
            } =
                await supabase
                    .from('tasks')
                    .select(
                        'id, user_id, points_cost'
                    )
                    .eq(
                        'status',
                        'processing'
                    )
                    .lt(
                        'created_at',
                        fifteenMinsAgo
                    );

            for (
                const task of
                (stuckTasks || [])
            ) {

                const {
                    data: updated
                } =
                    await supabase
                        .from('tasks')
                        .update({
                            status: 'failed'
                        })
                        .eq(
                            'id',
                            task.id
                        )
                        .eq(
                            'status',
                            'processing'
                        )
                        .select()
                        .single();

                if (updated) {

                    const {
                        error: rpcError
                    } =
                        await supabase.rpc(
                            'atomic_restore_points',
                            {
                                p_user_id:
                                    task.user_id,

                                p_amount:
                                    task.points_cost,

                                p_task_id:
                                    task.id
                            }
                        );

                    if (rpcError) {
                        console.error(
                            `CRITICAL: Failed to refund stuck task ${task.id}`,
                            rpcError
                        );
                    }
                }
            }

        } catch (err) {

            console.error(
                "Cleanup job error:",
                err.message
            );
        }

    },
    15 * 60 * 1000
);

module.exports=router;
