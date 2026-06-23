import crypto from 'crypto';
import Decimal from 'decimal.js';
import { Worker, Job } from 'bullmq';
import { TransactionEventType, WalletStatus, Currency } from '@prisma/client';

import prisma from '../config/database';
import { createBullMQConnection } from '../config/redis';
import { webhookEventsQueue } from '../config/queue';
import logger from '../utils/logger';
import { scoreTransaction } from '../utils/fraud-scorer';
import { QUEUE_NAMES, TransactionEventJobData } from '../types';

const CONSUMER_GROUP = 'fraud-scorer';

const FRAUD_SCOREABLE_EVENTS = new Set<string>([
  TransactionEventType.GATEWAY_CHARGE_SUCCEEDED,
]);

async function processFraudCheck(
  job: Job<TransactionEventJobData>,
): Promise<void> {
  const jobData = job.data;

  if (!FRAUD_SCOREABLE_EVENTS.has(jobData.eventType)) {
    logger.debug(
      { eventId: jobData.eventId, eventType: jobData.eventType },
      'Fraud consumer: skipping non-scoreable event',
    );
    return;
  }

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
      { eventId: jobData.eventId, consumerGroup: CONSUMER_GROUP },
      'Fraud consumer: already processed — skipping (idempotent)',
    );
    return;
  }

  const amountDecimal = new Decimal(jobData.amount);

  const scoringResult = await scoreTransaction(jobData);

  logger.info(
    {
      transactionId: jobData.transactionId,
      score: scoringResult.score.toFixed(4),
      decision: scoringResult.decision,
      reasons: scoringResult.reasons,
      modelVersion: scoringResult.modelVersion,
    },
    `Fraud decision: ${scoringResult.decision} (score: ${scoringResult.score.toFixed(4)})`,
  );

  let primaryEventId: string | null = null;
  let primaryEventCreatedAt: Date | null = null;
  let refundEventId: string | null = null;

  if (scoringResult.decision === 'BLOCK') {
    await prisma.$transaction(async (tx) => {

      await tx.processedEvent.create({
        data: { eventId: jobData.eventId, consumerGroup: CONSUMER_GROUP },
      });

      await tx.wallet.update({
        where: { id: jobData.walletId },
        data: { status: WalletStatus.FROZEN },
      });

      const fraudFlagEvent = await tx.transactionEvent.create({
        data: {
          transactionId: jobData.transactionId,
          walletId: jobData.walletId,
          userId: jobData.userId,
          eventType: TransactionEventType.FRAUD_FLAGGED,
          amount: amountDecimal,
          currency: jobData.currency as Currency,
          gatewayOrderId: jobData.gatewayOrderId,
          gatewayPaymentId: jobData.gatewayPaymentId,
          fraudScore: scoringResult.score,
          metadata: {
            decision: scoringResult.decision,
            reasons: scoringResult.reasons,
            modelVersion: scoringResult.modelVersion,
            walletFrozen: true,
            autoRefundTriggered: true,
          },
        },
      });

      const refundInitEvent = await tx.transactionEvent.create({
        data: {
          transactionId: jobData.transactionId,
          walletId: jobData.walletId,
          userId: jobData.userId,
          eventType: TransactionEventType.REFUND_INITIATED,
          amount: amountDecimal,
          currency: jobData.currency as Currency,
          gatewayOrderId: jobData.gatewayOrderId,
          metadata: {
            reason: 'FRAUD_AUTO_REFUND',
            fraudScore: scoringResult.score,
            triggeredByEventId: fraudFlagEvent.eventId,
            autoRefund: true,
          },
        },
      });

      primaryEventId = fraudFlagEvent.eventId;
      primaryEventCreatedAt = fraudFlagEvent.createdAt;
      refundEventId = refundInitEvent.eventId;
    });

const finalFraudEventId = primaryEventId as unknown as string;
    const finalCreatedAt = (primaryEventCreatedAt as unknown as Date).toISOString();
    const finalRefundEventId = refundEventId as unknown as string;

    logger.warn(
      {
        transactionId: jobData.transactionId,
        walletId: jobData.walletId,
        userId: jobData.userId,
        score: scoringResult.score,
        reasons: scoringResult.reasons,
        fraudEventId: finalFraudEventId,
        refundEventId: finalRefundEventId,
      },
      'FRAUD BLOCK: Wallet frozen, auto-refund initiated',
    );

    const fraudWebhookPayload: TransactionEventJobData = {
      ...jobData,

      eventId: finalFraudEventId,
      eventType: String(TransactionEventType.FRAUD_FLAGGED),
      fraudScore: scoringResult.score,
      metadata: {
        ...jobData.metadata,
        decision: scoringResult.decision,
        reasons: scoringResult.reasons,
        modelVersion: scoringResult.modelVersion,
        walletFrozen: true,
        refundEventId: finalRefundEventId,
      },
      createdAt: finalCreatedAt,
    };

    const refundWebhookPayload: TransactionEventJobData = {
      ...jobData,
      eventId: finalRefundEventId,
      eventType: String(TransactionEventType.REFUND_INITIATED),
      fraudScore: scoringResult.score,
      metadata: {
        ...jobData.metadata,
        reason: 'FRAUD_AUTO_REFUND',
        autoRefund: true,
        triggeredByFraudScore: scoringResult.score,
      },
      createdAt: finalCreatedAt,
    };

    await Promise.all([
      webhookEventsQueue.add(
        String(TransactionEventType.FRAUD_FLAGGED) as string,
        fraudWebhookPayload,
      ),
      webhookEventsQueue.add(
        String(TransactionEventType.REFUND_INITIATED) as string,
        refundWebhookPayload,
      ),
    ]);

  } else if (scoringResult.decision === 'FLAG') {
    await prisma.$transaction(async (tx) => {
      await tx.processedEvent.create({
        data: { eventId: jobData.eventId, consumerGroup: CONSUMER_GROUP },
      });

      const fraudFlagEvent = await tx.transactionEvent.create({
        data: {
          transactionId: jobData.transactionId,
          walletId: jobData.walletId,
          userId: jobData.userId,
          eventType: TransactionEventType.FRAUD_FLAGGED,
          amount: amountDecimal,
          currency: jobData.currency as Currency,
          gatewayOrderId: jobData.gatewayOrderId,
          gatewayPaymentId: jobData.gatewayPaymentId,
          fraudScore: scoringResult.score,
          metadata: {
            decision: scoringResult.decision,
            reasons: scoringResult.reasons,
            modelVersion: scoringResult.modelVersion,
            walletFrozen: false,
            requiresManualReview: true,
          },
        },
      });

      primaryEventId = fraudFlagEvent.eventId;
      primaryEventCreatedAt = fraudFlagEvent.createdAt;
    });

const finalFraudEventId = primaryEventId as unknown as string;
    const finalCreatedAt = (primaryEventCreatedAt as unknown as Date).toISOString();
    logger.warn(
      {
        transactionId: jobData.transactionId,
        score: scoringResult.score,
        reasons: scoringResult.reasons,
        fraudEventId: finalFraudEventId,
      },
      'FRAUD FLAG: Transaction marked for manual review (wallet active)',
    );

    const flagWebhookPayload: TransactionEventJobData = {
      ...jobData,
      eventId: finalFraudEventId,
      eventType: String(TransactionEventType.FRAUD_FLAGGED),
      fraudScore: scoringResult.score,
      metadata: {
        ...jobData.metadata,
        decision: scoringResult.decision,
        reasons: scoringResult.reasons,
        modelVersion: scoringResult.modelVersion,
        walletFrozen: false,
        requiresManualReview: true,
      },
      createdAt: finalCreatedAt,
    };

    await webhookEventsQueue.add(
      String(TransactionEventType.FRAUD_FLAGGED) as string,
      flagWebhookPayload,
    );

  } else {
    await prisma.$transaction(async (tx) => {
      await tx.processedEvent.create({
        data: { eventId: jobData.eventId, consumerGroup: CONSUMER_GROUP },
      });

      const clearedEvent = await tx.transactionEvent.create({
        data: {
          transactionId: jobData.transactionId,
          walletId: jobData.walletId,
          userId: jobData.userId,
          eventType: TransactionEventType.FRAUD_CLEARED,
          amount: amountDecimal,
          currency: jobData.currency as Currency,
          gatewayOrderId: jobData.gatewayOrderId,
          fraudScore: scoringResult.score,
          metadata: {
            decision: scoringResult.decision,
            reasons: scoringResult.reasons,
            modelVersion: scoringResult.modelVersion,
          },
        },
      });

      primaryEventId = clearedEvent.eventId;
      primaryEventCreatedAt = clearedEvent.createdAt;
    });

    logger.info(
      {
        transactionId: jobData.transactionId,
        score: scoringResult.score,
        fraudClearedEventId: primaryEventId,
      },
      'FRAUD CLEAR: Transaction passed AI scoring',
    );
  }
}

const worker = new Worker<TransactionEventJobData>(
  QUEUE_NAMES.FRAUD_EVENTS,
  processFraudCheck,
  {
    connection: createBullMQConnection() as any,
    concurrency: 5,
  },
);

worker.on('completed', (job: Job<TransactionEventJobData>) => {
  logger.info(
    {
      jobId: job.id,
      transactionId: job.data.transactionId,
      eventType: job.data.eventType,
    },
    'Fraud check job completed',
  );
});

worker.on(
  'failed',
  (job: Job<TransactionEventJobData> | undefined, err: Error) => {
    logger.error(
      {
        jobId: job?.id,
        transactionId: job?.data?.transactionId,
        eventType: job?.data?.eventType,
        err,
      },
      'Fraud check job failed permanently after all retries',
    );
  },
);

worker.on('error', (err: Error) => {

  logger.error({ err }, 'Fraud consumer worker Redis error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Fraud consumer: shutdown signal received');

  await worker.close();
  await prisma.$disconnect();

  logger.info('Fraud consumer: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Fraud consumer: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Fraud consumer: uncaught exception — crashing');
  process.exit(1);
});

logger.info(
  { queue: QUEUE_NAMES.FRAUD_EVENTS, concurrency: 5 },
  'Fraud Detection Engine started',
);