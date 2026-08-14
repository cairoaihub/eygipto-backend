const {supabase}=require('../services/db');

const requireActiveSubscription = async (req, res, next) => {
    try {
        if (req.user?.role === 'admin') return next();

        const { data: tx, error } = await supabase
            .from('transactions')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('status', 'success')
            .limit(1);

        if (error) {
            console.error('Subscription Check Error:', error);
            return res.status(500).json({
                error: 'تعذر التحقق من حالة الاشتراك.'
            });
        }

        if (!tx || tx.length === 0) {
            return res.status(403).json({
                error: 'يجب شراء باقة أولًا لاستخدام خدمات المنصة.'
            });
        }

        next();
    } catch (error) {
        console.error('Subscription Check Error:', error);
        return res.status(500).json({
            error: 'تعذر التحقق من حالة الاشتراك.'
        });
    }
};

const requirePositiveBalance = async (req, res, next) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('points')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        if (Number(user.points || 0) <= 0) {
            return res.status(403).json({
                error: 'رصيدك صفر. اشترِ باقة لإستخدام خدمات المنصة.'
            });
        }

        req.userPoints = Number(user.points || 0);
        next();
    } catch (error) {
        console.error('Balance Check Error:', error);
        return res.status(500).json({
            error: 'تعذر التحقق من الرصيد.'
        });
    }
};

module.exports={requireActiveSubscription,requirePositiveBalance};
