const express=require('express');
const axios=require('axios');
const crypto=require('crypto');
const {supabase}=require('../services/db');
const {PACKAGES,DOLLAR_TO_POINTS}=require('../config/pricing');
const {authenticateUser}=require('../middlewares/auth');
const router=express.Router();

router.post(
    '/api/payment/create',
    authenticateUser,
    async (req, res) => {

        try {

            const {
                packageId,
                bloggerCode
            } =
                req.body;

            const selectedPackage =
                PACKAGES[
                    packageId
                ];

            if (!selectedPackage) {

                return res.status(400).json({
                    error:
                        "باقة غير صالحة"
                });
            }

            const transactionId =
                `ek_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

            const {
                error: txError
            } =
                await supabase
                    .from('transactions')
                    .insert({
                        transaction_id:
                            transactionId,

                        user_id:
                            req.user.id,

                        package_name:
                            packageId,

                        amount_paid:
                            selectedPackage.price,

                        points_added:
                            selectedPackage.price *
                            DOLLAR_TO_POINTS,

                        blogger_code:
                            bloggerCode ||
                            null,

                        status:
                            'pending'
                    });

            if (txError) {

                return res.status(500).json({
                    error:
                        "فشل تهيئة الدفع محلياً."
                });
            }

            const easyKashPayload = {

                amount:
                    selectedPackage.price,

                currency:
                    "USD",

                req_id:
                    transactionId,

                success_url:
                    `https://egypto.ai/payment/success?txn=${transactionId}`,

                cancel_url:
                    `https://egypto.ai/payment/cancel`
            };

            try {

                const easyKashRes =
                    await axios.post(
                        `${process.env.EASYKASH_BASE_URL}/api/v1/payments`,
                        easyKashPayload,
                        {
                            headers: {
                                'Authorization':
                                    `Bearer ${process.env.EASYKASH_API_KEY}`,

                                'Content-Type':
                                    'application/json'
                            }
                        }
                    );

                res.status(200).json({
                    paymentUrl:
                        easyKashRes.data.payment_url,

                    transactionId
                });

            } catch (apiError) {

                await supabase
                    .from('transactions')
                    .update({
                        status:
                            'failed'
                    })
                    .eq(
                        'transaction_id',
                        transactionId
                    );

                return res.status(502).json({
                    error:
                        "فشل الاتصال بمزود الدفع."
                });
            }

        } catch (error) {

            res.status(500).json({
                error:
                    "خطأ داخلي أثناء إصدار الفاتورة"
            });
        }
    }
);

// ==========================================
// EasyKash Webhook
// ==========================================

router.post(
    '/api/webhook/easykash',
    async (req, res) => {

        try {

            const incomingSignature =
                req.headers[
                    'x-easykash-signature'
                ] || '';

            const expectedSignature =
                crypto
                    .createHmac(
                        'sha256',
                        process.env.EASYKASH_SECRET
                    )
                    .update(
                        JSON.stringify(
                            req.body
                        )
                    )
                    .digest('hex');

            if (
                incomingSignature.length !==
                expectedSignature.length ||
                !crypto.timingSafeEqual(
                    Buffer.from(
                        incomingSignature
                    ),
                    Buffer.from(
                        expectedSignature
                    )
                )
            ) {

                return res.status(403).json({
                    error:
                        "Unauthorized Signature"
                });
            }

            const {
                req_id:
                    transaction_id,

                status,

                amount,

                currency
            } =
                req.body;

            const {
                data: tx,
                error: fetchError
            } =
                await supabase
                    .from('transactions')
                    .select(
                        'amount_paid, status'
                    )
                    .eq(
                        'transaction_id',
                        transaction_id
                    )
                    .single();

            if (
                fetchError ||
                !tx
            ) {

                return res.status(404).json({
                    error:
                        "Transaction not found"
                });
            }

            if (
                amount === undefined ||
                amount === null ||
                parseFloat(amount) !==
                    parseFloat(
                        tx.amount_paid
                    )
            ) {

                console.error(
                    `🔴 CRITICAL: Missing or mismatch amount for ${transaction_id}. Expected ${tx.amount_paid}, Got ${amount}`
                );

                await supabase
                    .from('transactions')
                    .update({
                        status:
                            'failed'
                    })
                    .eq(
                        'transaction_id',
                        transaction_id
                    )
                    .eq(
                        'status',
                        'pending'
                    );

                return res.status(400).json({
                    error:
                        "Invalid or missing amount."
                });
            }

            if (
                currency &&
                currency !== 'USD'
            ) {

                console.error(
                    `🔴 CRITICAL: Currency mismatch for ${transaction_id}. Expected USD, Got ${currency}`
                );

                await supabase
                    .from('transactions')
                    .update({
                        status:
                            'failed'
                    })
                    .eq(
                        'transaction_id',
                        transaction_id
                    )
                    .eq(
                        'status',
                        'pending'
                    );

                return res.status(400).json({
                    error:
                        "Invalid currency."
                });
            }

            if (
                status === 'PAID'
            ) {

                const {
                    data: rpcResult,
                    error: rpcError
                } =
                    await supabase.rpc(
                        'process_payment_webhook',
                        {
                            p_transaction_id:
                                transaction_id
                        }
                    );

                if (rpcError) {

                    return res.status(500).json({
                        error:
                            "DB Error processing payment"
                    });
                }

                res.status(200).json(
                    rpcResult
                );

            } else {

                await supabase
                    .from('transactions')
                    .update({
                        status:
                            'failed'
                    })
                    .eq(
                        'transaction_id',
                        transaction_id
                    )
                    .eq(
                        'status',
                        'pending'
                    );

                res.status(400).json({
                    message:
                        "Payment not PAID."
                });
            }

        } catch (error) {

            res.status(500).json({
                error:
                    "Webhook Error"
            });
        }
    }
);

module.exports=router;
