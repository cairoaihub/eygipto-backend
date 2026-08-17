const { z } = require('zod');
const { MODELS_PRICING } = require('./pricing');

const generateSchema = z.object({
  prompt: z.string().min(1).max(5000),
  modelName: z.enum(Object.keys(MODELS_PRICING)),
  style: z.string().max(10000).optional(),
  usageAmount: z.coerce.number().int().positive().max(1000).default(1),
  inputTokens: z.coerce.number().int().nonnegative().optional(),
  outputTokens: z.coerce.number().int().nonnegative().optional()
});

const makeWebhookSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(['success', 'failed']),
  file_url: z.string().url().optional(),
  output_text: z.string().optional(),
  text: z.string().optional(),
  result_text: z.string().optional(),
  poyo_task_id: z.string().optional()
});

module.exports = { generateSchema, makeWebhookSchema };
