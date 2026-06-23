import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
LOG_LEVEL: z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  .default('info'),

ADMIN_API_KEY: z
  .string({ message: 'ADMIN_API_KEY must be a string' })
  .min(16, 'ADMIN_API_KEY must be at least 16 characters')
  .default('dev-admin-key-change-in-production'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  MOCK_GATEWAY: z.string().default('true').transform((val) => val === 'true'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  FRAUD_API_URL: z.string().optional(),
  FRAUD_API_KEY: z.string().optional(),
  FRAUD_SCORE_BLOCK_THRESHOLD: z.string().default('0.85').transform((val) => parseFloat(val)),
  FRAUD_SCORE_FLAG_THRESHOLD: z.string().default('0.50').transform((val) => parseFloat(val)),

  VELOCITY_MAX_TXN_PER_IP_PER_HOUR: z.string().default('20').transform((val) => parseInt(val, 10)),
  VELOCITY_MAX_TXN_PER_USER_PER_DAY: z.string().default('50').transform((val) => parseInt(val, 10)),
  VELOCITY_MAX_AMOUNT_CENTS_PER_USER_PER_DAY: z.string().default('1000000').transform((val) => parseInt(val, 10)),
  VELOCITY_HARD_BLOCK_AMOUNT_CENTS_PER_USER_PER_DAY: z.string().default('5000000').transform((val) => parseInt(val, 10)),

  RECONCILIATION_CRON: z.string().default('*/5 * * * *'),
  PAYOUT_CRON: z.string().default('0 2 * * *'),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.string().default('5000').transform((val) => parseInt(val, 10)),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ FATAL: Invalid environment variables.');
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;