import { Router, Request, Response } from 'express';
import * as walletService from './wallet.service';
import { authenticate } from '../../middleware/auth.middleware';
import { merchantRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate, asyncHandler } from '../../utils/validate';
import { createWalletSchema, depositSchema, transferSchema } from './wallet.validation';
import { AuthenticatedRequest } from '../../types';

const router = Router();

router.use(authenticate, merchantRateLimiter);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const wallets = await walletService.getWallets(userId);

    res.status(200).json({
      success: true,
      data: { wallets, count: wallets.length },
    });
  }),
);

router.post(
  '/',
  validate(createWalletSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const { currency } = req.body;

    const wallet = await walletService.createWallet(userId, currency);

    res.status(201).json({
      success: true,
      message: `${currency} wallet created successfully`,
      data: { wallet },
    });
  }),
);

router.get(
  '/:walletId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const walletId = req.params.walletId as string;

    const wallet = await walletService.getWalletById(userId, walletId);

    res.status(200).json({
      success: true,
      data: { wallet },
    });
  }),
);

router.post(
  '/:walletId/deposit',
  validate(depositSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;

    const walletId = req.params.walletId as string;
    const { amount, description } = req.body;

    const { wallet, transactionId } = await walletService.deposit(
      userId,
      walletId,
      amount,
      description,
    );

    res.status(200).json({
      success: true,
      message: 'Deposit successful',
      data: {
        wallet,
        transaction: {
          transactionId,
          eventType: 'DEPOSIT_COMPLETED',
          amount: amount.toString(),
          currency: wallet.currency,
        },
      },
    });
  }),
);

router.post(
  '/transfer',
  validate(transferSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = (req as AuthenticatedRequest).user;
    const { senderWalletId, recipientWalletId, amount, description } = req.body as {
      senderWalletId:    string;
      recipientWalletId: string;
      amount:            number;
      description?:      string;
    };

    const result = await walletService.transferFunds(
      userId,
      senderWalletId,
      recipientWalletId,
      amount,
      description,
    );

    res.status(200).json({
      success: true,
      message: `${result.currency} ${parseFloat(result.amount).toFixed(2)} transferred successfully.`,
      data: result,
    });
  }),
);

export default router;