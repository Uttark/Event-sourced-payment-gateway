import crypto from 'crypto';
import Decimal from 'decimal.js';
import { TransactionEventType, Currency, WalletStatus } from '@prisma/client';
import prisma from '../../config/database';
import {
  transactionEventsQueue,
  projectionEventsQueue,
  ledgerEventsQueue,
} from '../../config/queue';
import { AppError, TransactionEventJobData } from '../../types';
import logger from '../../utils/logger';
import { acquireWalletLock, releaseWalletLock } from '../../utils/redis-lock';
import * as walletRepository from './wallet.repository';

export async function createWallet(
  userId: string,
  currency: Currency,
) {

  const existingWallet = await prisma.wallet.findFirst({
    where: { userId, currency },
    select: { id: true },
  });

  if (existingWallet) {
    throw new AppError(
      `You already have a ${currency} wallet.`,
      409,
      'WALLET_ALREADY_EXISTS',
    );
  }

  const wallet = await walletRepository.createWallet(userId, currency);

  logger.info({ userId, walletId: wallet.id, currency }, 'Wallet created');

  return wallet;
}

export async function getWallets(userId: string) {

  const [wallets, projections] = await Promise.all([
    walletRepository.findWalletsByUserId(userId),
    walletRepository.findProjectionsByUserId(userId),
  ]);

  const projectionMap = new Map(projections.map((p) => [p.walletId, p]));

  return wallets.map((wallet) => {
    const projection = projectionMap.get(wallet.id);
    return {
      id: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      status: wallet.status,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
      stats: projection
        ? {
            totalCredited: projection.totalCredited.toString(),
            totalDebited: projection.totalDebited.toString(),
            transactionCount: projection.transactionCount,
            lastTransactionAt: projection.lastTransactionAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}

export async function getWalletById(userId: string, walletId: string) {
  const wallet = await walletRepository.findWalletByIdAndUserId(walletId, userId);

  if (!wallet) {
    throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
  }

  const projection = await walletRepository.findProjectionByWalletId(walletId);

  return {
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency,
    balance: wallet.balance.toString(),
    status: wallet.status,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
    stats: projection
      ? {
          totalCredited: projection.totalCredited.toString(),
          totalDebited: projection.totalDebited.toString(),
          transactionCount: projection.transactionCount,
          lastTransactionAt: projection.lastTransactionAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function deposit(
  userId: string,
  walletId: string,
  amount: number,
  description?: string,
): Promise<{ wallet: Awaited<ReturnType<typeof getWalletById>>; transactionId: string }> {

  const walletCheck = await walletRepository.findWalletByIdAndUserId(walletId, userId);

  if (!walletCheck) {
    throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
  }

  if (walletCheck.status !== 'ACTIVE') {
    throw new AppError(
      `Cannot deposit into a ${walletCheck.status.toLowerCase()} wallet.`,
      403,
      'WALLET_NOT_ACTIVE',
    );
  }

  const depositDecimal = new Decimal(amount.toString());

  const transactionId = crypto.randomUUID();

  let lockValue: string | null = null;

  let depositEventId: string | null = null;
  let depositEventCreatedAt: Date | null = null;

  try {
    lockValue = await acquireWalletLock(walletId);

    await prisma.$transaction(async (tx) => {

      const lockedWallet = await walletRepository.lockWalletForUpdate(walletId, tx);

      if (!lockedWallet) {
        throw new AppError('Wallet not found', 404, 'WALLET_NOT_FOUND');
      }

      if (lockedWallet.status !== 'ACTIVE') {
        throw new AppError(
          `Cannot deposit into a ${lockedWallet.status.toLowerCase()} wallet.`,
          403,
          'WALLET_NOT_ACTIVE',
        );
      }

      await walletRepository.incrementWalletBalance(walletId, depositDecimal, tx);

      const depositEvent = await tx.transactionEvent.create({
        data: {
          transactionId,
          walletId,
          userId,
          eventType: TransactionEventType.DEPOSIT_COMPLETED,
          amount: depositDecimal,
          currency: walletCheck.currency,
          metadata: {
            description: description ?? 'Deposit',
            source: 'INTERNAL',
          },
        },
      });

      depositEventId = depositEvent.eventId;
      depositEventCreatedAt = depositEvent.createdAt;
    });

    if (depositEventId && depositEventCreatedAt) {
      const jobData: TransactionEventJobData = {
        eventId: depositEventId,
        transactionId,
        walletId,
        userId,
        eventType: TransactionEventType.DEPOSIT_COMPLETED,
        amount: depositDecimal.toFixed(8),
        currency: walletCheck.currency,
        gatewayOrderId: null,
        gatewayPaymentId: null,
        idempotencyKey: null,
        fraudScore: null,
        metadata: { description: description ?? 'Deposit', source: 'INTERNAL' },

        createdAt: (depositEventCreatedAt as Date).toISOString(),
      };

await Promise.all([
  transactionEventsQueue.add(TransactionEventType.DEPOSIT_COMPLETED, jobData),
  projectionEventsQueue.add(TransactionEventType.DEPOSIT_COMPLETED, jobData),
]);
    }

    logger.info(
      { userId, walletId, transactionId, amount: depositDecimal.toString(), currency: walletCheck.currency },
      'Deposit completed successfully',
    );

    const updatedWallet = await getWalletById(userId, walletId);
    return { wallet: updatedWallet, transactionId };

  } finally {

    if (lockValue) {
      await releaseWalletLock(walletId, lockValue);
    }
  }
}

export async function transferFunds(
  senderUserId: string,
  senderWalletId: string,
  recipientWalletId: string,
  amount: number,
  description?: string,
) {
  if (senderWalletId === recipientWalletId) {
    throw new AppError(
      'Cannot transfer to the same wallet.',
      400,
      'SAME_WALLET_TRANSFER',
    );
  }

  const amountDecimal = new Decimal(amount.toString());

  const senderWallet = await walletRepository.findWalletByIdAndUserId(
    senderWalletId,
    senderUserId,
  );

  if (!senderWallet) {
    throw new AppError('Sender wallet not found.', 404, 'WALLET_NOT_FOUND');
  }

  if (senderWallet.status !== WalletStatus.ACTIVE) {
    throw new AppError(
      `Sender wallet is ${senderWallet.status.toLowerCase()}.`,
      403,
      'WALLET_NOT_ACTIVE',
    );
  }

  const recipientWallet = await prisma.wallet.findUnique({
    where: { id: recipientWalletId },
  });

  if (!recipientWallet) {
    throw new AppError(
      'Recipient wallet not found. Check the wallet ID and try again.',
      404,
      'RECIPIENT_WALLET_NOT_FOUND',
    );
  }

  if (recipientWallet.status !== WalletStatus.ACTIVE) {
    throw new AppError(
      `Recipient wallet is ${recipientWallet.status.toLowerCase()} and cannot receive funds.`,
      422,
      'RECIPIENT_WALLET_NOT_ACTIVE',
    );
  }

  if (senderWallet.currency !== recipientWallet.currency) {
    throw new AppError(
      `Currency mismatch: your wallet is ${senderWallet.currency} but the recipient's is ${recipientWallet.currency}. Cross-currency transfers are not yet supported.`,
      422,
      'CURRENCY_MISMATCH',
    );
  }

  const transactionId = crypto.randomUUID();

  const [firstLockId, secondLockId] = [senderWalletId, recipientWalletId].sort();

  let firstLock:  string | null = null;
  let secondLock: string | null = null;

  let debitEventId:         string | null = null;
  let debitEventCreatedAt:  Date   | null = null;
  let creditEventId:        string | null = null;
  let creditEventCreatedAt: Date   | null = null;

  try {
    firstLock  = await acquireWalletLock(firstLockId);
    secondLock = await acquireWalletLock(secondLockId);

    await prisma.$transaction(async (tx) => {

      const firstLockedRow  = await walletRepository.lockWalletForUpdate(firstLockId,  tx);
      const secondLockedRow = await walletRepository.lockWalletForUpdate(secondLockId, tx);

      const lockedSender    = firstLockId === senderWalletId    ? firstLockedRow  : secondLockedRow;
      const lockedRecipient = firstLockId === recipientWalletId ? firstLockedRow  : secondLockedRow;

      if (!lockedSender) {
        throw new AppError('Sender wallet disappeared during lock.', 404, 'WALLET_NOT_FOUND');
      }
      if (!lockedRecipient) {
        throw new AppError('Recipient wallet disappeared during lock.', 404, 'RECIPIENT_WALLET_NOT_FOUND');
      }

      if (lockedSender.status !== 'ACTIVE') {
        throw new AppError(
          `Sender wallet became ${lockedSender.status.toLowerCase()} during processing.`,
          403,
          'WALLET_NOT_ACTIVE',
        );
      }
      if (lockedRecipient.status !== 'ACTIVE') {
        throw new AppError(
          `Recipient wallet became ${lockedRecipient.status.toLowerCase()} during processing.`,
          422,
          'RECIPIENT_WALLET_NOT_ACTIVE',
        );
      }

      const lockedSenderBalance = new Decimal(lockedSender.balance);
      if (lockedSenderBalance.lessThan(amountDecimal)) {
        throw new AppError(
          `Insufficient funds. Available: ${lockedSenderBalance.toFixed(2)} ${senderWallet.currency}, Required: ${amountDecimal.toFixed(2)}.`,
          422,
          'INSUFFICIENT_FUNDS',
        );
      }

      await walletRepository.decrementWalletBalance(senderWalletId,    amountDecimal, tx);
      await walletRepository.incrementWalletBalance(recipientWalletId, amountDecimal, tx);

      const debitEvent = await tx.transactionEvent.create({
        data: {
          transactionId,
          walletId:  senderWalletId,
          userId:    senderUserId,
          eventType: TransactionEventType.TRANSFER_DEBIT,
          amount:    amountDecimal,
          currency:  senderWallet.currency as Currency,
          metadata: {
            recipientWalletId,
            recipientUserId: recipientWallet.userId,
            description:     description ?? null,
          },
        },
      });

      const creditEvent = await tx.transactionEvent.create({
        data: {
          transactionId,
          walletId:  recipientWalletId,
          userId:    recipientWallet.userId,
          eventType: TransactionEventType.TRANSFER_CREDIT,
          amount:    amountDecimal,
          currency:  recipientWallet.currency as Currency,
          metadata: {
            senderWalletId,
            senderUserId,
            description: description ?? null,
          },
        },
      });

      debitEventId         = debitEvent.eventId;
      debitEventCreatedAt  = debitEvent.createdAt;
      creditEventId        = creditEvent.eventId;
      creditEventCreatedAt = creditEvent.createdAt;
    });

    const finalDebitEventId   = debitEventId        as unknown as string;
    const finalDebitCreatedAt = (debitEventCreatedAt as unknown as Date).toISOString();

    const finalCreditEventId   = creditEventId       as unknown as string;
    const finalCreditCreatedAt = (creditEventCreatedAt as unknown as Date).toISOString();

    const transferDebitJobData: TransactionEventJobData = {
      eventId:          finalDebitEventId,
      transactionId,
      walletId:         senderWalletId,
      userId:           senderUserId,
      eventType:        String(TransactionEventType.TRANSFER_DEBIT),
      amount:           amountDecimal.toFixed(8),
      currency:         String(senderWallet.currency),
      gatewayOrderId:   null,
      gatewayPaymentId: null,
      idempotencyKey:   null,
      fraudScore:       null,
      metadata: { recipientWalletId, description: description ?? null },
      createdAt:        finalDebitCreatedAt,
    };

    const transferCreditJobData: TransactionEventJobData = {
      eventId:          finalCreditEventId,
      transactionId,
      walletId:         recipientWalletId,
      userId:           recipientWallet.userId,
      eventType:        String(TransactionEventType.TRANSFER_CREDIT),
      amount:           amountDecimal.toFixed(8),
      currency:         String(recipientWallet.currency),
      gatewayOrderId:   null,
      gatewayPaymentId: null,
      idempotencyKey:   null,
      fraudScore:       null,
      metadata: { senderWalletId, description: description ?? null },
      createdAt:        finalCreditCreatedAt,
    };

    await Promise.all([
      transactionEventsQueue.add(String(TransactionEventType.TRANSFER_DEBIT), transferDebitJobData),
      ledgerEventsQueue.add(String(TransactionEventType.TRANSFER_DEBIT),      transferDebitJobData),
      projectionEventsQueue.add(String(TransactionEventType.TRANSFER_DEBIT),  transferDebitJobData),

      transactionEventsQueue.add(String(TransactionEventType.TRANSFER_CREDIT), transferCreditJobData),
      ledgerEventsQueue.add(String(TransactionEventType.TRANSFER_CREDIT),      transferCreditJobData),
      projectionEventsQueue.add(String(TransactionEventType.TRANSFER_CREDIT),  transferCreditJobData),
    ]);

    logger.info(
      {
        transactionId,
        senderWalletId,
        recipientWalletId,
        amount: amountDecimal.toFixed(2),
        currency: String(senderWallet.currency),
      },
      'Transfer completed: both wallets updated atomically',
    );

    return {
      transactionId,
      senderWalletId,
      recipientWalletId,
      amount:    amountDecimal.toFixed(8),
      currency:  String(senderWallet.currency),
      eventType: String(TransactionEventType.TRANSFER_DEBIT),
      createdAt: finalDebitCreatedAt,
    };

  } finally {

    if (secondLock !== null) await releaseWalletLock(secondLockId, secondLock);
    if (firstLock  !== null) await releaseWalletLock(firstLockId,  firstLock);
  }
}