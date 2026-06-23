import redisClient from '../config/redis';
import { AppError } from '../types';
import logger from './logger';

const LOCK_TTL_MS = 30_000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 100;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

export async function acquireWalletLock(walletId: string): Promise<string> {
  const lockKey = `lock:wallet:${walletId}`;

  const lockValue = `${process.pid}:${Date.now()}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {

    const result = await (redisClient.set as any)(lockKey, lockValue, 'NX', 'PX', LOCK_TTL_MS);

    if (result === 'OK') {
      logger.debug({ walletId, attempt, lockValue }, 'Wallet lock acquired');
      return lockValue;
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  logger.warn({ walletId }, 'Failed to acquire wallet lock after max retries');
  throw new AppError(
    'Wallet is temporarily busy. Please retry your request in a moment.',
    409,
    'WALLET_LOCK_CONTENTION',
  );
}

export async function releaseWalletLock(walletId: string, lockValue: string): Promise<void> {
  const lockKey = `lock:wallet:${walletId}`;

  try {

    await redisClient.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockValue);
    logger.debug({ walletId }, 'Wallet lock released');
  } catch (err) {

    logger.error({ err, walletId }, 'Failed to release wallet lock via Lua script');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}