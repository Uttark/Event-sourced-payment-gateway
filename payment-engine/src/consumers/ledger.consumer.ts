import Decimal from 'decimal.js';
import { Worker, Job } from 'bullmq';
import { TransactionEventType, Currency } from '@prisma/client';

import prisma from '../config/database';
import { createBullMQConnection } from '../config/redis';
import logger from '../utils/logger';
import { QUEUE_NAMES, TransactionEventJobData } from '../types';

const CONSUMER_GROUP = 'ledger-writer';

const SEALABLE_EVENTS = new Set<string>([
  TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
]);

async function processLedgerEvent(
  job: Job<TransactionEventJobData>,
): Promise<void> {
  const jobData = job.data;

  if (!SEALABLE_EVENTS.has(jobData.eventType)) {
    logger.debug(
      { eventId: jobData.eventId, eventType: jobData.eventType },
      'Ledger consumer: skipping non-sealable event type',
    );
    return;
  }

  const amountDecimal = new Decimal(jobData.amount);

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: {
      eventId_consumerGroup: {
        eventId: jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
      },
    },
  });

  if (alreadyProcessed) {
    logger.info(
      {
        eventId: jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
        processedAt: alreadyProcessed.processedAt.toISOString(),
      },
      'Ledger consumer: event already processed — skipping (idempotent)',
    );
    return;
  }

  let completedEventId: string | null = null;
  let completedEventCreatedAt: Date | null = null;

  await prisma.$transaction(async (tx) => {

    await tx.processedEvent.create({
      data: {
        eventId:       jobData.eventId,
        consumerGroup: CONSUMER_GROUP,
      },
    });

    const completedEvent = await tx.transactionEvent.create({
      data: {
        transactionId:    jobData.transactionId,
        walletId:         jobData.walletId,
        userId:           jobData.userId,
        eventType:        TransactionEventType.PAYMENT_COMPLETED,
        amount:           amountDecimal,
        currency:         jobData.currency as Currency,
        gatewayOrderId:   jobData.gatewayOrderId,
        gatewayPaymentId: jobData.gatewayPaymentId,
        metadata: {
          sealedFromEventId: jobData.eventId,
          fraudFlagged:      jobData.metadata?.fraudFlagged ?? false,
          description:       jobData.metadata?.description ?? null,
        },
      },
    });

    completedEventId       = completedEvent.eventId;
    completedEventCreatedAt = completedEvent.createdAt;
  });

  const finalEventId   = completedEventId      as unknown as string;
  const finalCreatedAt = (completedEventCreatedAt as unknown as Date).toISOString();

  logger.info(
    {
      transactionId:    jobData.transactionId,
      walletId:         jobData.walletId,
      userId:           jobData.userId,
      completedEventId: finalEventId,
      sealedAt:         finalCreatedAt,
      amount:           amountDecimal.toFixed(2),
      currency:         jobData.currency,
    },
    'Ledger: PAYMENT_COMPLETED appended — transaction lifecycle sealed',
  );
}

const worker = new Worker<TransactionEventJobData>(
  QUEUE_NAMES.LEDGER_EVENTS,
  processLedgerEvent,
  {
    connection: createBullMQConnection() as any,
    concurrency: 10,
  },
);

worker.on('completed', (job: Job<TransactionEventJobData>) => {
  logger.info(
    {
      jobId:         job.id,
      transactionId: job.data.transactionId,
    },
    'Ledger writer: job completed',
  );
});

worker.on(
  'failed',
  (job: Job<TransactionEventJobData> | undefined, err: Error) => {

    logger.error(
      {
        jobId:         job?.id,
        transactionId: job?.data?.transactionId,
        eventId:       job?.data?.eventId,
        err,
      },
      'Ledger writer: job permanently failed — PAYMENT_COMPLETED not written. Manual review required.',
    );
  },
);

worker.on('error', (err: Error) => {

  logger.error({ err }, 'Ledger consumer: Redis connection error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Ledger consumer: shutdown signal received');

  await worker.close();
  await prisma.$disconnect();

  logger.info('Ledger consumer: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Ledger consumer: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Ledger consumer: uncaught exception — crashing');
  process.exit(1);
});

logger.info(
  { queue: QUEUE_NAMES.LEDGER_EVENTS, concurrency: 10 },
  'Ledger Writer Consumer started',
);