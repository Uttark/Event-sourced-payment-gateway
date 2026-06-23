import crypto from 'crypto';

export function generateHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function verifyHmacSignature(
  payload: string,
  secret: string,
  signature: string,
): boolean {

  if (!signature || typeof signature !== 'string') {
    return false;
  }

  const expectedSignature = generateHmacSignature(payload, secret);

  try {
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(signature, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {

    return false;
  }
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}