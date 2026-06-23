import * as topupService                           from './topup.service';
import { initiateTopUpSchema, verifyTopUpSchema }  from './transaction.validation';
import { Router, Request, Response } from 'express';
import * as transactionService from './transaction.service';
import { authenticate } from '../../middleware/auth.middleware';
import { merchantRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate, asyncHandler } from '../../utils/validate';
import {
  createTransactionSchema,
  getTransactionSchema,
  listTransactionsSchema,
} from './transaction.validation';
import { AppError, AuthenticatedRequest } from '../../types';

const router = Router();

router.use(authenticate, merchantRateLimiter);

router.post(
  '/',
  validate(createTransactionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const { walletId, amount, currency, description } = req.body as {
      walletId: string;
      amount: number;
      currency: string;
      description?: string;
    };

    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!idempotencyKey) {
      throw new AppError(
        'Idempotency-Key header is required. Generate a UUID v4 per payment attempt.',
        400,
        'MISSING_IDEMPOTENCY_KEY',
      );
    }

    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidV4Regex.test(idempotencyKey)) {
      throw new AppError(
        'Idempotency-Key must be a valid UUID v4 (e.g. from crypto.randomUUID())',
        400,
        'INVALID_IDEMPOTENCY_KEY_FORMAT',
      );
    }

    const ip = (req.ip ?? req.socket.remoteAddress ?? '0.0.0.0') as string;

    const result = await transactionService.processTransaction(
      userId,
      walletId,
      amount,
      currency as Parameters<typeof transactionService.processTransaction>[3],
      idempotencyKey,
      ip,
      description,
    );

    res.status(result.httpStatus).json({
      success: result.status !== 'FAILED',
      message: result.fromCache
        ? `Returning cached result for idempotency key ${idempotencyKey}`
        : result.status === 'PROCESSING'
        ? 'Transaction is being processed — check status with the transactionId'
        : result.status === 'COMPLETED'
        ? 'Payment processed successfully'
        : 'Payment was declined by the gateway',
      data: result,
    });
  }),
);

router.post(
  '/topup/initiate',
  validate(initiateTopUpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const { walletId, amount } = req.body as {
      walletId: string;
      amount:   number;
    };

    const result = await topupService.initiateTopUp(userId, walletId, amount);

    res.status(200).json({
      success: true,
      message: 'Top-up order created. Pass the orderId to Razorpay checkout.',
      data: result,
    });
  }),
);

router.post(
  '/topup/verify',
  validate(verifyTopUpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const {
      walletId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body as {
      walletId:            string;
      razorpay_order_id:   string;
      razorpay_payment_id: string;
      razorpay_signature:  string;
    };

    const result = await topupService.verifyTopUp(
      userId,
      walletId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    const message = result.status === 'ALREADY_COMPLETED'
      ? 'Top-up was already processed — no changes made.'
      : 'Top-up successful. Your wallet has been credited.';

    res.status(200).json({
      success: true,
      message,
      data: result,
    });
  }),
);

router.get(
  '/',
  validate(listTransactionsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const query = req.query as unknown as {
      walletId?: string;
      page: number;
      limit: number;
    };

    const result = await transactionService.listTransactions(
      userId,
      query.walletId,
      query.page,
      query.limit,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  }),
);

router.get(
  '/:transactionId',
  validate(getTransactionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const transactionId = req.params.transactionId as string;

    const result = await transactionService.getTransactionById(userId, transactionId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }),
);

export default router;