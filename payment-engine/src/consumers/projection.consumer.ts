import Decimal from 'decimal.js';
import { Worker, Job } from 'bullmq';
import { TransactionEventType } from '@prisma/client';

import prisma from '../config/database';
import { createBullMQConnection } from '../config/redis';
import logger from '../utils/logger';
import { QUEUE_NAMES, TransactionEventJobData } from '../types';

const CONSUMER_GROUP = 'projection-updater';

const CREDIT_EVENTS = new Set<string>([
  TransactionEventType.DEPOSIT_COMPLETED,
  TransactionEventType.REFUND_COMPLETED,

  TransactionEventType.TRANSFER_CREDIT,
]);

const DEBIT_EVENTS = new Set<string>([
  TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,

  TransactionEventType.TRANSFER_DEBIT,
]);

const IGNOREABLE_EVENTS = new Set<string>([
  TransactionEventType.INITIALIZED,
  TransactionEventType.DEPOSIT_INITIATED,
  TransactionEventType.GATEWAY_CHARGE_FAILED,
  TransactionEventType.PAYMENT_COMPLETED,
  TransactionEventType.PAYMENT_FAILED,
  TransactionEventType.FRAUD_FLAGGED,
  TransactionEventType.FRAUD_CLEARED,
  TransactionEventType.REFUND_INITIATED,
  TransactionEventType.PAYOUT_INITIATED,
  TransactionEventType.PAYOUT_COMPLETED,
  TransactionEventType.PAYOUT_FAILED,
]);

async function processProjectionEvent(
  job: Job<TransactionEventJobData>,
): Promise<void> {
  const jobData = job.data;

const isRazorpayTopUp = (
  jobData.eventType === TransactionEventType.GATEWAY_CHARGE_SUCCEEDED &&
  jobData.metadata?.isTopUp === true
);

const isCredit = CREDIT_EVENTS.has(jobData.eventType) || isRazorpayTopUp;
const isDebit  = DEBIT_EVENTS.has(jobData.eventType) && !isRazorpayTopUp;

  if (IGNOREABLE_EVENTS.has(jobData.eventType)) {
    logger.debug(
      { eventId: jobData.eventId, eventType: jobData.eventType },
      'Projection consumer: skipping ignoreable event type',
    );
    return;
  }

  if (!isCredit && !isDebit) {

    logger.warn(
      { eventId: jobData.eventId, eventType: jobData.eventType },
      'Projection consumer: unrecognised event type — skipping',
    );
    return;
  }

  const amountDecimal = new Decimal(jobData.amount);

  const amountStr = amountDecimal.toFixed(8);

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: {
      eventId_consumerGroup: {
        eventId:       jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
      },
    },
  });

  if (alreadyProcessed) {
    logger.info(
      {
        eventId:       jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
        processedAt:   alreadyProcessed.processedAt.toISOString(),
      },
      'Projection consumer: event already processed — skipping (idempotent)',
    );
    return;
  }

  let affectedRows = 0;

  await prisma.$transaction(async (tx) => {

    await tx.processedEvent.create({
      data: {
        eventId:       jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
      },
    });

    if (isCredit) {
      affectedRows = await tx.$executeRaw`
        UPDATE wallet_projections
        SET
          balance             = balance            + ${amountStr}::DECIMAL(20, 8),
          total_credited      = total_credited     + ${amountStr}::DECIMAL(20, 8),
          transaction_count   = transaction_count  + 1,
          last_transaction_at = NOW(),
          last_event_id       = ${jobData.eventId},
          updated_at          = NOW()
        WHERE wallet_id       = ${jobData.walletId}
      `;
    } else {

      affectedRows = await tx.$executeRaw`
        UPDATE wallet_projections
        SET
          balance             = balance            - ${amountStr}::DECIMAL(20, 8),
          total_debited       = total_debited      + ${amountStr}::DECIMAL(20, 8),
          transaction_count   = transaction_count  + 1,
          last_transaction_at = NOW(),
          last_event_id       = ${jobData.eventId},
          updated_at          = NOW()
        WHERE wallet_id       = ${jobData.walletId}
      `;
    }
  });

  if (affectedRows === 0) {
    logger.error(
      {
        walletId:  jobData.walletId,
        userId:    jobData.userId,
        eventId:   jobData.eventId,
        eventType: jobData.eventType,
      },
      'Projection consumer: UPDATE affected 0 rows — wallet_projections row missing. ' +
      'This indicates a schema integrity issue. Manual repair required.',
    );
    return;
  }

  logger.info(
    {
      transactionId: jobData.transactionId,
      walletId:      jobData.walletId,
      userId:        jobData.userId,
      eventType:     jobData.eventType,
      operation:     isCredit ? 'CREDIT' : 'DEBIT',
      amount:        amountDecimal.toFixed(2),
      currency:      jobData.currency,
    },
    `Projection updated: wallet_projections ${isCredit ? 'credited' : 'debited'} successfully`,
  );
}

const worker = new Worker<TransactionEventJobData>(
  QUEUE_NAMES.PROJECTION_EVENTS,
  processProjectionEvent,
  {
    connection: createBullMQConnection() as any,
    concurrency: 5,
  },
);

worker.on('completed', (job: Job<TransactionEventJobData>) => {
  logger.info(
    {
      jobId:         job.id,
      transactionId: job.data.transactionId,
      eventType:     job.data.eventType,
    },
    'Projection updater: job completed',
  );
});

worker.on(
  'failed',
  (job: Job<TransactionEventJobData> | undefined, err: Error) => {

    logger.error(
      {
        jobId:         job?.id,
        transactionId: job?.data?.transactionId,
        walletId:      job?.data?.walletId,
        eventType:     job?.data?.eventType,
        err,
      },
      'Projection updater: job permanently failed — wallet_projections may be stale.',
    );
  },
);

worker.on('error', (err: Error) => {
  logger.error({ err }, 'Projection consumer: Redis connection error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Projection consumer: shutdown signal received');
  await worker.close();
  await prisma.$disconnect();
  logger.info('Projection consumer: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Projection consumer: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Projection consumer: uncaught exception — crashing');
  process.exit(1);
});

logger.info(
  { queue: QUEUE_NAMES.PROJECTION_EVENTS, concurrency: 5 },
  'Projection Updater Consumer started',
);