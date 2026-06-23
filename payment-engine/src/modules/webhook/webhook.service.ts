import { AppError } from '../../types';
import logger from '../../utils/logger';
import * as webhookRepository from './webhook.repository';

export async function registerMerchant(userId: string, businessName: string) {
  const existing = await webhookRepository.findMerchantByUserId(userId);

  if (existing) {
    throw new AppError(
      'You are already registered as a merchant.',
      409,
      'MERCHANT_ALREADY_EXISTS',
    );
  }

  const merchant = await webhookRepository.createMerchant(userId, businessName);

  logger.info(
    { userId, merchantId: merchant.id, businessName },
    'Merchant registered',
  );

  return {
    id: merchant.id,
    businessName: merchant.businessName,
    webhookSecret: merchant.webhookSecret,
    createdAt: merchant.createdAt.toISOString(),
  };
}

export async function getMerchant(userId: string) {
  const merchant = await webhookRepository.findMerchantByUserId(userId);

  if (!merchant) {
    throw new AppError(
      'You are not registered as a merchant.',
      404,
      'MERCHANT_NOT_FOUND',
    );
  }

  return {
    id: merchant.id,
    businessName: merchant.businessName,
    createdAt: merchant.createdAt.toISOString(),
  };
}

export async function registerEndpoint(
  userId: string,
  url: string,
  eventTypes: string[],
) {
  const merchant = await webhookRepository.findMerchantByUserId(userId);

  if (!merchant) {
    throw new AppError(
      'You must register as a merchant before adding webhook endpoints.',
      403,
      'NOT_A_MERCHANT',
    );
  }

  const endpoint = await webhookRepository.createEndpoint(
    merchant.id,
    url,
    eventTypes,
  );

  logger.info(
    {
      userId,
      merchantId: merchant.id,
      endpointId: endpoint.id,
      url,
      eventTypes: eventTypes.length === 0 ? 'ALL' : eventTypes,
    },
    'Webhook endpoint registered',
  );

  return endpoint;
}

export async function listEndpoints(userId: string) {
  const merchant = await webhookRepository.findMerchantByUserId(userId);

  if (!merchant) {
    throw new AppError(
      'You must register as a merchant to list webhook endpoints.',
      403,
      'NOT_A_MERCHANT',
    );
  }

  return webhookRepository.findEndpointsByMerchantId(merchant.id);
}

export async function deactivateEndpoint(userId: string, endpointId: string) {
  const merchant = await webhookRepository.findMerchantByUserId(userId);

  if (!merchant) {
    throw new AppError(
      'You are not registered as a merchant.',
      403,
      'NOT_A_MERCHANT',
    );
  }

  const result = await webhookRepository.deactivateEndpoint(
    endpointId,
    merchant.id,
  );

  if (result.count === 0) {
    throw new AppError('Webhook endpoint not found.', 404, 'ENDPOINT_NOT_FOUND');
  }

  logger.info(
    { userId, merchantId: merchant.id, endpointId },
    'Webhook endpoint deactivated',
  );
}