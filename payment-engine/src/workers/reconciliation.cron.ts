import crypto from 'crypto';
import cron from 'node-cron';
import Decimal from 'decimal.js';
import { TransactionEventType, Currency } from '@prisma/client';

import prisma from '../config/database';
import redisClient from '../config/redis';
import { env } from '../config/env';
import logger from '../utils/logger';
import { acquireWalletLock, releaseWalletLock } from '../utils/redis-lock';
import { findStaleInitializedTransactions } from '../modules/transaction/transaction.repository';
import { capturePayment } from '../gateway/razorpay.gateway';
import {
  lockWalletForUpdate,
  decrementWalletBalance,
} from '../modules/wallet/wallet.repository';

const RECONCILIATION_LOCK_KEY = 'lock:reconciliation';
const RECONCILIATION_LOCK_TTL_MS = 300_000;
const STALE_THRESHOLD_MINUTES = 3;

async function runReconciliation(): Promise<void> {
  const lockValue = `${process.pid}:${Date.now()}`;

  const acquired = await (redisClient.set as any)(
    RECONCILIATION_LOCK_KEY,
    lockValue,
    'NX',
    'PX',
    RECONCILIATION_LOCK_TTL_MS,
  );

  if (!acquired) {
    logger.info(
      'Reconciliation: lock held by another instance — skipping this run',
    );
    return;
  }

  try {
    logger.info({ thresholdMinutes: STALE_THRESHOLD_MINUTES }, 'Reconciliation: starting run');

    const staleTransactions = await findStaleInitializedTransactions(
      STALE_THRESHOLD_MINUTES,
    );

    if (staleTransactions.length === 0) {
      logger.info('Reconciliation: no stale transactions found — system is healthy');
      return;
    }

    logger.warn(
      { count: staleTransactions.length },
      'Reconciliation: stale INITIALIZED transactions found — investigating',
    );

    for (const staleTx of staleTransactions) {
      await reconcileOneTransaction(
        staleTx.transaction_id,
        staleTx.gateway_order_id,
      );
    }

    logger.info(
      { processed: staleTransactions.length },
      'Reconciliation: run complete',
    );
  } catch (err) {
    logger.error({ err }, 'Reconciliation: unexpected error during run');
  } finally {
    await redisClient.del(RECONCILIATION_LOCK_KEY);
  }
}

async function reconcileOneTransaction(
  transactionId: string,
  gatewayOrderId: string,
): Promise<void> {

  const initializedEvent = await prisma.transactionEvent.findFirst({
    where: {
      transactionId,
      eventType: TransactionEventType.INITIALIZED,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!initializedEvent) {
    logger.error(
      { transactionId },
      'Reconciliation: INITIALIZED event missing for stale transaction — cannot reconcile',
    );
    return;
  }

  const amount = new Decimal(initializedEvent.amount.toString());
  const { walletId, userId, currency } = initializedEvent;

  let gatewayStatus = 'unknown';
  let gatewayPaymentId: string | null = null;

  if (env.MOCK_GATEWAY) {

    const decimalPart = amount.minus(amount.floor());
    const isSimulatedFailure = decimalPart.toFixed(2) === '0.99';

    gatewayStatus = isSimulatedFailure ? 'failed' : 'paid';

    if (!isSimulatedFailure) {

      const suffix = crypto
        .randomUUID()
        .replace(/-/g, '')
        .substring(0, 12)
        .toUpperCase();
      gatewayPaymentId = `pay_RECON${suffix}`;
    }
  } else {

    try {
      const chargeResult = await capturePayment({
        gatewayOrderId,
        amount,
        currency: currency as string,
      });

      if (chargeResult.success && chargeResult.gatewayPaymentId) {
        gatewayStatus = 'paid';
        gatewayPaymentId = chargeResult.gatewayPaymentId;
      } else {
        gatewayStatus = 'failed';
      }
    } catch (err) {
      logger.error(
        { err, transactionId, gatewayOrderId },
        'Reconciliation: gateway query failed — will retry on next cron run',
      );

      await logReconciliation(transactionId, gatewayOrderId, 'error', 'STILL_PENDING');
      return;
    }
  }

  let actionTaken: string;

  if (gatewayStatus === 'paid' && gatewayPaymentId) {

    let walletLock: string | null = null;

    try {
      walletLock = await acquireWalletLock(walletId);

      let chargeEventId: string | null = null;

      await prisma.$transaction(async (tx) => {
        const lockedWallet = await lockWalletForUpdate(walletId, tx);

        if (!lockedWallet) {
          throw new Error(`Wallet ${walletId} not found during reconciliation`);
        }

        if (lockedWallet.status !== 'ACTIVE') {
          throw new Error(
            `Wallet ${walletId} is ${lockedWallet.status} — cannot reconcile charge`,
          );
        }

        const lockedBalance = new Decimal(lockedWallet.balance);

        if (lockedBalance.lessThan(amount)) {

          throw new Error(
            `Reconciliation balance shortfall: wallet has ${lockedBalance.toFixed(2)} ` +
              `but charge was ${amount.toFixed(2)} — manual refund required`,
          );
        }

        await decrementWalletBalance(walletId, amount, tx);

        const chargeEvent = await tx.transactionEvent.create({
          data: {
            transactionId,
            walletId,
            userId,
            eventType: TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
            amount,
            currency: currency as Currency,
            gatewayOrderId,
            gatewayPaymentId,
            metadata: {
              reconciledAt: new Date().toISOString(),
              source: 'RECONCILIATION_CRON',
            },
          },
        });

        chargeEventId = chargeEvent.eventId;

        await tx.transactionEvent.create({
          data: {
            transactionId,
            walletId,
            userId,
            eventType: TransactionEventType.PAYMENT_COMPLETED,
            amount,
            currency: currency as Currency,
            gatewayOrderId,
            gatewayPaymentId,
            metadata: {
              sealedFromEventId: chargeEvent.eventId,
              reconciledAt: new Date().toISOString(),
              source: 'RECONCILIATION_CRON',
            },
          },
        });
      });

      const finalChargeEventId = chargeEventId as unknown as string;

      actionTaken = 'MARKED_COMPLETED';

      logger.info(
        {
          transactionId,
          gatewayOrderId,
          gatewayPaymentId,
          chargeEventId: finalChargeEventId,
          amount: amount.toFixed(2),
        },
        'Reconciliation: transaction marked COMPLETED — balance deducted',
      );
    } catch (commitErr) {
      logger.error(
        { commitErr, transactionId },
        'Reconciliation: failed to commit success path — manual investigation required',
      );
      actionTaken = 'COMMIT_FAILED';
    } finally {

      if (walletLock !== null) {
        await releaseWalletLock(walletId, walletLock);
      }
    }
  } else {

    try {
      await prisma.$transaction(async (tx) => {
        await tx.transactionEvent.create({
          data: {
            transactionId,
            walletId,
            userId,
            eventType: TransactionEventType.GATEWAY_CHARGE_FAILED,
            amount,
            currency: currency as Currency,
            gatewayOrderId,
            metadata: {
              errorCode: 'RECONCILIATION_GATEWAY_NOT_PAID',
              gatewayStatus,
              reconciledAt: new Date().toISOString(),
              source: 'RECONCILIATION_CRON',
            },
          },
        });

        await tx.transactionEvent.create({
          data: {
            transactionId,
            walletId,
            userId,
            eventType: TransactionEventType.PAYMENT_FAILED,
            amount,
            currency: currency as Currency,
            gatewayOrderId,
            metadata: {
              reason: 'RECONCILIATION_CRON_MARKED_FAILED',
              gatewayStatus,
              reconciledAt: new Date().toISOString(),
              source: 'RECONCILIATION_CRON',
            },
          },
        });
      });

      actionTaken = 'MARKED_FAILED';

      logger.info(
        { transactionId, gatewayOrderId, gatewayStatus },
        'Reconciliation: transaction marked FAILED — no balance change (wallet was never debited)',
      );
    } catch (failErr) {
      logger.error(
        { failErr, transactionId },
        'Reconciliation: failed to write failure events',
      );
      actionTaken = 'COMMIT_FAILED';
    }
  }

  await logReconciliation(transactionId, gatewayOrderId, gatewayStatus, actionTaken);
}

async function logReconciliation(
  transactionId: string,
  gatewayOrderId: string,
  gatewayStatus: string,
  actionTaken: string,
): Promise<void> {
  await prisma.reconciliationLog
    .create({
      data: { transactionId, gatewayOrderId, gatewayStatus, actionTaken },
    })
    .catch((err: unknown) => {

      logger.error(
        { err, transactionId },
        'Reconciliation: failed to write reconciliation_log record',
      );
    });
}

if (!cron.validate(env.RECONCILIATION_CRON)) {
  logger.error(
    { expression: env.RECONCILIATION_CRON },
    'Invalid RECONCILIATION_CRON expression — check your .env file',
  );
  process.exit(1);
}

const reconciliationCronJob = cron.schedule(env.RECONCILIATION_CRON, () => {
  void runReconciliation().catch((err: unknown) => {
    logger.error({ err }, 'Reconciliation: unhandled error in cron callback');
  });
});

logger.info(
  { schedule: env.RECONCILIATION_CRON, staleThresholdMinutes: STALE_THRESHOLD_MINUTES },
  'Reconciliation Cron started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Reconciliation cron: shutdown signal received');
  reconciliationCronJob.destroy();
  await prisma.$disconnect();
  logger.info('Reconciliation cron: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Reconciliation cron: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Reconciliation cron: uncaught exception — crashing');
  process.exit(1);
});