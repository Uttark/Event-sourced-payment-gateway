import { z } from 'zod';
import { Currency } from '@prisma/client';

export const createTransactionSchema = z.object({
  body: z.object({
    walletId: z
      .string({ message: 'walletId must be a string' })
      .uuid('walletId must be a valid UUID'),

    amount: z
      .number({ message: 'amount must be a positive number' })
      .positive('amount must be greater than 0')
      .max(1_000_000, 'Single transaction cannot exceed 1,000,000'),

    currency: z.nativeEnum(Currency, {
      message: `currency must be one of: ${Object.values(Currency).join(', ')}`,
    }),

    description: z
      .string({ message: 'description must be a string' })
      .max(255, 'description cannot exceed 255 characters')
      .optional(),
  }),
});

export const getTransactionSchema = z.object({
  params: z.object({
    transactionId: z
      .string({ message: 'transactionId must be a string' })
      .uuid('transactionId must be a valid UUID'),
  }),
});

export const listTransactionsSchema = z.object({
  query: z.object({
    walletId: z
      .string({ message: 'walletId must be a UUID string' })
      .uuid('walletId must be a valid UUID')
      .optional(),

    page: z
      .string({ message: 'page must be a string number' })
      .optional()
      .default('1')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val >= 1, 'page must be at least 1'),

    limit: z
      .string({ message: 'limit must be a string number' })
      .optional()
      .default('20')
      .transform((val) => parseInt(val, 10))
      .refine(
        (val) => !isNaN(val) && val >= 1 && val <= 100,
        'limit must be between 1 and 100',
      ),
  }),
});

export const initiateTopUpSchema = z.object({
  body: z.object({
    walletId: z
      .string({ message: 'walletId must be a string' })
      .uuid('walletId must be a valid UUID'),

    amount: z
      .number({ message: 'amount must be a positive number' })
      .positive('amount must be greater than 0')
      .max(100_000, 'Single top-up cannot exceed 100,000'),
  }),
});

export const verifyTopUpSchema = z.object({
  body: z.object({
    walletId: z
      .string({ message: 'walletId must be a string' })
      .uuid('walletId must be a valid UUID'),

    razorpay_order_id: z
      .string({ message: 'razorpay_order_id must be a string' })
      .min(1, 'razorpay_order_id is required'),

    razorpay_payment_id: z
      .string({ message: 'razorpay_payment_id must be a string' })
      .min(1, 'razorpay_payment_id is required'),

    razorpay_signature: z
      .string({ message: 'razorpay_signature must be a string' })
      .min(1, 'razorpay_signature is required'),
  }),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>['body'];