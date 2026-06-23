import { WebhookDeliveryStatus, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { generateWebhookSecret } from '../../utils/hmac';

export async function findMerchantByUserId(userId: string) {
  return prisma.merchant.findFirst({ where: { userId } });
}

export async function findMerchantById(merchantId: string) {
  return prisma.merchant.findUnique({ where: { id: merchantId } });
}

export async function createMerchant(userId: string, businessName: string) {
  const webhookSecret = generateWebhookSecret();
  return prisma.merchant.create({
    data: { userId, businessName, webhookSecret },
  });
}

export async function findEndpointsByMerchantId(merchantId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveEndpointsForEvent(
  merchantId: string,
  eventType: string,
) {
  return prisma.webhookEndpoint.findMany({
    where: {
      merchantId,
      isActive: true,
      OR: [
        { eventTypes: { isEmpty: true } },
        { eventTypes: { has: eventType } },
      ],
    },
  });
}

export async function createEndpoint(
  merchantId: string,
  url: string,
  eventTypes: string[],
) {
  return prisma.webhookEndpoint.create({
    data: { merchantId, url, eventTypes },
  });
}

export async function deactivateEndpoint(
  endpointId: string,
  merchantId: string,
) {
  return prisma.webhookEndpoint.updateMany({
    where: { id: endpointId, merchantId },
    data: { isActive: false },
  });
}

export async function createWebhookDelivery(data: {
  webhookEndpointId: string;
  transactionEventId: string;
  payload: Record<string, unknown>;
}) {
  return prisma.webhookDelivery.create({
    data: {
      webhookEndpointId: data.webhookEndpointId,
      transactionEventId: data.transactionEventId,
      payload: data.payload as Prisma.InputJsonValue,
      status: WebhookDeliveryStatus.PENDING,
    },
    select: { id: true },
  });
}

export async function updateWebhookDeliveryAttempt(
  deliveryId: string,
  data: {
    status: WebhookDeliveryStatus;
    attemptCount: number;
    lastAttemptAt: Date;
    lastHttpStatusCode?: number | null;
    lastResponseBody?: string | null;
  },
) {
  return prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: data.status,
      attemptCount: data.attemptCount,
      lastAttemptAt: data.lastAttemptAt,
      lastHttpStatusCode: data.lastHttpStatusCode ?? null,

      lastResponseBody: data.lastResponseBody
        ? data.lastResponseBody.substring(0, 500)
        : null,
    },
  });
}