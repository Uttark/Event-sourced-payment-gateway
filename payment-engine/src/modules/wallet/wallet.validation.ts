import { z } from 'zod';
import { Currency } from '@prisma/client';

export const createWalletSchema = z.object({
  body: z.object({

    currency: z.nativeEnum(Currency, {
      message: `Currency must be one of: ${Object.values(Currency).join(', ')}`,
    }),
  }),
});

export const depositSchema = z.object({
  params: z.object({
    walletId: z.string().uuid('walletId must be a valid UUID'),
  }),
  body: z.object({

    amount: z
      .number({ message: 'Amount is required and must be a number' })
      .positive('Amount must be greater than 0')
      .max(1_000_000, 'Single deposit cannot exceed 1,000,000'),

    description: z
      .string()
      .max(255, 'Description cannot exceed 255 characters')
      .optional(),
  }),
});

export type CreateWalletInput = z.infer<typeof createWalletSchema>['body'];
export type DepositInput = z.infer<typeof depositSchema>['body'];

export const transferSchema = z.object({
  body: z.object({
    senderWalletId: z
      .string({ message: 'senderWalletId must be a string' })
      .uuid('senderWalletId must be a valid UUID'),

    recipientWalletId: z
      .string({ message: 'recipientWalletId must be a string' })
      .uuid('recipientWalletId must be a valid UUID'),

    amount: z
      .number({ message: 'amount must be a positive number' })
      .positive('amount must be greater than 0')
      .max(1_000_000, 'Single transfer cannot exceed 1,000,000'),

    description: z
      .string({ message: 'description must be a string' })
      .max(255, 'description cannot exceed 255 characters')
      .optional(),
  }),
});

export type TransferInput = z.infer<typeof transferSchema>['body'];