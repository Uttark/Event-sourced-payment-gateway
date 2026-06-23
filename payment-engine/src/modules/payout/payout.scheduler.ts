import cron from 'node-cron';
import Decimal from 'decimal.js';
import { PayoutStatus, Currency } from '@prisma/client';

import prisma from '../../config/database';
import redisClient from '../../config/redis';
import { payoutJobsQueue } from '../../config/queue';
import { env } from '../../config/env';
import logger from '../../utils/logger';
import { startPayoutWorker, shutdownPayoutWorker } from './payout.service';

const PAYOUT_SCHEDULER_LOCK_KEY = 'lock:payout-scheduler';
const PAYOUT_SCHEDULER_LOCK_TTL_MS = 300_000;
const MINIMUM_PAYOUT_AMOUNT = new Decimal('10.00');

async function runPayoutSchedule(): Promise<void> {
  const lockValue = `${process.pid}:${Date.now()}`;

  const acquired = await (redisClient.set as any)(
    PAYOUT_SCHEDULER_LOCK_KEY,
    lockValue,
    'NX',
    'PX',
    PAYOUT_SCHEDULER_LOCK_TTL_MS,
  );

  if (!acquired) {
    logger.info(
      'Payout scheduler: lock held by another instance — skipping this run',
    );
    return;
  }

  try {
    logger.info('Payout scheduler: starting scheduled payout run');

    const merchants = await prisma.merchant.findMany({
      select: {
        id: true,
        user: {
          select: {
            id: true,
            wallets: {
              where: { status: 'ACTIVE' },
              select: { id: true, balance: true, currency: true },
            },
          },
        },
      },
    });

    let scheduledCount = 0;

    for (const merchant of merchants) {
      for (const wallet of merchant.user.wallets) {

        const balance = new Decimal(wallet.balance.toString());

        if (balance.lessThan(MINIMUM_PAYOUT_AMOUNT)) continue;

        const existingPayout = await prisma.payout.findFirst({
          where: {
            merchantId: merchant.id,
            currency: wallet.currency,
            status: {
              in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
            },
          },
          select: { id: true },
        });

        if (existingPayout) {
          logger.debug(
            {
              merchantId: merchant.id,
              currency: wallet.currency,
              existingPayoutId: existingPayout.id,
            },
            'Payout scheduler: in-flight payout exists — skipping this wallet',
          );
          continue;
        }

        const payout = await prisma.payout.create({
          data: {
            merchantId: merchant.id,
            amount: balance,
            currency: wallet.currency as Currency,
            status: PayoutStatus.PENDING,
            scheduledAt: new Date(),
          },
        });

        await payoutJobsQueue.add(`payout:${payout.id}`, {
          payoutId: payout.id,
          merchantId: merchant.id,
          amount: balance.toFixed(8),
          currency: wallet.currency as string,
        });

        scheduledCount++;

        logger.info(
          {
            payoutId: payout.id,
            merchantId: merchant.id,
            amount: balance.toFixed(2),
            currency: wallet.currency,
          },
          'Payout scheduler: payout scheduled',
        );
      }
    }

    logger.info(
      { scheduledCount, merchantsChecked: merchants.length },
      'Payout scheduler: run complete',
    );
  } catch (err) {
    logger.error({ err }, 'Payout scheduler: error during scheduled run');
  } finally {

    await redisClient.del(PAYOUT_SCHEDULER_LOCK_KEY);
  }
}

startPayoutWorker();

if (!cron.validate(env.PAYOUT_CRON)) {
  logger.error(
    { expression: env.PAYOUT_CRON },
    'Invalid PAYOUT_CRON expression — check your .env file',
  );
  process.exit(1);
}

const payoutCronJob = cron.schedule(env.PAYOUT_CRON, () => {
  void runPayoutSchedule().catch((err: unknown) => {
    logger.error({ err }, 'Payout scheduler: unhandled error in cron callback');
  });
});

logger.info(
  { schedule: env.PAYOUT_CRON, minimumPayoutAmount: MINIMUM_PAYOUT_AMOUNT.toFixed(2) },
  'Payout Scheduler started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Payout scheduler: shutdown signal received');
  payoutCronJob.destroy();
  await shutdownPayoutWorker();
  await prisma.$disconnect();
  logger.info('Payout scheduler: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Payout scheduler: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Payout scheduler: uncaught exception — crashing');
  process.exit(1);
});