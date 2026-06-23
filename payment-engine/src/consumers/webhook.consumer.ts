import crypto from 'crypto';
import axios from 'axios';
import { Worker, Job } from 'bullmq';
import { WebhookDeliveryStatus, Prisma } from '@prisma/client';

import prisma from '../config/database';
import { createBullMQConnection } from '../config/redis';
import { webhookDeliveryQueue } from '../config/queue';
import { env } from '../config/env';
import logger from '../utils/logger';
import { generateHmacSignature } from '../utils/hmac';
import {
  QUEUE_NAMES,
  TransactionEventJobData,
  WebhookDeliveryJobData,
} from '../types';
import * as webhookRepository from '../modules/webhook/webhook.repository';

const DISPATCHER_CONSUMER_GROUP = 'webhook-dispatcher';

const WEBHOOKABLE_EVENTS = new Set<string>([
  'GATEWAY_CHARGE_SUCCEEDED',
  'GATEWAY_CHARGE_FAILED',
  'PAYMENT_COMPLETED',
  'FRAUD_FLAGGED',
  'REFUND_INITIATED',
  'REFUND_COMPLETED',
  'PAYOUT_COMPLETED',
  'PAYOUT_FAILED',
]);

async function processWebhookDispatch(
  job: Job<TransactionEventJobData>,
): Promise<void> {
  const jobData = job.data;

  if (!WEBHOOKABLE_EVENTS.has(jobData.eventType)) {
    logger.debug(
      { eventId: jobData.eventId, eventType: jobData.eventType },
      'Webhook dispatcher: skipping non-webhookable event',
    );
    return;
  }

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: {
      eventId_consumerGroup: {
        eventId: jobData.eventId,
        consumerGroup: DISPATCHER_CONSUMER_GROUP,
      },
    },
  });

  if (alreadyProcessed) {
    logger.info(
      { eventId: jobData.eventId },
      'Webhook dispatcher: already dispatched — skipping (idempotent)',
    );
    return;
  }

  const merchant = await webhookRepository.findMerchantByUserId(jobData.userId);

  if (!merchant) {
    logger.debug(
      { userId: jobData.userId, eventId: jobData.eventId },
      'Webhook dispatcher: no merchant record for userId — skipping',
    );

    await prisma.processedEvent.create({
      data: {
        eventId: jobData.eventId,
        consumerGroup: DISPATCHER_CONSUMER_GROUP,
      },
    });
    return;
  }

  const endpoints = await webhookRepository.findActiveEndpointsForEvent(
    merchant.id,
    jobData.eventType,
  );

  if (endpoints.length === 0) {
    logger.debug(
      { merchantId: merchant.id, eventType: jobData.eventType },
      'Webhook dispatcher: no active endpoints for this event type',
    );
    await prisma.processedEvent.create({
      data: {
        eventId: jobData.eventId,
        consumerGroup: DISPATCHER_CONSUMER_GROUP,
      },
    });
    return;
  }

  const webhookPayload = {
    id: crypto.randomUUID(),
    type: jobData.eventType,
    created: jobData.createdAt,
    apiVersion: '2024-01-01',
    data: {
      transactionId: jobData.transactionId,
      walletId: jobData.walletId,
      userId: jobData.userId,
      amount: jobData.amount,
      currency: jobData.currency,
      gatewayOrderId: jobData.gatewayOrderId,
      gatewayPaymentId: jobData.gatewayPaymentId,
      fraudScore: jobData.fraudScore,
      metadata: jobData.metadata,
    },
  };

  const pendingDeliveries: Array<{
    deliveryId: string;
    endpointId: string;
    url: string;
  }> = [];

  await prisma.$transaction(async (tx) => {
    await tx.processedEvent.create({
      data: {
        eventId: jobData.eventId,
        consumerGroup: DISPATCHER_CONSUMER_GROUP,
      },
    });

    for (const endpoint of endpoints) {
      const delivery = await tx.webhookDelivery.create({
        data: {
          webhookEndpointId: endpoint.id,
          transactionEventId: jobData.eventId,
        payload: webhookPayload as Prisma.InputJsonValue,
          status: WebhookDeliveryStatus.PENDING,
        },
        select: { id: true },
      });

      pendingDeliveries.push({
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        url: endpoint.url,
      });
    }
  });

  for (const { deliveryId, endpointId, url } of pendingDeliveries) {
    const deliveryJobData: WebhookDeliveryJobData = {
      webhookDeliveryId: deliveryId,
      webhookEndpointId: endpointId,
      merchantId: merchant.id,
      url,
      payload: webhookPayload,
      secret: merchant.webhookSecret,
      transactionEventId: jobData.eventId,
    };

    try {
      await webhookDeliveryQueue.add(`delivery:${deliveryId}`, deliveryJobData);
    } catch (err) {
      logger.error(
        { err, deliveryId, url, eventId: jobData.eventId },
        'Webhook dispatcher: failed to enqueue delivery job — delivery stuck in PENDING state',
      );
    }
  }

  logger.info(
    {
      eventId: jobData.eventId,
      eventType: jobData.eventType,
      merchantId: merchant.id,
      endpointCount: endpoints.length,
    },
    'Webhook dispatcher: delivery jobs enqueued',
  );
}

async function processWebhookDelivery(
  job: Job<WebhookDeliveryJobData>,
): Promise<void> {
  const jobData = job.data;

  const attemptNumber = job.attemptsMade + 1;
  const attemptAt = new Date();

  const payloadString = JSON.stringify(jobData.payload);
  const signature = generateHmacSignature(payloadString, jobData.secret);

  let httpResponse: any;

  try {
    httpResponse = await axios.post(jobData.url, payloadString, {
      headers: {
        'Content-Type': 'application/json',

        'X-Webhook-Signature': signature,

        'X-Webhook-Delivery-Id': jobData.webhookDeliveryId,

        'X-Webhook-Timestamp': attemptAt.toISOString(),
        'User-Agent': 'PaymentEngine-Webhook/1.0',
      },
      timeout: env.WEBHOOK_DELIVERY_TIMEOUT_MS,

      validateStatus: () => true,
    });
  } catch (networkErr: unknown) {

    const errMessage =
      networkErr instanceof Error ? networkErr.message : 'Network error';

    await webhookRepository.updateWebhookDeliveryAttempt(
      jobData.webhookDeliveryId,
      {
        status: WebhookDeliveryStatus.FAILED,
        attemptCount: attemptNumber,
        lastAttemptAt: attemptAt,
        lastHttpStatusCode: null,
        lastResponseBody: errMessage.substring(0, 500),
      },
    );

    logger.warn(
      {
        webhookDeliveryId: jobData.webhookDeliveryId,
        url: jobData.url,
        error: errMessage,
        attempt: attemptNumber,
      },
      'Webhook delivery network error — BullMQ will retry',
    );

    throw networkErr;
  }

  if (httpResponse.status >= 200 && httpResponse.status < 300) {

    const responseBody =
      typeof httpResponse.data === 'string'
        ? httpResponse.data
        : JSON.stringify(httpResponse.data);

    await webhookRepository.updateWebhookDeliveryAttempt(
      jobData.webhookDeliveryId,
      {
        status: WebhookDeliveryStatus.DELIVERED,
        attemptCount: attemptNumber,
        lastAttemptAt: attemptAt,
        lastHttpStatusCode: httpResponse.status,
        lastResponseBody: responseBody,
      },
    );

    logger.info(
      {
        webhookDeliveryId: jobData.webhookDeliveryId,
        url: jobData.url,
        statusCode: httpResponse.status,
        attempt: attemptNumber,
      },
      'Webhook delivered successfully',
    );

    return;
  }

  const responseBody =
    typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);

  await webhookRepository.updateWebhookDeliveryAttempt(
    jobData.webhookDeliveryId,
    {
      status: WebhookDeliveryStatus.FAILED,
      attemptCount: attemptNumber,
      lastAttemptAt: attemptAt,
      lastHttpStatusCode: httpResponse.status,
      lastResponseBody: responseBody,
    },
  );

  logger.warn(
    {
      webhookDeliveryId: jobData.webhookDeliveryId,
      url: jobData.url,
      statusCode: httpResponse.status,
      attempt: attemptNumber,
    },
    `Webhook delivery failed: HTTP ${httpResponse.status} — BullMQ will retry`,
  );

  throw new Error(
    `Merchant endpoint returned HTTP ${httpResponse.status}`,
  );
}

const dispatchWorker = new Worker<TransactionEventJobData>(
  QUEUE_NAMES.WEBHOOK_EVENTS,
  processWebhookDispatch,
  {
    connection: createBullMQConnection() as any,
    concurrency: 5,
  },
);

const deliveryWorker = new Worker<WebhookDeliveryJobData>(
  QUEUE_NAMES.WEBHOOK_DELIVERY,
  processWebhookDelivery,
  {
    connection: createBullMQConnection() as any,
    concurrency: 10,
  },
);

dispatchWorker.on('completed', (job: Job<TransactionEventJobData>) => {
  logger.debug(
    { jobId: job.id, eventId: job.data.eventId, eventType: job.data.eventType },
    'Webhook dispatch job completed',
  );
});

dispatchWorker.on(
  'failed',
  (job: Job<TransactionEventJobData> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, eventId: job?.data?.eventId, err },
      'Webhook dispatch job permanently failed — merchant may have missed this event',
    );
  },
);

deliveryWorker.on('completed', (job: Job<WebhookDeliveryJobData>) => {
  logger.info(
    {
      jobId: job.id,
      deliveryId: job.data.webhookDeliveryId,
      url: job.data.url,
    },
    'Webhook delivery job completed',
  );
});

deliveryWorker.on(
  'failed',
  (job: Job<WebhookDeliveryJobData> | undefined, err: Error) => {

    logger.error(
      {
        jobId: job?.id,
        deliveryId: job?.data?.webhookDeliveryId,
        url: job?.data?.url,
        err,
      },
      'Webhook delivery permanently failed after 5 attempts — moved to DLQ',
    );
  },
);

[dispatchWorker, deliveryWorker].forEach((w) => {
  w.on('error', (err: Error) => {
    logger.error({ err, workerName: w.name }, 'Webhook consumer Redis connection error');
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Webhook consumer: shutdown signal received');

  await Promise.all([dispatchWorker.close(), deliveryWorker.close()]);
  await prisma.$disconnect();

  logger.info('Webhook consumer: shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Webhook consumer: unhandled rejection — crashing');
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Webhook consumer: uncaught exception — crashing');
  process.exit(1);
});

logger.info(
  {
    dispatchQueue: QUEUE_NAMES.WEBHOOK_EVENTS,
    deliveryQueue: QUEUE_NAMES.WEBHOOK_DELIVERY,
    dispatchConcurrency: 5,
    deliveryConcurrency: 10,
  },
  'Webhook Consumer started (Stage 1: dispatch + Stage 2: HTTP delivery)',
);