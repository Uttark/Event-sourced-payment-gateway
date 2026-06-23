import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as webhookService from './webhook.service';
import { authenticate } from '../../middleware/auth.middleware';
import { merchantRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate, asyncHandler } from '../../utils/validate';
import { AuthenticatedRequest } from '../../types';

const router = Router();
router.use(authenticate, merchantRateLimiter);

const registerMerchantSchema = z.object({
  body: z.object({
    businessName: z
      .string({ message: 'businessName must be a string' })
      .min(1, 'businessName cannot be empty')
      .max(100, 'businessName cannot exceed 100 characters')
      .trim(),
  }),
});

const registerEndpointSchema = z.object({
  body: z.object({
    url: z
      .string({ message: 'url must be a string' })
      .url('url must be a valid URL (include https://)'),
    eventTypes: z
      .array(z.string({ message: 'each eventType must be a string' }))
      .optional()
      .default([]),
  }),
});

const endpointParamSchema = z.object({
  params: z.object({
    endpointId: z
      .string({ message: 'endpointId must be a string' })
      .uuid('endpointId must be a valid UUID'),
  }),
});

router.post(
  '/merchants',
  validate(registerMerchantSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const { businessName } = req.body as { businessName: string };

    const merchant = await webhookService.registerMerchant(userId, businessName);

    res.status(201).json({
      success: true,
      message:
        'Merchant registered. Store your webhookSecret securely — it cannot be retrieved again.',
      data: { merchant },
    });
  }),
);

router.get(
  '/merchants/me',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const merchant = await webhookService.getMerchant(userId);

    res.status(200).json({
      success: true,
      data: { merchant },
    });
  }),
);

router.post(
  '/endpoints',
  validate(registerEndpointSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const { url, eventTypes } = req.body as {
      url: string;
      eventTypes: string[];
    };

    const endpoint = await webhookService.registerEndpoint(
      userId,
      url,
      eventTypes,
    );

    res.status(201).json({
      success: true,
      message: 'Webhook endpoint registered',
      data: { endpoint },
    });
  }),
);

router.get(
  '/endpoints',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const endpoints = await webhookService.listEndpoints(userId);

    res.status(200).json({
      success: true,
      data: { endpoints, count: endpoints.length },
    });
  }),
);

router.delete(
  '/endpoints/:endpointId',
  validate(endpointParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const endpointId = req.params.endpointId as string;

    await webhookService.deactivateEndpoint(userId, endpointId);

    res.status(200).json({
      success: true,
      message: 'Webhook endpoint deactivated',
      data: null,
    });
  }),
);

export default router;