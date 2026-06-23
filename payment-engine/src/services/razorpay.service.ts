import crypto      from 'crypto';
import razorpay    from '../config/razorpay';
import { env }     from '../config/env';

export interface CreatedRazorpayOrder {
  orderId:  string;
  amount:   number;
  currency: string;
}

export async function createOrder(
  amountInMajorUnit: number,
  currency:          string,
  receiptId:         string,
): Promise<CreatedRazorpayOrder> {

  const amountInSmallestUnit = Math.round(amountInMajorUnit * 100);

  const order = await razorpay.orders.create({
    amount:   amountInSmallestUnit,
    currency: currency,
    receipt:  receiptId,
  });

  return {
    orderId:  order.id      as string,
    amount:   order.amount  as number,
    currency: order.currency as string,
  };
}

export function verifyPaymentSignature(
  razorpayOrderId:   string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): boolean {

  const dataToSign = razorpayOrderId + '|' + razorpayPaymentId;

  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET ?? '')
    .update(dataToSign)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}