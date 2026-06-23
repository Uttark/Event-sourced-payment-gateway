import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';
import { env } from '../config/env';
import logger from '../utils/logger';
import { AppError, AuthenticatedRequest, JwtPayload } from '../types';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        'Authentication required. Provide a valid Bearer token.',
        401,
        'MISSING_AUTH_TOKEN',
      );
    }

    const token = authHeader.substring(7);

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        throw new AppError(
          'Your session has expired. Please log in again.',
          401,
          'TOKEN_EXPIRED',
        );
      }

      throw new AppError(
        'Invalid authentication token. Please log in again.',
        401,
        'INVALID_TOKEN',
      );
    }

    const isBlacklisted = await redisClient.exists(`blacklist:jwt:${decoded.jti}`);

    if (isBlacklisted === 1) {
      logger.warn({ jti: decoded.jti, userId: decoded.userId }, 'Blacklisted token used');
      throw new AppError(
        'This session has been revoked. Please log in again.',
        401,
        'TOKEN_REVOKED',
      );
    }

    (req as AuthenticatedRequest).user = decoded;

    next();
  } catch (err) {
    next(err);
  }
}