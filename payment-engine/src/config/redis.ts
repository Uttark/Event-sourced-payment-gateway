import Redis from 'ioredis';
import { env } from './env';
import logger from '../utils/logger';

const redisClient = new Redis(env.REDIS_URL, {

  retryStrategy: (times: number): number | null => {
    if (times > 10) {
      logger.error({ attempts: times }, 'Redis connection failed after 10 retries. Giving up.');
      return null;
    }

    const delay = Math.min(times * 100, 3000);
    logger.warn({ attempt: times, retryInMs: delay }, 'Redis disconnected. Retrying...');
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redisClient.on('connect', () => {
  logger.info('Redis connection established');
});

redisClient.on('error', (err: Error) => {
  logger.error({ err }, 'Redis client error');
});

redisClient.on('close', () => {
  logger.warn('Redis connection closed');
});

export function createBullMQConnection(): Redis {
  return new Redis(env.REDIS_URL, {

    maxRetriesPerRequest: null,

    enableReadyCheck: false,

    retryStrategy: (times: number): number => {
      return Math.min(times * 100, 3000);
    },
  });
}

export default redisClient;