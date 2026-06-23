import { Request } from 'express';

export {
  Currency,
  TransactionEventType,
  WalletStatus,
  WebhookDeliveryStatus,
  PayoutStatus,
  UserStatus,
} from '@prisma/client';

export interface JwtPayload {
  userId: string;
  email: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export interface GatewayOrderResult {
  gatewayOrderId: string;
  amountInSmallestUnit: number;
  currency: string;
  status: 'created' | 'attempted' | 'paid';
  receipt: string;
}

export interface GatewayChargeResult {
  success: boolean;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

export interface TransactionEventJobData {
  eventId: string;
  transactionId: string;
  walletId: string;
  userId: string;
  eventType: string;
  amount: string;
  currency: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  idempotencyKey: string | null;
  fraudScore: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WebhookDeliveryJobData {
  webhookDeliveryId: string;
  webhookEndpointId: string;
  merchantId: string;
  url: string;
  payload: Record<string, unknown>;
  secret: string;
  transactionEventId: string;
}

export interface PayoutJobData {
  payoutId: string;
  merchantId: string;
  amount: string;
  currency: string;
}

export interface FraudVelocityCheckResult {
  blocked: boolean;
  flagged: boolean;
  reason: string;
  triggeredRule: string | null;
}

export interface FraudAiScoringResult {
  score: number;
  decision: 'ALLOW' | 'FLAG' | 'BLOCK';
  reasons: string[];
  modelVersion: string;
}

export interface IdempotencyEntry {
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  httpStatus: number;
  body: Record<string, unknown>;
  transactionId: string | null;
}

export const QUEUE_NAMES = {
  TRANSACTION_EVENTS: 'transaction-events',
  FRAUD_EVENTS:       'fraud-events',
  WEBHOOK_EVENTS:     'webhook-events',
  LEDGER_EVENTS:      'ledger-events',
  PROJECTION_EVENTS:  'projection-events',
  WEBHOOK_DELIVERY:   'webhook-delivery',
  PAYOUT_JOBS:        'payout-jobs',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];