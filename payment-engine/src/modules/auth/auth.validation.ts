import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .email('Must be a valid email address')
      .toLowerCase(),

    password: z
      .string({ message: 'Password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password cannot exceed 72 characters'),

    name: z
      .string({ message: 'Name is required' })
      .min(1, 'Name cannot be empty')
      .max(100, 'Name cannot exceed 100 characters')
      .trim(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .email('Must be a valid email address')
      .toLowerCase(),

    password: z
      .string({ message: 'Password is required' })
      .min(1, 'Password is required'),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];