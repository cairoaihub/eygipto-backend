const PROFIT_MARGIN = parseFloat(
    process.env.PROFIT_MARGIN || 2.0
);

const DOLLAR_TO_POINTS = parseInt(
    process.env.DOLLAR_TO_POINTS || 200,
    10
);

const CHAT_EXTRA_POINTS = Math.max(
    1,
    parseInt(process.env.CHAT_EXTRA_POINTS || '10', 10)
);

// ==========================================
// 3. التسعير والباقات
// ==========================================

const MODELS_PRICING = {

    // ==========================
    // Mora
    // ==========================

    'grok-imagine-image': {
        type: 'image',
        cost: parseFloat(
            process.env.PRICE_GROK_IMAGE || 0.200
        )
    },

    'kling-3.0-motion-control-720p': {
        type: 'avatar',
        cost: parseFloat(
            process.env.PRICE_KLING_MOTION_720P || 0.045
        )
    },

    'kling-o3-image': {
        type: 'image',
        cost: parseFloat(
            process.env.PRICE_KLING_O3_IMAGE || 0.018
        )
    },

    'elevenlabs-v3-tts': {
        type: 'audio',
        cost: parseFloat(
            process.env.PRICE_ELEVENLABS_TTS || 0.080
        )
    },

    'extend-music': {
        type: 'music',
        cost: parseFloat(
            process.env.PRICE_EXTEND_MUSIC || 0.100
        )
    },

    'deepseek-v4-flash-input': {
        type: 'text',
        cost: parseFloat(
            process.env.PRICE_DEEPSEEK_INPUT || 0.112
        )
    },

    'deepseek-v4-flash-output': {
        type: 'text',
        cost: parseFloat(
            process.env.PRICE_DEEPSEEK_OUTPUT || 0.224
        )
    },

    'deepseek-v4-flash': {
        type: 'text',
        cost: 0
    },

    // ==========================
    // Mora Pro
    // ==========================

    'seedance-1.0-pro-720p': {
        type: 'video',
        cost: parseFloat(
            process.env.PRICE_SEEDANCE_720P || 0.210
        )
    },

    'seedance-1.0-pro-1080p': {
        type: 'video',
        cost: parseFloat(
            process.env.PRICE_SEEDANCE_1080P || 0.430
        )
    },

    'kling-3.0-motion-control-1080p': {
        type: 'avatar',
        cost: parseFloat(
            process.env.PRICE_KLING_MOTION_1080P || 0.075
        )
    },

    'seedream-5.0-pro': {
        type: 'image',
        cost: parseFloat(
            process.env.PRICE_SEEDREAM_PRO || 0.075
        )
    },

    // ==========================
    // Mora Extra
    // ==========================

    'omni-flash': {
        type: 'video',
        cost: parseFloat(
            process.env.PRICE_OMNI_FLASH || 2.25
        )
    },

    'sora-2-official': {
        type: 'avatar',
        cost: parseFloat(
            process.env.PRICE_SORA || 1.20
        )
    },

    'nano-banana-2-official': {
        type: 'image',
        cost: parseFloat(
            process.env.PRICE_NANO_BANANA || 0.100
        )
    },

    'generate-music': {
        type: 'music',
        cost: parseFloat(
            process.env.PRICE_GENERATE_MUSIC || 0.100
        )
    },

    // Claude يحتاج Input / Output منفصلين
    'claude-sonnet-5': {
        type: 'text',
        inputCost: parseFloat(
            process.env.PRICE_CLAUDE_SONNET_5_INPUT || 0.850
        ),
        outputCost: parseFloat(
            process.env.PRICE_CLAUDE_SONNET_5_OUTPUT || 4.28
        )
    }
};

// ==========================================
// الباقات
// ==========================================

const PACKAGES = {
    'trial': {
        price: 1
    },

    'pack_10': {
        price: 10
    },

    'pack_20': {
        price: 20
    },

    'pack_30': {
        price: 30
    },

    'pack_50': {
        price: 50
    }
};

module.exports={PROFIT_MARGIN,DOLLAR_TO_POINTS,CHAT_EXTRA_POINTS,MODELS_PRICING,PACKAGES};
