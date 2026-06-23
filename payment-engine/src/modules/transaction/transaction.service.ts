import crypto from 'crypto';
import Decimal from 'decimal.js';
import { TransactionEventType, Currency, WalletStatus } from '@prisma/client';
import prisma from '../../config/database';
import redisClient from '../../config/redis';
import {
  transactionEventsQueue,
  fraudEventsQueue,
  ledgerEventsQueue,
  projectionEventsQueue,
  webhookEventsQueue,
} from '../../config/queue';
import {
  AppError,
  TransactionEventJobData,
  IdempotencyEntry,
  FraudVelocityCheckResult,
} from '../../types';
import { env } from '../../config/env';
import logger from '../../utils/logger';
import { acquireWalletLock, releaseWalletLock } from '../../utils/redis-lock';
import {
  lockWalletForUpdate,
  decrementWalletBalance,
  findWalletByIdAndUserId,
} from '../wallet/wallet.repository';
import {
  insertTransactionEvent,
  findEventsByTransactionId,
  findEventsByWalletId,
  findAllUserEvents,
} from './transaction.repository';
import { createOrder, capturePayment } from '../../gateway/razorpay.gateway';

export interface ProcessTransactionResult {
  transactionId: string;
  status: 'COMPLETED' | 'FAILED' | 'PROCESSING';
  eventType: string;
  amount: string;
  currency: string;
  walletBalance: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  fraudFlagged: boolean;
  createdAt: string;
  fromCache: boolean;
  httpStatus: 200 | 202 | 402;
}

function getHourBucket(): string {

  const n = new Date();
  return (
    String(n.getUTCFullYear()) +
    String(n.getUTCMonth() + 1).padStart(2, '0') +
    String(n.getUTCDate()).padStart(2, '0') +
    String(n.getUTCHours()).padStart(2, '0')
  );
}

function getDayBucket(): string {

  const n = new Date();
  return (
    String(n.getUTCFullYear()) +
    String(n.getUTCMonth() + 1).padStart(2, '0') +
    String(n.getUTCDate()).padStart(2, '0')
  );
}

async function runVelocityChecks(
  userId: string,
  ip: string,
  amountDecimal: Decimal,
): Promise<FraudVelocityCheckResult> {
  const hourBucket = getHourBucket();
  const dayBucket = getDayBucket();

  const ipKey = `fraud:vel:ip:${ip}:${hourBucket}`;
  const userTxnKey = `fraud:vel:user:txn:${userId}:${dayBucket}`;
  const userAmountKey = `fraud:vel:user:amount:${userId}:${dayBucket}`;
  const userFailKey = `fraud:vel:user:fail:${userId}:${hourBucket}`;

  const amountCents = amountDecimal.mul(100).floor().toNumber();

  const [ipCount, userTxnCount, cumulativeAmountCents, failCount] =
    await Promise.all([

      (async () => {
        const count = await redisClient.incr(ipKey);

        if (count === 1) await redisClient.expire(ipKey, 7200);
        return count;
      })(),

      (async () => {
        const count = await redisClient.incr(userTxnKey);
        if (count === 1) await redisClient.expire(userTxnKey, 172800);
        return count;
      })(),

      (async () => {
        const total = await redisClient.incrby(userAmountKey, amountCents);

        if (total === amountCents) await redisClient.expire(userAmountKey, 172800);
        return total;
      })(),

      (async () => {
        const val = await redisClient.get(userFailKey);
        return val ? parseInt(val, 10) : 0;
      })(),
    ]);

  if (ipCount > env.VELOCITY_MAX_TXN_PER_IP_PER_HOUR) {
    return {
      blocked: true,
      flagged: false,
      reason: `IP ${ip} exceeded ${env.VELOCITY_MAX_TXN_PER_IP_PER_HOUR} transactions/hour (count: ${ipCount})`,
      triggeredRule: 'IP_HOURLY_LIMIT',
    };
  }

  if (failCount >= 3) {
    return {
      blocked: true,
      flagged: false,
      reason: `User ${userId} has ${failCount} payment failures this hour (card testing pattern)`,
      triggeredRule: 'USER_HOURLY_FAIL_LIMIT',
    };
  }

  if (cumulativeAmountCents > env.VELOCITY_HARD_BLOCK_AMOUNT_CENTS_PER_USER_PER_DAY) {
    return {
      blocked: true,
      flagged: false,
      reason: `User ${userId} daily volume exceeded hard block threshold`,
      triggeredRule: 'USER_DAILY_AMOUNT_HARD_BLOCK',
    };
  }

  if (userTxnCount > env.VELOCITY_MAX_TXN_PER_USER_PER_DAY) {
    return {
      blocked: false,
      flagged: true,
      reason: `User ${userId} exceeded daily transaction count (${userTxnCount})`,
      triggeredRule: 'USER_DAILY_TXN_LIMIT',
    };
  }

  if (cumulativeAmountCents > env.VELOCITY_MAX_AMOUNT_CENTS_PER_USER_PER_DAY) {
    return {
      blocked: false,
      flagged: true,
      reason: `User ${userId} exceeded daily amount soft threshold`,
      triggeredRule: 'USER_DAILY_AMOUNT_SOFT_FLAG',
    };
  }

  return {
    blocked: false,
    flagged: false,
    reason: 'All velocity checks passed',
    triggeredRule: null,
  };
}

export async function processTransaction(
  userId: string,
  walletId: string,
  amountRaw: number,
  currency: Currency,
  idempotencyKey: string,
  ip: string,
  description?: string,
): Promise<ProcessTransactionResult> {

  const amountDecimal = new Decimal(amountRaw.toString());
  const idempotencyRedisKey = `idempotency:${idempotencyKey}`;

  const idempotencySetResult = await (redisClient.set as any)(
    idempotencyRedisKey,
    'PROCESSING',
    'NX',
    'PX',
    86_400_000,
  );

  if (idempotencySetResult === null) {

    const cachedValue = await redisClient.get(idempotencyRedisKey);

    if (!cachedValue || cachedValue === 'PROCESSING') {

      logger.info({ idempotencyKey }, 'Idempotency: original request still in flight, returning 202');
      return {
        transactionId: '',
        status: 'PROCESSING',
        eventType: '',
        amount: amountDecimal.toFixed(8),
        currency: currency as string,
        walletBalance: null,
        gatewayOrderId: null,
        gatewayPaymentId: null,
        fraudFlagged: false,
        createdAt: new Date().toISOString(),
        fromCache: true,
        httpStatus: 202,
      };
    }

    const cachedEntry = JSON.parse(cachedValue) as IdempotencyEntry;
    logger.info(
      { idempotencyKey, cachedStatus: cachedEntry.status },
      'Idempotency: returning cached terminal result',
    );

    return {
      transactionId: cachedEntry.transactionId ?? '',
      status:
        cachedEntry.status === 'COMPLETED'
          ? 'COMPLETED'
          : cachedEntry.status === 'PROCESSING'
          ? 'PROCESSING'
          : 'FAILED',
      eventType: (cachedEntry.body.eventType as string) ?? '',
      amount: (cachedEntry.body.amount as string) ?? amountDecimal.toFixed(8),
      currency: (cachedEntry.body.currency as string) ?? (currency as string),
      walletBalance: (cachedEntry.body.walletBalance as string) ?? null,
      gatewayOrderId: (cachedEntry.body.gatewayOrderId as string) ?? null,
      gatewayPaymentId: (cachedEntry.body.gatewayPaymentId as string) ?? null,
      fraudFlagged: (cachedEntry.body.fraudFlagged as boolean) ?? false,
      createdAt: (cachedEntry.body.createdAt as string) ?? new Date().toISOString(),
      fromCache: true,

      httpStatus: cachedEntry.httpStatus as 200 | 202 | 402,
    };
  }

  let idempotencyResolved = false;

  let lockValue: string | null = null;

  try {

    lockValue = await acquireWalletLock(walletId);

    const velocityResult = await runVelocityChecks(userId, ip, amountDecimal);

    if (velocityResult.blocked) {
      logger.warn(
        { userId, ip, rule: velocityResult.triggeredRule, reason: velocityResult.reason },
        'Transaction hard-blocked by Tier 1 velocity check',
      );

      await redisClient.del(idempotencyRedisKey);
      idempotencyResolved = true;

      throw new AppError(
        `Transaction blocked: ${velocityResult.reason}`,
        403,
        velocityResult.triggeredRule ?? 'FRAUD_VELOCITY_BLOCK',
      );
    }

    const fraudFlagged = velocityResult.flagged;

    const wallet = await findWalletByIdAndUserId(walletId, userId);

    if (!wallet) {
      await redisClient.del(idempotencyRedisKey);
      idempotencyResolved = true;
      throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
    }

    if (wallet.status !== WalletStatus.ACTIVE) {
      await redisClient.del(idempotencyRedisKey);
      idempotencyResolved = true;
      throw new AppError(
        `Cannot process payment: wallet is ${wallet.status.toLowerCase()}`,
        403,
        'WALLET_NOT_ACTIVE',
      );
    }

    const currentBalance = new Decimal(wallet.balance.toString());

    if (currentBalance.lessThan(amountDecimal)) {
      await redisClient.del(idempotencyRedisKey);
      idempotencyResolved = true;
      throw new AppError(
        `Insufficient funds. Available: ${currentBalance.toFixed(2)} ${currency}, ` +
          `Required: ${amountDecimal.toFixed(2)} ${currency}`,
        422,
        'INSUFFICIENT_FUNDS',
      );
    }

    const transactionId = crypto.randomUUID();

    const orderResult = await createOrder({
      amount: amountDecimal,
      currency: currency as string,
      receipt: transactionId,
    });

    await insertTransactionEvent({
      transactionId,
      walletId,
      userId,
      eventType: TransactionEventType.INITIALIZED,
      amount: amountDecimal,
      currency: currency as string,
      gatewayOrderId: orderResult.gatewayOrderId,
      idempotencyKey,
      metadata: {
        fraudFlagged,
        fraudRule: velocityResult.triggeredRule,
        description: description ?? null,
      },
    });

    await (redisClient.set as any)(
      idempotencyRedisKey,
      JSON.stringify({
        status: 'PROCESSING',
        transactionId,
        httpStatus: 202,
        body: { transactionId },
      } as IdempotencyEntry),
      'XX',
      'PX',
      86_400_000,
    );

    logger.info(
      {
        transactionId,
        gatewayOrderId: orderResult.gatewayOrderId,
        amount: amountDecimal.toFixed(2),
        currency,
        fraudFlagged,
      },
      'Transaction INITIALIZED — attempting gateway capture',
    );

    const chargeResult = await capturePayment({
      gatewayOrderId: orderResult.gatewayOrderId,
      amount: amountDecimal,
      currency: currency as string,
    });

    if (!chargeResult.success) {
      const hourBucket = getHourBucket();
      const failKey = `fraud:vel:user:fail:${userId}:${hourBucket}`;

      const failCount = await redisClient.incr(failKey);
      if (failCount === 1) await redisClient.expire(failKey, 7200);

      const failedEvent = await insertTransactionEvent({
        transactionId,
        walletId,
        userId,
        eventType: TransactionEventType.GATEWAY_CHARGE_FAILED,
        amount: amountDecimal,
        currency: currency as string,
        gatewayOrderId: orderResult.gatewayOrderId,
        gatewayPaymentId: null,
        metadata: {
          errorCode: chargeResult.errorCode,
          errorDescription: chargeResult.errorDescription,
          fraudFlagged,
          consecutiveFailures: failCount,
        },
      });

      const failJobData: TransactionEventJobData = {
        eventId: failedEvent.eventId,
        transactionId,
        walletId,
        userId,
        eventType: String(TransactionEventType.GATEWAY_CHARGE_FAILED),
        amount: amountDecimal.toFixed(8),
        currency: currency as string,
        gatewayOrderId: orderResult.gatewayOrderId,
        gatewayPaymentId: null,
        idempotencyKey,
        fraudScore: null,
        metadata: {
          errorCode: chargeResult.errorCode,
          fraudFlagged,
          consecutiveFailures: failCount,
        },
        createdAt: failedEvent.createdAt.toISOString(),
      };

   await Promise.all([
  transactionEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_FAILED),
    failJobData,
  ),

  webhookEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_FAILED),
    failJobData,
  ),
]);

      const failedEntry: IdempotencyEntry = {
        status: 'FAILED',
        httpStatus: 402,
        transactionId,
        body: {
          transactionId,
          eventType: String(TransactionEventType.GATEWAY_CHARGE_FAILED),
          status: 'FAILED',
          amount: amountDecimal.toFixed(8),
          currency: currency as string,
          walletBalance: currentBalance.toFixed(8),
          gatewayOrderId: orderResult.gatewayOrderId,
          gatewayPaymentId: null,
          fraudFlagged,
          createdAt: failedEvent.createdAt.toISOString(),
        },
      };

      await (redisClient.set as any)(
        idempotencyRedisKey,
        JSON.stringify(failedEntry),
        'XX',
        'PX',
        86_400_000,
      );
      idempotencyResolved = true;

      logger.warn(
        {
          transactionId,
          errorCode: chargeResult.errorCode,
          consecutiveFailures: failCount,
        },
        'Transaction FAILED at gateway',
      );

      throw new AppError(
        chargeResult.errorDescription ?? 'Payment declined by gateway',
        402,
        'PAYMENT_GATEWAY_FAILED',
      );
    }

    let chargeEventId: string | null = null;
    let chargeEventCreatedAt: Date | null = null;
    let balanceAfterDeduction: string | null = null;

    await prisma.$transaction(async (tx) => {

      const lockedWallet = await lockWalletForUpdate(walletId, tx);

      if (!lockedWallet) {
        throw new AppError('Wallet not found during commit', 404, 'WALLET_NOT_FOUND');
      }

      if (lockedWallet.status !== 'ACTIVE') {
        throw new AppError(
          `Wallet became ${lockedWallet.status.toLowerCase()} during processing`,
          403,
          'WALLET_STATUS_CHANGED',
        );
      }

      const lockedBalance = new Decimal(lockedWallet.balance);

      if (lockedBalance.lessThan(amountDecimal)) {
        throw new AppError(
          'Insufficient funds at commit time (balance changed during processing)',
          422,
          'INSUFFICIENT_FUNDS_AT_COMMIT',
        );
      }

      await decrementWalletBalance(walletId, amountDecimal, tx);

      balanceAfterDeduction = lockedBalance.minus(amountDecimal).toFixed(8);

      const chargeEvent = await tx.transactionEvent.create({
        data: {
          transactionId,
          walletId,
          userId,
          eventType: TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
          amount: amountDecimal,
          currency,
          gatewayOrderId: orderResult.gatewayOrderId,
          gatewayPaymentId: chargeResult.gatewayPaymentId,
          metadata: {
            fraudFlagged,
            description: description ?? null,
            fraudRule: velocityResult.triggeredRule,
          },
        },
      });

      chargeEventId = chargeEvent.eventId;
      chargeEventCreatedAt = chargeEvent.createdAt;
    });

    const finalEventId = chargeEventId as unknown as string;
    const finalCreatedAt = (chargeEventCreatedAt as unknown as Date).toISOString();
    const finalBalance = balanceAfterDeduction as unknown as string;

const successJobData: TransactionEventJobData = {
      eventId: finalEventId,
      transactionId,
      walletId,
      userId,
      eventType: String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
      amount: amountDecimal.toFixed(8),
      currency: currency as string,
      gatewayOrderId: orderResult.gatewayOrderId,
      gatewayPaymentId: chargeResult.gatewayPaymentId,
      idempotencyKey,
      fraudScore: null,
      metadata: { fraudFlagged, description: description ?? null },
      createdAt: finalCreatedAt,
    };

await Promise.all([
  transactionEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
    successJobData,
  ),
  fraudEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
    successJobData,
  ),
  ledgerEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
    successJobData,
  ),
  projectionEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
    successJobData,
  ),

  webhookEventsQueue.add(
    String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
    successJobData,
  ),
]);

    const successEntry: IdempotencyEntry = {
      status: 'COMPLETED',
      httpStatus: 200,
      transactionId,
      body: {
        transactionId,
        eventType: String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
        status: 'COMPLETED',
        amount: amountDecimal.toFixed(8),
        currency: currency as string,
        walletBalance: finalBalance,
        gatewayOrderId: orderResult.gatewayOrderId,
        gatewayPaymentId: chargeResult.gatewayPaymentId,
        fraudFlagged,
        createdAt: finalCreatedAt,
      },
    };

    await (redisClient.set as any)(
      idempotencyRedisKey,
      JSON.stringify(successEntry),
      'XX',
      'PX',
      86_400_000,
    );
    idempotencyResolved = true;

    logger.info(
      {
        transactionId,
        gatewayOrderId: orderResult.gatewayOrderId,
        amount: amountDecimal.toFixed(2),
        currency,
        fraudFlagged,
      },
      'Transaction COMPLETED successfully',
    );

    return {
      transactionId,
      status: 'COMPLETED' as const,
      eventType: String(TransactionEventType.GATEWAY_CHARGE_SUCCEEDED),
      amount: amountDecimal.toFixed(8),
      currency: currency as string,
      walletBalance: finalBalance,
      gatewayOrderId: orderResult.gatewayOrderId,
      gatewayPaymentId: chargeResult.gatewayPaymentId,
      fraudFlagged,
      createdAt: finalCreatedAt,
      fromCache: false,
      httpStatus: 200 as const,
    };
  } finally {

    if (lockValue !== null) {
      await releaseWalletLock(walletId, lockValue);
    }

    if (!idempotencyResolved) {
      await redisClient.del(idempotencyRedisKey).catch((err) => {
        logger.error(
          { err, idempotencyKey },
          'Failed to cleanup idempotency key on error — will expire in 24h',
        );
      });
    }
  }

  throw new AppError(
    'Transaction pipeline reached an unexpected state',
    500,
    'INTERNAL_ERROR',
    false,
  );
}

export async function getTransactionById(userId: string, transactionId: string) {
  const events = await findEventsByTransactionId(transactionId);

  if (events.length === 0) {
    throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
  }

  const hasAccess = events.some((e) => e.userId === userId);
  if (!hasAccess) {
    throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
  }

  const latestEvent = events[events.length - 1];

  return {
    transactionId,
    currentStatus: String(latestEvent.eventType),
    walletId: events[0].walletId,
    currency: String(events[0].currency),
    amount: events[0].amount.toString(),
    eventCount: events.length,
    events: events.map((e) => ({
      eventId: e.eventId,
      eventType: String(e.eventType),
      amount: e.amount.toString(),
      currency: String(e.currency),
      gatewayOrderId: e.gatewayOrderId,
      gatewayPaymentId: e.gatewayPaymentId,
      fraudScore: e.fraudScore,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function listTransactions(
  userId: string,
  walletId: string | undefined,
  page: number,
  limit: number,
) {
  const mapEvent = (e: {
    eventId: string;
    transactionId: string;
    eventType: TransactionEventType;
    amount: { toString(): string };
    currency: Currency;
    gatewayOrderId: string | null;
    fraudScore: number | null;
    metadata: unknown;
    createdAt: Date;
  }) => ({
    eventId: e.eventId,
    transactionId: e.transactionId,
    eventType: String(e.eventType),
    amount: e.amount.toString(),
    currency: String(e.currency),
    gatewayOrderId: e.gatewayOrderId,
    fraudScore: e.fraudScore,
    createdAt: e.createdAt.toISOString(),
  });

  if (walletId) {

    const wallet = await findWalletByIdAndUserId(walletId, userId);
    if (!wallet) {
      throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
    }

    const result = await findEventsByWalletId(walletId, userId, page, limit);
    return { events: result.events.map(mapEvent), pagination: result.pagination };
  }

  const result = await findAllUserEvents(userId, page, limit);
  return { events: result.events.map(mapEvent), pagination: result.pagination };
}