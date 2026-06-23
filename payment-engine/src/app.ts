import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env';
import prisma from './config/database';
import redisClient from './config/redis';
import logger from './utils/logger';
import { errorMiddleware } from './middleware/error.middleware';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [];

const corsOptions = {
  origin: env.NODE_ENV === 'production' ? allowedOrigins : '*',
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Admin-Key'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: '1mb' }));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime,
        ip: req.ip,
      },
      `${req.method} ${req.path} ${res.statusCode}`,
    );
  });
  next();
});

app.get('/health', async (_req: Request, res: Response) => {
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? 'unknown',
    services: {
      database: 'unknown' as 'connected' | 'error' | 'unknown',
      redis: 'unknown' as 'connected' | 'error' | 'unknown',
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    healthStatus.services.database = 'connected';
  } catch {
    healthStatus.status = 'degraded';
    healthStatus.services.database = 'error';
  }

  try {
    const pong = await redisClient.ping();
    healthStatus.services.redis = pong === 'PONG' ? 'connected' : 'error';
    if (pong !== 'PONG') healthStatus.status = 'degraded';
  } catch {
    healthStatus.status = 'degraded';
    healthStatus.services.redis = 'error';
  }

  const httpStatus = healthStatus.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(healthStatus);
});

import authRouter from './modules/auth/auth.controller';
import walletRouter from './modules/wallet/wallet.controller';
app.use('/api/auth', authRouter);
app.use('/api/wallets', walletRouter);

import transactionRouter from './modules/transaction/transaction.controller';
app.use('/api/transactions', transactionRouter);

import webhookRouter from './modules/webhook/webhook.controller';
app.use('/api/webhooks', webhookRouter);

import adminRouter from './modules/admin/admin.controller';
app.use('/api/admin', adminRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'The requested endpoint does not exist.',
    },
  });
});

app.use(errorMiddleware);

async function startServer(): Promise<void> {

  try {
    await prisma.$connect();
    logger.info('PostgreSQL connection pool established');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to PostgreSQL. Shutting down.');
    process.exit(1);
  }

  try {
    const pong = await redisClient.ping();
    if (pong !== 'PONG') throw new Error(`Unexpected Redis PING response: ${pong}`);
    logger.info('Redis connection established');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to Redis. Shutting down.');
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      `Payment Engine running on port ${env.PORT}`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received. Closing server gracefully...');

    server.close(async () => {
      logger.info('HTTP server closed. Releasing infrastructure connections...');

      try {
        await prisma.$disconnect();
        logger.info('PostgreSQL connection pool closed');
      } catch (err) {
        logger.error({ err }, 'Error closing PostgreSQL connection');
      }

      try {
        await redisClient.quit();
        logger.info('Redis connection closed');
      } catch (err) {
        logger.error({ err }, 'Error closing Redis connection');
      }

      logger.info('Graceful shutdown complete. Exiting.');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timed out after 15s. Forcing exit.');
      process.exit(1);
    }, 15_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Unhandled promise rejection. Crashing to prevent corruption.');
    process.exit(1);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught exception. Crashing to prevent corruption.');
    process.exit(1);
  });
}

startServer();

export default app;
