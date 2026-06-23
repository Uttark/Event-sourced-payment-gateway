import cron from 'node-cron';
import { Queue } from 'bullmq';
import { WebhookDeliveryStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { createBullMQConnection } from '../config/redis';
import logger from '../utils/logger';
import { AppError, QUEUE_NAMES, WebhookDeliveryJobData } from '../types';

const webhookQueue = new Queue<WebhookDeliveryJobData>(
  QUEUE_NAMES.WEBHOOK_DELIVERY,
  { connection: createBullMQConnection() as any },
);

const BATCH_SIZE = 50;

export async function listDlqItems(
  page: number,
  limit: number,
  unresolvedOnly = false,
) {
  const where = unresolvedOnly ? { resolvedAt: null } : {};
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.deadLetterWebhook.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.deadLetterWebhook.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      webhookDeliveryId: item.webhookDeliveryId,
      webhookEndpointId: item.webhookEndpointId,
      transactionEventId: item.transactionEventId,
      failureReason: item.failureReason,
      attemptCount: item.attemptCount,
      createdAt: item.createdAt.toISOString(),
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      resolvedBy: item.resolvedBy,
    })),
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDlqStats() {
  const [total, unresolved, topFailingEndpoints] = await Promise.all([
    prisma.deadLetterWebhook.count(),
    prisma.deadLetterWebhook.count({ where: { resolvedAt: null } }),

    prisma.deadLetterWebhook.groupBy({
      by: ['webhookEndpointId'],
      _count: { id: true },
      where: { resolvedAt: null },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    }),
  ]);

  return {
    total,
    unresolved,
    resolved: total - unresolved,
    topFailingEndpoints: topFailingEndpoints.map((row) => ({
      endpointId: row.webhookEndpointId,
      unresolvedCount: row._count.id,
    })),
  };
}

export async function replayDlqItem(
  dlqId: string,
  resolvedBy: string,
): Promise<{ newDeliveryId: string }> {
  const dlqItem = await prisma.deadLetterWebhook.findUnique({
    where: { id: dlqId },
  });

  if (!dlqItem) {
    throw new AppError('DLQ item not found', 404, 'DLQ_ITEM_NOT_FOUND');
  }

  if (dlqItem.resolvedAt) {
    throw new AppError(
      'This DLQ item has already been resolved.',
      409,
      'DLQ_ALREADY_RESOLVED',
    );
  }

  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: dlqItem.webhookEndpointId },
    include: {
      merchant: { select: { id: true, webhookSecret: true } },
    },
  });

  if (!endpoint) {
    throw new AppError(
      'Webhook endpoint no longer exists. Re-register the endpoint before replaying.',
      422,
      'ENDPOINT_NOT_FOUND',
    );
  }

  if (!endpoint.isActive) {
    throw new AppError(
      'Webhook endpoint is currently inactive. Reactivate it before replaying.',
      422,
      'ENDPOINT_INACTIVE',
    );
  }

  const newDelivery = await prisma.webhookDelivery.create({
    data: {
      webhookEndpointId: dlqItem.webhookEndpointId,
      transactionEventId: dlqItem.transactionEventId,
     payload: dlqItem.payload as Prisma.InputJsonValue,
      status: WebhookDeliveryStatus.PENDING,
    },
    select: { id: true },
  });

  const replayJobData: WebhookDeliveryJobData = {
    webhookDeliveryId: newDelivery.id,
    webhookEndpointId: dlqItem.webhookEndpointId,
    merchantId: endpoint.merchant.id,
    url: endpoint.url,
    payload: dlqItem.payload as Record<string, unknown>,
    secret: endpoint.merchant.webhookSecret,
    transactionEventId: dlqItem.transactionEventId,
  };

  await webhookQueue.add(`dlq-replay:${newDelivery.id}` as any, replayJobData);

  await prisma.deadLetterWebhook.update({
    where: { id: dlqId },
    data: { resolvedAt: new Date(), resolvedBy },
  });

  logger.info(
    { dlqId, newDeliveryId: newDelivery.id, resolvedBy },
    'DLQ item replayed: fresh delivery job enqueued',
  );

  return { newDeliveryId: newDelivery.id };
}

export async function resolveDlqItem(
  dlqId: string,
  resolvedBy: string,
): Promise<void> {
  const dlqItem = await prisma.deadLetterWebhook.findUnique({
    where: { id: dlqId },
    select: { id: true, resolvedAt: true },
  });

  if (!dlqItem) {
    throw new AppError('DLQ item not found', 404, 'DLQ_ITEM_NOT_FOUND');
  }

  if (dlqItem.resolvedAt) {
    throw new AppError(
      'This DLQ item has already been resolved.',
      409,
      'DLQ_ALREADY_RESOLVED',
    );
  }

  await prisma.deadLetterWebhook.update({
    where: { id: dlqId },
    data: { resolvedAt: new Date(), resolvedBy },
  });

  logger.info({ dlqId, resolvedBy }, 'DLQ item resolved (no replay)');
}

async function runDlqProcessing(): Promise<void> {

  const failedJobs = await webhookQueue.getFailed(0, BATCH_SIZE - 1);

  if (failedJobs.length === 0) {
    logger.debug('DLQ processor: no failed jobs in BullMQ');
    return;
  }

  logger.info(
    { count: failedJobs.length },
    'DLQ processor: processing failed webhook delivery jobs',
  );

  for (const job of failedJobs) {
    const jobData = job.data;

    const existing = await prisma.deadLetterWebhook.findUnique({
      where: { webhookDeliveryId: jobData.webhookDeliveryId },
      select: { id: true },
    });

    if (existing) {
      await job.remove();
      continue;
    }

    try {

      await prisma.$transaction(async (tx) => {
        await tx.deadLetterWebhook.create({
          data: {
            webhookDeliveryId: jobData.webhookDeliveryId,
            webhookEndpointId: jobData.webhookEndpointId,
            transactionEventId: jobData.transactionEventId,
            payload: jobData.payload as Prisma.InputJsonValue,

            failureReason:
              job.failedReason ?? 'Maximum retry attempts (5) exhausted',
            attemptCount: job.attemptsMade,
          },
        });

        await tx.webhookDelivery.update({
          where: { id: jobData.webhookDeliveryId },
          data: { status: WebhookDeliveryStatus.DEAD_LETTERED },
        });
      });

      await job.remove();

      logger.warn(
        {
          deliveryId: jobData.webhookDeliveryId,
          url: jobData.url,
          transactionEventId: jobData.transactionEventId,
          attempts: job.attemptsMade,
          failureReason: job.failedReason,
        },
        'DLQ: webhook delivery moved to dead_letter_webhooks — merchant notification missed',
      );
    } catch (err) {

      logger.error(
        { err, jobId: job.id, deliveryId: jobData.webhookDeliveryId },
        'DLQ processor: failed to write to dead_letter_webhooks — will retry next run',
      );
    }
  }
}

if (require.main === module) {
  const SCHEDULE = '* * * * *';

  const cronJob = cron.schedule(SCHEDULE, () => {
    void runDlqProcessing().catch((err: unknown) => {
      logger.error({ err }, 'DLQ processor: unhandled error in cron callback');
    });
  });

  logger.info(
    { schedule: SCHEDULE, batchSize: BATCH_SIZE },
    'DLQ Worker started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'DLQ worker: shutdown signal received');
    cronJob.destroy();
    await webhookQueue.close();
    await prisma.$disconnect();
    logger.info('DLQ worker: shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT');  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'DLQ worker: unhandled rejection — crashing');
    process.exit(1);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'DLQ worker: uncaught exception — crashing');
    process.exit(1);
  });
}