import { Request, Response, NextFunction, RequestHandler } from 'express';
import redisClient from '../config/redis';
import { AppError, AuthenticatedRequest } from '../types';
import logger from '../utils/logger';

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  keyExtractor: (req: Request) => string | null;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const {
    windowMs,
    maxRequests,
    keyPrefix,
    keyExtractor,
    message = 'Too many requests. Please slow down.',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier = keyExtractor(req);

      if (!identifier) {

        return next();
      }

      const windowBucket = Math.floor(Date.now() / windowMs);
      const redisKey = `${keyPrefix}:${identifier}:${windowBucket}`;

      const currentCount = await redisClient.incr(redisKey);

      if (currentCount === 1) {

        const ttlSeconds = Math.ceil((windowMs * 2) / 1000);
        await redisClient.expire(redisKey, ttlSeconds);
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));
      res.setHeader(
        'X-RateLimit-Reset',
        new Date((windowBucket + 1) * windowMs).toISOString(),
      );

      if (currentCount > maxRequests) {
        const retryAfterSeconds = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        logger.warn(
          { identifier, keyPrefix, count: currentCount, max: maxRequests },
          'Rate limit exceeded',
        );
        throw new AppError(message, 429, 'RATE_LIMIT_EXCEEDED');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'rate:ip',
  keyExtractor: (req: Request) => req.ip ?? null,
  message: 'Too many attempts from this IP. Please wait before trying again.',
});

export const merchantRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user?.userId;

    if (!userId) {
      return next();
    }

    const customLimitJson = await redisClient.get(
      `rate:merchant-limit:${userId}`,
    );

    let maxRequests = 100;
    let windowMs    = 60_000;

    if (customLimitJson) {
      const customLimit = JSON.parse(customLimitJson) as {
        maxRequests: number;
        windowMs: number;
      };
      maxRequests = customLimit.maxRequests;
      windowMs    = customLimit.windowMs;
    }

    if (maxRequests === 0) {
      logger.warn(
        { userId, path: req.path },
        'Rate limiter: blocked merchant attempted API access',
      );
      res.status(403).json({
        success: false,
        error: {
          code: 'MERCHANT_BLOCKED',
          message:
            'Your account has been suspended from API access. Contact support.',
        },
      });
      return;
    }

    const windowBucket = Math.floor(Date.now() / windowMs);
    const redisKey     = `rate:merchant:${userId}:${windowBucket}`;

    const currentCount = await redisClient.incr(redisKey);

    if (currentCount === 1) {

      const ttlSeconds = Math.ceil((windowMs * 2) / 1000);
      await redisClient.expire(redisKey, ttlSeconds);
    }

    res.setHeader('X-RateLimit-Limit',     maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));
    res.setHeader(
      'X-RateLimit-Reset',
      new Date((windowBucket + 1) * windowMs).toISOString(),
    );

    if (currentCount > maxRequests) {
      const retryAfterSeconds = Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);

      throw new AppError(
        `API rate limit exceeded. Maximum ${maxRequests} requests per ${retryAfterSeconds}s. ` +
          `See Retry-After header.`,
        429,
        'RATE_LIMIT_EXCEEDED',
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};