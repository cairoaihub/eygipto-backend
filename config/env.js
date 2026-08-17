const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EASYKASH_BASE_URL',
  'EASYKASH_API_KEY',
  'EASYKASH_SECRET',
  'MAKE_WEBHOOK_IMAGE_GEN',
  'MAKE_WEBHOOK_SECRET',
  'POYO_CALLBACK_URL'
];

for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`CRITICAL: Missing Environment Variable: ${envVar}`);
    process.exit(1);
  }
}

module.exports = { requiredEnv };
