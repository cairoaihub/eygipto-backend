const express=require('express');
const {supabase}=require('../services/db');
const {authenticateUser}=require('../middlewares/auth');
const {requireActiveSubscription}=require('../middlewares/subscription');
const {MODELS_PRICING,PROFIT_MARGIN,DOLLAR_TO_POINTS,CHAT_EXTRA_POINTS}=require('../config/pricing');
const router=express.Router();

router.get(
    '/api/user/profile',
    authenticateUser,
    async (req, res) => {

        const {
            data: user,
            error
        } =
            await supabase
                .from('users')
                .select(
                    'points, email, role, received_welcome_bonus'
                )
                .eq(
                    'id',
                    req.user.id
                )
                .single();

        if (
            error ||
            !user
        ) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.status(200).json(user);
    }
);

router.get(
    '/api/chat/pricing',
    authenticateUser,
    requireActiveSubscription,
    async (req, res) => {
        return res.status(200).json({
            mora: 0,
            mora_pro: 0,
            mora_extra: CHAT_EXTRA_POINTS
        });
    }
);

// ==========================================
// أسعار الخدمات قبل التوليد
// Read-only: لا يخصم نقاط ولا ينشئ Task
// السعر النهائي يظل محسوبًا مرة ثانية داخل /api/generate
// ==========================================
router.get(
    '/api/pricing',
    authenticateUser,
    requireActiveSubscription,
    async (req, res) => {
        try {
            const modelName = String(req.query.modelName || '').trim();

            const usageAmount = Math.max(
                1,
                Math.floor(Number(req.query.usageAmount || 1))
            );

            if (usageAmount > 1000 || !Number.isFinite(usageAmount)) {
                return res.status(400).json({
                    error: 'قيمة الاستخدام غير صالحة.'
                });
            }

            if (!modelName) {
                return res.status(400).json({
                    error: 'يجب تحديد الموديل.'
                });
            }

            const modelData = MODELS_PRICING[modelName];

            if (!modelData) {
                return res.status(400).json({
                    error: 'هذا الموديل غير مدعوم.'
                });
            }

            let poyoCost = 0;
            let pointsCost = 0;

            // Mora Extra / Claude له سعر نقاط ثابت من الخلفية.
            if (modelName === 'claude-sonnet-5') {
                pointsCost = CHAT_EXTRA_POINTS;
            } else {
                poyoCost = modelData.cost * usageAmount;

                pointsCost = Math.ceil(
                    poyoCost *
                    PROFIT_MARGIN *
                    DOLLAR_TO_POINTS
                );
            }

            return res.status(200).json({
                modelName,
                usageAmount,
                points: pointsCost,
                poyoCost
            });
        } catch (error) {
            console.error('Pricing Error:', error);

            return res.status(500).json({
                error: 'تعذر حساب تكلفة الخدمة.'
            });
        }
    }
);

module.exports=router;
