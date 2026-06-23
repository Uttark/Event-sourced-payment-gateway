import crypto from 'crypto';
import Decimal from 'decimal.js';
import { Worker, Job } from 'bullmq';
import { TransactionEventType, PayoutStatus, Currency } from '@prisma/client';

import prisma from '../../config/database';
import { createBullMQConnection } from '../../config/redis';
import { env } from '../../config/env';
import logger from '../../utils/logger';
import { QUEUE_NAMES, PayoutJobData } from '../../types';
import {
  findWalletsByUserId,
  lockWalletForUpdate,
  decrementWalletBalance,
} from '../wallet/wallet.repository';

async function processPayoutJob(job: Job<PayoutJobData>): Promise<void> {
  const { payoutId, merchantId, amount: amountString, currency } = job.data;

  const amountDecimal = new Decimal(amountString);

  logger.info(
    { payoutId, merchantId, amount: amountDecimal.toFixed(2), currency },
    'Payout worker: processing payout',
  );

  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });

  if (!payout) {

    throw new Error(`Payout ${payoutId} not found in database`);
  }

  if (
    payout.status === PayoutStatus.COMPLETED ||
    payout.status === PayoutStatus.FAILED
  ) {
    logger.info(
      { payoutId, status: payout.status },
      'Payout worker: already in terminal state — skipping (idempotent)',
    );
    return;
  }

  await prisma.payout.update({
    where: { id: payoutId },
    data: { status: PayoutStatus.PROCESSING },
  });

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { userId: true },
  });

  if (!merchant) {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: PayoutStatus.FAILED, processedAt: new Date() },
    });
    throw new Error(`Merchant ${merchantId} not found`);
  }

  const wallets = await findWalletsByUserId(merchant.userId);
  const wallet = wallets.find((w) => w.currency === currency);

  if (!wallet) {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: PayoutStatus.FAILED, processedAt: new Date() },
    });
    throw new Error(
      `No ${currency} wallet found for merchant ${merchantId}`,
    );
  }

  let gatewayPayoutId: string | null = null;
  let payoutSuccess = false;
  let gatewayErrorMessage: string | null = null;

  if (env.MOCK_GATEWAY) {

    const suffix = crypto
      .randomUUID()
      .replace(/-/g, '')
      .substring(0, 12)
      .toUpperCase();
    gatewayPayoutId = `pout_MOCK${suffix}`;
    payoutSuccess = true;

    logger.debug({ gatewayPayoutId }, 'Payout worker: mock payout simulated');
  } else {

    try {

      const Razorpay = require('razorpay');
      const rz = new Razorpay({
        key_id: env.RAZORPAY_KEY_ID,
        key_secret: env.RAZORPAY_KEY_SECRET,
      });

      const rzPayout = await rz.payouts.create({
        account_number: env.RAZORPAY_KEY_ID,
        fund_account_id: 'fa_your_fund_account_id',
        amount: amountDecimal.mul(100).floor().toNumber(),
        currency,
        mode: 'NEFT',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: payoutId,
      });

      gatewayPayoutId = rzPayout.id as string;
      payoutSuccess = true;
    } catch (err: unknown) {
      gatewayErrorMessage =
        err instanceof Error ? err.message : 'Razorpay payout failed';
      payoutSuccess = false;
      logger.error({ err, payoutId }, 'Payout worker: Razorpay API error');
    }
  }

  if (payoutSuccess && gatewayPayoutId) {

    let payoutEventTransactionId: string | null = null;

    await prisma.$transaction(async (tx) => {

      const lockedWallet = await lockWalletForUpdate(wallet.id, tx);

      if (!lockedWallet) {
        throw new Error(`Wallet ${wallet.id} not found during payout commit`);
      }

      const lockedBalance = new Decimal(lockedWallet.balance);

      if (lockedBalance.lessThan(amountDecimal)) {
        throw new Error(
          `Insufficient wallet balance for payout: ` +
            `available ${lockedBalance.toFixed(2)}, required ${amountDecimal.toFixed(2)}`,
        );
      }

      await decrementWalletBalance(wallet.id, amountDecimal, tx);

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.COMPLETED,
          processedAt: new Date(),
          gatewayPayoutId,
        },
      });

      const newTxId = crypto.randomUUID();
      payoutEventTransactionId = newTxId;

      await tx.transactionEvent.create({
        data: {
          transactionId: newTxId,
          walletId: wallet.id,
          userId: merchant.userId,
          eventType: TransactionEventType.PAYOUT_COMPLETED,
          amount: amountDecimal,
          currency: payout.currency as Currency,
          metadata: {
            payoutId,
            gatewayPayoutId,
            merchantId,
          },
        },
      });
    });

    const finalTxId = payoutEventTransactionId as unknown as string;

    logger.info(
      {
        payoutId,
        gatewayPayoutId,
        amount: amountDecimal.toFixed(2),
        currency,
        transactionId: finalTxId,
      },
      'Payout worker: payout completed successfully',
    );
  } else {

    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.FAILED, processedAt: new Date() },
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: crypto.randomUUID(),
          walletId: wallet.id,
          userId: merchant.userId,
          eventType: TransactionEventType.PAYOUT_FAILED,
          amount: amountDecimal,
          currency: payout.currency as Currency,
          metadata: {
            payoutId,
            errorMessage: gatewayErrorMessage,
            merchantId,
          },
        },
      });
    });

    logger.error(
      { payoutId, merchantId, errorMessage: gatewayErrorMessage },
      'Payout worker: payout failed',
    );

    throw new Error(`Payout ${payoutId} failed: ${gatewayErrorMessage}`);
  }
}

let _workerInstance: Worker<PayoutJobData> | null = null;

export function startPayoutWorker(): void {
  if (_workerInstance) return;

  _workerInstance = new Worker<PayoutJobData>(
    QUEUE_NAMES.PAYOUT_JOBS,
    processPayoutJob,
    {
      connection: createBullMQConnection() as any,
      concurrency: 3,
    },
  );

  _workerInstance.on('completed', (job: Job<PayoutJobData>) => {
    logger.info(
      { jobId: job.id, payoutId: job.data.payoutId, merchantId: job.data.merchantId },
      'Payout worker: job completed',
    );
  });

  _workerInstance.on(
    'failed',
    (job: Job<PayoutJobData> | undefined, err: Error) => {
      logger.error(
        { jobId: job?.id, payoutId: job?.data?.payoutId, err },
        'Payout worker: job permanently failed after all retries',
      );
    },
  );

  _workerInstance.on('error', (err: Error) => {
    logger.error({ err }, 'Payout worker: Redis connection error');
  });

  logger.info(
    { queue: QUEUE_NAMES.PAYOUT_JOBS, concurrency: 3 },
    'Payout worker started',
  );
}

export async function shutdownPayoutWorker(): Promise<void> {
  if (!_workerInstance) return;
  await _workerInstance.close();
  _workerInstance = null;
  logger.info('Payout worker stopped');
}