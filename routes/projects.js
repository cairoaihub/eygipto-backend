const express=require('express');
const {supabase}=require('../services/db');
const {authenticateUser}=require('../middlewares/auth');
const router=express.Router();

router.post(
    '/api/project/save',
    authenticateUser,
    async (req, res) => {

        try {

            const {
                projectId,
                projectName,
                projectData
            } =
                req.body;

            const userId =
                req.user.id;

            if (
                !projectName ||
                !projectData
            ) {

                return res.status(400).json({
                    error:
                        "بيانات المشروع غير مكتملة"
                });
            }

            // حماية IDOR
            if (projectId) {

                const {
                    data:
                        existingProject,
                    error:
                        checkError
                } =
                    await supabase
                        .from('projects')
                        .select(
                            'user_id'
                        )
                        .eq(
                            'id',
                            projectId
                        )
                        .single();

                if (
                    checkError ||
                    !existingProject
                ) {

                    return res.status(404).json({
                        error:
                            "المشروع غير موجود"
                    });
                }

                if (
                    existingProject.user_id !==
                    userId
                ) {

                    return res.status(403).json({
                        error:
                            "غير مصرح لك بتعديل هذا المشروع"
                    });
                }
            }

            const {
                data,
                error
            } =
                await supabase
                    .from('projects')
                    .upsert({
                        id:
                            projectId ||
                            undefined,

                        user_id:
                            userId,

                        project_name:
                            projectName,

                        project_data:
                            projectData,

                        updated_at:
                            new Date()
                    })
                    .select()
                    .single();

            if (error) {

                console.error(
                    "Project Save Error:",
                    error.message
                );

                return res.status(500).json({
                    error:
                        "فشل حفظ المشروع في السحاب"
                });
            }

            res.status(200).json({
                message:
                    "تم حفظ المشروع بنجاح",

                project:
                    data
            });

        } catch (err) {

            res.status(500).json({
                error:
                    "خطأ داخلي في الخادم"
            });
        }
    }
);

router.get(
    '/api/projects',
    authenticateUser,
    async (req, res) => {

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from('projects')
                    .select(
                        'id, project_name, updated_at'
                    )
                    .eq(
                        'user_id',
                        req.user.id
                    )
                    .order(
                        'updated_at',
                        {
                            ascending:
                                false
                        }
                    );

            if (error) {

                return res.status(500).json({
                    error:
                        "فشل جلب المشاريع"
                });
            }

            res.status(200).json(
                data
            );

        } catch (err) {

            res.status(500).json({
                error:
                    "خطأ داخلي"
            });
        }
    }
);

module.exports=router;
