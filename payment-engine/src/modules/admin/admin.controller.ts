import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import redisClient from '../../config/redis';
import { env } from '../../config/env';
import logger from '../../utils/logger';
import { AppError } from '../../types';
import { validate, asyncHandler } from '../../utils/validate';
import {
  listDlqItems,
  getDlqStats,
  replayDlqItem,
  resolveDlqItem,
} from '../../workers/dlq.worker';
import {
  findOrphanedTransactions,
  rebuildWalletProjection,
  checkBalanceIntegrity,
} from '../../workers/compensation.worker';

const router = Router();

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const rawKey = req.headers['x-admin-key'];
  const providedKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  if (!providedKey || providedKey !== env.ADMIN_API_KEY) {
    logger.warn(
      { ip: req.ip, path: req.path, hasKey: !!providedKey },
      'Admin auth failure — invalid or missing X-Admin-Key',
    );
    res.status(401).json({
      success: false,
      error: {
        code: 'ADMIN_UNAUTHORIZED',
        message: 'Valid X-Admin-Key header is required for this endpoint.',
      },
    });
    return;
  }

  next();
}

router.use(adminAuth);

const paginationSchema = z.object({
  query: z.object({
    page: z
      .string({ message: 'page must be a string' })
      .optional()
      .default('1')
      .transform((v) => parseInt(v, 10))
      .refine((v) => !isNaN(v) && v >= 1, 'page must be ≥ 1'),

    limit: z
      .string({ message: 'limit must be a string' })
      .optional()
      .default('20')
      .transform((v) => parseInt(v, 10))
      .refine((v) => !isNaN(v) && v >= 1 && v <= 100, 'limit must be 1-100'),

    unresolvedOnly: z
      .string({ message: 'unresolvedOnly must be a string' })
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
  }),
});

const dlqItemParamSchema = z.object({
  params: z.object({
    dlqId: z
      .string({ message: 'dlqId must be a string' })
      .uuid('dlqId must be a valid UUID'),
  }),
});

const setRateLimitSchema = z.object({
  params: z.object({
    merchantId: z
      .string({ message: 'merchantId must be a string' })
      .uuid('merchantId must be a valid UUID'),
  }),
  body: z.object({

    maxRequests: z
      .number({ message: 'maxRequests must be a number' })
      .int('maxRequests must be an integer')
      .min(0, 'maxRequests must be ≥ 0 (0 = blocked)'),

    windowMs: z
      .number({ message: 'windowMs must be a number' })
      .int('windowMs must be an integer')
      .min(1000, 'windowMs must be ≥ 1000ms (1 second)')
      .max(3_600_000, 'windowMs must be ≤ 3600000ms (1 hour)')
      .default(60_000),
  }),
});

const merchantIdParamSchema = z.object({
  params: z.object({
    merchantId: z
      .string({ message: 'merchantId must be a string' })
      .uuid('merchantId must be a valid UUID'),
  }),
});

const rebuildProjectionSchema = z.object({
  body: z.object({
    walletId: z
      .string({ message: 'walletId must be a string' })
      .uuid('walletId must be a valid UUID'),
  }),
});

const integrityCheckSchema = z.object({
  body: z.object({
    walletId: z
      .string({ message: 'walletId must be a string' })
      .uuid('walletId must be a valid UUID')
      .optional(),
  }),
});

router.get(
  '/dlq',
  validate(paginationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as {
      page: number;
      limit: number;
      unresolvedOnly: boolean;
    };

    const result = await listDlqItems(q.page, q.limit, q.unresolvedOnly);

    res.status(200).json({
      success: true,
      data: result,
    });
  }),
);

router.get(
  '/dlq/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await getDlqStats();

    res.status(200).json({
      success: true,
      data: { stats },
    });
  }),
);

router.post(
  '/dlq/:dlqId/replay',
  validate(dlqItemParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const dlqId = req.params.dlqId as string;

    const resolvedBy = `admin:${req.ip ?? 'unknown'}`;

    const result = await replayDlqItem(dlqId, resolvedBy);

    logger.info(
      { dlqId, newDeliveryId: result.newDeliveryId, resolvedBy },
      'Admin: DLQ item replay triggered',
    );

    res.status(200).json({
      success: true,
      message: 'DLQ item queued for replay. Monitor webhook_deliveries for the outcome.',
      data: { dlqId, newDeliveryId: result.newDeliveryId },
    });
  }),
);

router.post(
  '/dlq/:dlqId/resolve',
  validate(dlqItemParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const dlqId = req.params.dlqId as string;
    const resolvedBy = `admin:${req.ip ?? 'unknown'}`;

    await resolveDlqItem(dlqId, resolvedBy);

    logger.info({ dlqId, resolvedBy }, 'Admin: DLQ item manually resolved (no replay)');

    res.status(200).json({
      success: true,
      message: 'DLQ item marked as resolved.',
      data: { dlqId },
    });
  }),
);

router.get(
  '/rate-limits/:merchantId',
  validate(merchantIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.params.merchantId as string;
    const redisKey = `rate:merchant-limit:${merchantId}`;

    const customJson = await redisClient.get(redisKey);

    const isCustom = customJson !== null;
    const effective = isCustom
      ? (JSON.parse(customJson) as { maxRequests: number; windowMs: number })
      : { maxRequests: 100, windowMs: 60_000 };

    res.status(200).json({
      success: true,
      data: {
        merchantId,
        isCustom,
        effective,
        status:
          effective.maxRequests === 0
            ? 'BLOCKED'
            : `${effective.maxRequests} requests per ${effective.windowMs / 1000}s`,
      },
    });
  }),
);

router.post(
  '/rate-limits/:merchantId',
  validate(setRateLimitSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.params.merchantId as string;
    const { maxRequests, windowMs } = req.body as {
      maxRequests: number;
      windowMs: number;
    };

    const redisKey = `rate:merchant-limit:${merchantId}`;
    const limitValue = JSON.stringify({ maxRequests, windowMs });

    await redisClient.set(redisKey, limitValue);

    const statusMessage =
      maxRequests === 0
        ? `BLOCKED — all API access denied`
        : `${maxRequests} requests per ${windowMs / 1000}s`;

    logger.info(
      { merchantId, maxRequests, windowMs, adminIp: req.ip },
      `Admin: rate limit set for merchant — ${statusMessage}`,
    );

    res.status(200).json({
      success: true,
      message: `Rate limit updated: ${statusMessage}`,
      data: { merchantId, maxRequests, windowMs },
    });
  }),
);

router.delete(
  '/rate-limits/:merchantId',
  validate(merchantIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.params.merchantId as string;
    const redisKey = `rate:merchant-limit:${merchantId}`;

    const deletedCount = await redisClient.del(redisKey);

    if (deletedCount === 0) {
      throw new AppError(
        'No custom rate limit found for this merchant (already using system defaults).',
        404,
        'RATE_LIMIT_NOT_FOUND',
      );
    }

    logger.info(
      { merchantId, adminIp: req.ip },
      'Admin: custom rate limit removed — merchant restored to system defaults',
    );

    res.status(200).json({
      success: true,
      message: 'Custom rate limit removed. Merchant restored to system default (100 req/min).',
      data: { merchantId, restoredDefault: { maxRequests: 100, windowMs: 60_000 } },
    });
  }),
);

router.get(
  '/compensation/orphans',
  asyncHandler(async (_req: Request, res: Response) => {
    const orphans = await findOrphanedTransactions();

    if (orphans.length > 0) {
      logger.warn(
        { count: orphans.length },
        'Admin query: orphaned transactions found — compensation worker should heal these',
      );
    }

    res.status(200).json({
      success: true,
      data: {
        count: orphans.length,
        isHealthy: orphans.length === 0,
        orphans: orphans.map((o) => ({
          transactionId:   o.transaction_id,
          sourceEventId:   o.source_event_id,
          walletId:        o.wallet_id,
          amount:          o.amount,
          currency:        o.currency,
          gatewayOrderId:  o.gateway_order_id,
        })),
      },
    });
  }),
);

router.post(
  '/compensation/rebuild-projection',
  validate(rebuildProjectionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.body as { walletId: string };

    const result = await rebuildWalletProjection(walletId);

    logger.info(
      { walletId, adminIp: req.ip, result },
      'Admin: wallet projection rebuild triggered',
    );

    res.status(200).json({
      success: true,
      message: 'Wallet projection rebuilt from event store.',
      data: result,
    });
  }),
);

router.post(
  '/compensation/integrity-check',
  validate(integrityCheckSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.body as { walletId?: string };

    const mismatches = await checkBalanceIntegrity(walletId);

    if (mismatches.length > 0) {
      logger.error(
        {
          mismatchCount: mismatches.length,
          wallets: mismatches.map((m) => m.wallet_id),
          adminIp: req.ip,
        },
        'CRITICAL: Balance integrity check found mismatches — manual investigation required',
      );
    } else {
      logger.info(
        { walletId: walletId ?? 'all', adminIp: req.ip },
        'Balance integrity check passed — all wallets consistent',
      );
    }

    res.status(200).json({
      success: true,
      data: {
        isConsistent: mismatches.length === 0,
        mismatchCount: mismatches.length,
        mismatches: mismatches.map((m) => ({
          walletId:           m.wallet_id,
          authoritativeBalance: m.wallet_balance,
          eventDerivedBalance:  m.calculated_balance,
          difference:           m.difference,
        })),
        message:
          mismatches.length === 0
            ? 'All wallets are consistent.'
            : `${mismatches.length} wallet(s) have balance mismatches. Manual investigation required — do NOT auto-fix.`,
      },
    });
  }),
);

export default router;