import { Prisma, TransactionEventType, Currency } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../config/database';

interface InsertEventData {
  transactionId: string;
  walletId: string;
  userId: string;
  eventType: TransactionEventType;
  amount: Decimal;
  currency: string;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  idempotencyKey?: string | null;
  fraudScore?: number | null;
  metadata?: Record<string, unknown>;
}

export async function insertTransactionEvent(
  data: InsertEventData,
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;

  return client.transactionEvent.create({
    data: {
      transactionId: data.transactionId,
      walletId: data.walletId,
      userId: data.userId,
      eventType: data.eventType,

      amount: data.amount,

      currency: data.currency as Currency,
      gatewayOrderId: data.gatewayOrderId ?? null,
      gatewayPaymentId: data.gatewayPaymentId ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
      fraudScore: data.fraudScore ?? null,
    metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function findEventsByTransactionId(transactionId: string) {
  return prisma.transactionEvent.findMany({
    where: { transactionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findEventsByWalletId(
  walletId: string,
  userId: string,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;

  const events = await prisma.transactionEvent.findMany({
    where: { walletId, userId },
    distinct: ['transactionId'],
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const grouped = await prisma.transactionEvent.groupBy({
    by: ['transactionId'],
    where: { walletId, userId },
  });
  const total = grouped.length;

  return {
    events,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function findAllUserEvents(
  userId: string,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;

  const events = await prisma.transactionEvent.findMany({
    where: { userId },
    distinct: ['transactionId'],
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const grouped = await prisma.transactionEvent.groupBy({
    by: ['transactionId'],
    where: { userId },
  });
  const total = grouped.length;

  return {
    events,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

interface StaleInitializedRow {
  transaction_id: string;
  gateway_order_id: string;
}

export async function findStaleInitializedTransactions(
  olderThanMinutes: number,
): Promise<StaleInitializedRow[]> {
  const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  return prisma.$queryRaw<StaleInitializedRow[]>`
    SELECT DISTINCT
      te.transaction_id,
      te.gateway_order_id
    FROM transaction_events te
    WHERE te.event_type = 'INITIALIZED'
      AND te.created_at  < ${cutoffTime}
      AND te.gateway_order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM   transaction_events te2
        WHERE  te2.transaction_id = te.transaction_id
          AND  te2.event_type IN (
                 'GATEWAY_CHARGE_SUCCEEDED',
                 'GATEWAY_CHARGE_FAILED',
                 'PAYMENT_COMPLETED',
                 'PAYMENT_FAILED'
               )
      )
  `;
}