import { Queue } from 'bullmq';
import { createBullMQConnection } from './redis';
import { QUEUE_NAMES, TransactionEventJobData, WebhookDeliveryJobData, PayoutJobData } from '../types';
import logger from '../utils/logger';

export const transactionEventsQueue = new Queue<TransactionEventJobData>(
  QUEUE_NAMES.TRANSACTION_EVENTS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 1000,
      },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 1000 },
    },
  },
);

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(
  QUEUE_NAMES.WEBHOOK_DELIVERY,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: {

        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: { count: 1000 },

      removeOnFail: false,
    },
  },
);

export const payoutJobsQueue = new Queue<PayoutJobData>(
  QUEUE_NAMES.PAYOUT_JOBS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  },
);

export const fraudEventsQueue = new Queue<TransactionEventJobData>(
  QUEUE_NAMES.FRAUD_EVENTS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 500 },
    },
  },
);

export const ledgerEventsQueue = new Queue<TransactionEventJobData>(
  QUEUE_NAMES.LEDGER_EVENTS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 5,

      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 1000 },
    },
  },
);

export const projectionEventsQueue = new Queue<TransactionEventJobData>(
  QUEUE_NAMES.PROJECTION_EVENTS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 1000 },
    },
  },
);

export const webhookEventsQueue = new Queue<TransactionEventJobData>(
  QUEUE_NAMES.WEBHOOK_EVENTS,
  {
    connection: createBullMQConnection() as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 500 },
    },
  },
);

[
  transactionEventsQueue,
  fraudEventsQueue,
  webhookEventsQueue,
  ledgerEventsQueue,
  projectionEventsQueue,
  webhookDeliveryQueue,
  payoutJobsQueue,
].forEach((queue) => {
  queue.on('error', (err: Error) => {
    logger.error({ err, queueName: queue.name }, 'BullMQ queue error');
  });
});