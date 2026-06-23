import crypto from 'crypto';
import Decimal from 'decimal.js';
import { env } from '../config/env';
import logger from '../utils/logger';
import { GatewayOrderResult, GatewayChargeResult } from '../types';

const CURRENCY_TO_SMALLEST_UNIT: Record<string, number> = {
  USD: 100,
  INR: 100,
  EUR: 100,
  GBP: 100,
};

function toSmallestUnit(amount: Decimal, currency: string): number {
  const multiplier = CURRENCY_TO_SMALLEST_UNIT[currency] ?? 100;

  return amount.mul(multiplier).floor().toNumber();
}

function mockCreateOrder(
  amount: Decimal,
  currency: string,
  receipt: string,
): GatewayOrderResult {

  const randomSuffix = crypto
    .randomUUID()
    .replace(/-/g, '')
    .substring(0, 14)
    .toUpperCase();

  const gatewayOrderId = `order_MOCK${randomSuffix}`;

  logger.debug(
    { gatewayOrderId, amount: amount.toFixed(2), currency, receipt },
    'Mock gateway: order created',
  );

  return {
    gatewayOrderId,
    amountInSmallestUnit: toSmallestUnit(amount, currency),
    currency,
    status: 'created',
    receipt,
  };
}

function mockCapturePayment(
  gatewayOrderId: string,
  amount: Decimal,
): GatewayChargeResult {

  const decimalPart = amount.minus(amount.floor());
  const isSimulatedFailure = decimalPart.toFixed(2) === '0.99';

  if (isSimulatedFailure) {
    logger.info(
      { gatewayOrderId, amount: amount.toFixed(2) },
      'Mock gateway: simulating payment decline (test hook — amount ends in .99)',
    );
    return {
      success: false,
      gatewayOrderId,
      gatewayPaymentId: null,
      errorCode: 'MOCK_PAYMENT_DECLINED',
      errorDescription:
        'Simulated payment decline (test hook: amount ends in .99)',
    };
  }

  const paymentSuffix = crypto
    .randomUUID()
    .replace(/-/g, '')
    .substring(0, 14)
    .toUpperCase();

  const gatewayPaymentId = `pay_MOCK${paymentSuffix}`;

  logger.debug(
    { gatewayOrderId, gatewayPaymentId, amount: amount.toFixed(2) },
    'Mock gateway: payment captured successfully',
  );

  return {
    success: true,
    gatewayOrderId,
    gatewayPaymentId,
    errorCode: null,
    errorDescription: null,
  };
}

let _razorpayInstance: any = null;

function getRazorpayInstance(): any {
  if (_razorpayInstance) return _razorpayInstance;

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set when MOCK_GATEWAY=false',
    );
  }

  const Razorpay = require('razorpay');
  _razorpayInstance = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });

  return _razorpayInstance;
}

async function realCreateOrder(
  amount: Decimal,
  currency: string,
  receipt: string,
): Promise<GatewayOrderResult> {
  const razorpay = getRazorpayInstance();
  const amountInSmallestUnit = toSmallestUnit(amount, currency);

  const order = await razorpay.orders.create({
    amount: amountInSmallestUnit,
    currency,
    receipt,
    payment_capture: 1,
  });

  return {
    gatewayOrderId: order.id,
    amountInSmallestUnit: order.amount as number,
    currency: order.currency as string,
    status: order.status as 'created' | 'attempted' | 'paid',
    receipt: order.receipt as string,
  };
}

async function realCapturePayment(
  gatewayOrderId: string,
  _amount: Decimal,
): Promise<GatewayChargeResult> {
  const razorpay = getRazorpayInstance();

  try {

    const paymentsResponse = await razorpay.orders.fetchPayments(gatewayOrderId);

    const payments: any[] = paymentsResponse?.items ?? [];

    if (payments.length === 0) {
      return {
        success: false,
        gatewayOrderId,
        gatewayPaymentId: null,
        errorCode: 'PAYMENT_NOT_INITIATED',
        errorDescription:
          'No payment found for this order. Customer has not completed payment.',
      };
    }

    const latestPayment = payments[0];

    if (
      latestPayment.status === 'captured' ||
      latestPayment.status === 'authorized'
    ) {
      return {
        success: true,
        gatewayOrderId,
        gatewayPaymentId: latestPayment.id as string,
        errorCode: null,
        errorDescription: null,
      };
    }

    return {
      success: false,
      gatewayOrderId,
      gatewayPaymentId: null,
      errorCode:
        (latestPayment.error_code as string) ?? 'PAYMENT_NOT_CAPTURED',
      errorDescription:
        (latestPayment.error_description as string) ??
        `Payment in status: ${latestPayment.status}`,
    };
  } catch (err: unknown) {

    const razorpayErr = err as {
      error?: { code?: string; description?: string };
      message?: string;
    };
    const errorCode = razorpayErr?.error?.code ?? 'GATEWAY_ERROR';
    const errorDescription =
      razorpayErr?.error?.description ??
      razorpayErr?.message ??
      'Gateway request failed';

    logger.error({ err, gatewayOrderId }, 'Razorpay API error during capturePayment');

    return {
      success: false,
      gatewayOrderId,
      gatewayPaymentId: null,
      errorCode,
      errorDescription,
    };
  }
}

export interface CreateOrderParams {
  amount: Decimal;
  currency: string;
  receipt: string;
}

export interface CapturePaymentParams {
  gatewayOrderId: string;
  amount: Decimal;
  currency: string;
}

export async function createOrder(
  params: CreateOrderParams,
): Promise<GatewayOrderResult> {
  logger.info(
    {
      amount: params.amount.toFixed(2),
      currency: params.currency,
      receipt: params.receipt,
      mockMode: env.MOCK_GATEWAY,
    },
    'Gateway: createOrder',
  );

  if (env.MOCK_GATEWAY) {
    return mockCreateOrder(params.amount, params.currency, params.receipt);
  }

  return realCreateOrder(params.amount, params.currency, params.receipt);
}

export async function capturePayment(
  params: CapturePaymentParams,
): Promise<GatewayChargeResult> {
  logger.info(
    {
      gatewayOrderId: params.gatewayOrderId,
      amount: params.amount.toFixed(2),
      currency: params.currency,
      mockMode: env.MOCK_GATEWAY,
    },
    'Gateway: capturePayment',
  );

  if (env.MOCK_GATEWAY) {
    return mockCapturePayment(params.gatewayOrderId, params.amount);
  }

  return realCapturePayment(params.gatewayOrderId, params.amount);
}