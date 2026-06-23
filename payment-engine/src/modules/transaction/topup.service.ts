import crypto   from 'crypto';
import Decimal  from 'decimal.js';
import { TransactionEventType, Currency } from '@prisma/client';

import prisma                           from '../../config/database';
import { AppError, TransactionEventJobData } from '../../types';
import logger                           from '../../utils/logger';
import { acquireWalletLock, releaseWalletLock } from '../../utils/redis-lock';
import {
  findWalletByIdAndUserId,
  lockWalletForUpdate,
  incrementWalletBalance,
} from '../wallet/wallet.repository';
import {
  createOrder,
  verifyPaymentSignature,
} from '../../services/razorpay.service';
import {
  transactionEventsQueue,
  ledgerEventsQueue,
  projectionEventsQueue,
  webhookEventsQueue,
  fraudEventsQueue,
} from '../../config/queue';

export async function initiateTopUp(
  userId:   string,
  walletId: string,
  amount:   number,
) {

  const wallet = await findWalletByIdAndUserId(walletId, userId);

  if (!wallet) {
    throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
  }

  if (wallet.status !== 'ACTIVE') {
    throw new AppError(
      `Cannot top up a ${wallet.status.toLowerCase()} wallet.`,
      403,
      'WALLET_NOT_ACTIVE',
    );
  }

  const amountDecimal = new Decimal(amount.toString());

  const transactionId = crypto.randomUUID();

  const razorpayOrder = await createOrder(amount, wallet.currency, transactionId);

  await prisma.transactionEvent.create({
    data: {
      transactionId,
      walletId,
      userId,
      eventType:      TransactionEventType.INITIALIZED,
      amount:         amountDecimal,
      currency:       wallet.currency as Currency,
      gatewayOrderId: razorpayOrder.orderId,
      metadata: {
        isTopUp: true,
        source:  'RAZORPAY_TOPUP',
      },
    },
  });

  logger.info(
    { userId, walletId, transactionId, orderId: razorpayOrder.orderId, amount },
    'Top-up initiated: INITIALIZED event written, Razorpay order created',
  );

  return {
    transactionId,
    orderId:  razorpayOrder.orderId,
    amount:   amountDecimal.toFixed(2),
    currency: wallet.currency,
  };
}

export async function verifyTopUp(
  userId:            string,
  walletId:          string,
  razorpayOrderId:   string,
  razorpayPaymentId: string,
  razorpaySignature: string,
) {

  const initializedEvent = await prisma.transactionEvent.findFirst({
    where: {
      walletId,
      userId,
      gatewayOrderId: razorpayOrderId,
      eventType:      TransactionEventType.INITIALIZED,
    },
  });

  if (!initializedEvent) {
    throw new AppError(
      'No pending top-up found for this order ID. ' +
      'The order may belong to a different wallet or may have already been processed.',
      404,
      'TOPUP_ORDER_NOT_FOUND',
    );
  }

  const existingCompletion = await prisma.transactionEvent.findFirst({
    where: {
      transactionId: initializedEvent.transactionId,
      eventType:     TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
    },
  });

  if (existingCompletion) {
    logger.info(
      { transactionId: initializedEvent.transactionId, razorpayOrderId },
      'Top-up verify: duplicate call detected — returning existing result',
    );

    return {
      transactionId:    initializedEvent.transactionId,
      status:           'ALREADY_COMPLETED' as const,
      amount:           initializedEvent.amount.toString(),
      currency:         String(initializedEvent.currency),
      newWalletBalance: null,
    };
  }

  const isSignatureValid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );

  if (!isSignatureValid) {
    logger.warn(
      { userId, walletId, razorpayOrderId },
      'Top-up verify: INVALID signature — possible tampered or forged request',
    );

    throw new AppError(
      'Payment signature is invalid. The payment data may have been tampered with.',
      400,
      'INVALID_PAYMENT_SIGNATURE',
    );
  }

  const amountDecimal = new Decimal(initializedEvent.amount.toString());

  let walletLock: string | null = null;

  let chargeEventId:        string | null = null;
  let chargeEventCreatedAt: Date   | null = null;
  let newBalanceAfterCredit: string | null = null;

  try {
    walletLock = await acquireWalletLock(walletId);

    await prisma.$transaction(async (tx) => {

      const lockedWallet = await lockWalletForUpdate(walletId, tx);

      if (!lockedWallet) {
        throw new AppError('Wallet not found during top-up commit', 404, 'WALLET_NOT_FOUND');
      }

      if (lockedWallet.status !== 'ACTIVE') {
        throw new AppError(
          `Wallet became ${lockedWallet.status.toLowerCase()} during processing.`,
          403,
          'WALLET_NOT_ACTIVE',
        );
      }

      await incrementWalletBalance(walletId, amountDecimal, tx);

      const balanceBeforeCredit   = new Decimal(lockedWallet.balance);
      newBalanceAfterCredit = balanceBeforeCredit.plus(amountDecimal).toFixed(8);

      const chargeEvent = await tx.transactionEvent.create({
        data: {
          transactionId:    initializedEvent.transactionId,
          walletId,
          userId,
          eventType:        TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
          amount:           amountDecimal,
          currency:         initializedEvent.currency,
          gatewayOrderId:   razorpayOrderId,
          gatewayPaymentId: razorpayPaymentId,
          metadata: {
            isTopUp:           true,
            source:            'RAZORPAY_TOPUP',
            signatureVerified: true,
          },
        },
      });

      chargeEventId        = chargeEvent.eventId;
      chargeEventCreatedAt = chargeEvent.createdAt;
    });

    const finalEventId    = chargeEventId        as unknown as string;
    const finalCreatedAt  = (chargeEventCreatedAt as unknown as Date).toISOString();
    const finalBalance    = newBalanceAfterCredit as unknown as string;

    const topUpJobData: TransactionEventJobData = {
      eventId:          finalEventId,
      transactionId:    initializedEvent.transactionId,
      walletId,
      userId,
      eventType:        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
      amount:           amountDecimal.toFixed(8),
      currency:         String(initializedEvent.currency),
      gatewayOrderId:   razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      idempotencyKey:   null,
      fraudScore:       null,
      metadata: {
        isTopUp: true,
        source:  'RAZORPAY_TOPUP',
      },
      createdAt: finalCreatedAt,
    };

    await Promise.all([
      transactionEventsQueue.add(
        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        topUpJobData,
      ),
      ledgerEventsQueue.add(
        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        topUpJobData,
      ),
      projectionEventsQueue.add(
        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        topUpJobData,
      ),
      webhookEventsQueue.add(
        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        topUpJobData,
      ),
      fraudEventsQueue.add(
        String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        topUpJobData,
      ),
    ]);

    logger.info(
      {
        userId,
        walletId,
        transactionId:    initializedEvent.transactionId,
        razorpayOrderId,
        razorpayPaymentId,
        amount:           amountDecimal.toFixed(2),
        currency:         String(initializedEvent.currency),
        newWalletBalance: finalBalance,
      },
      'Top-up completed: wallet credited, async consumers notified',
    );

    return {
      transactionId:    initializedEvent.transactionId,
      status:           'COMPLETED' as const,
      amount:           amountDecimal.toFixed(8),
      currency:         String(initializedEvent.currency),
      newWalletBalance: finalBalance,
      gatewayOrderId:   razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    };

  } finally {

    if (walletLock !== null) {
      await releaseWalletLock(walletId, walletLock);
    }
  }
}