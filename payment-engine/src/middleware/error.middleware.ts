import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types';
import logger from '../utils/logger';

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,

  _next: NextFunction,
): void {
  if (err instanceof AppError && err.isOperational) {
    logger.warn(
      {
        code: err.code,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
      },
      `Operational error: ${err.message}`,
    );

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
      body: req.body,
    },
    'Unexpected application error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Our team has been notified.',
    },
  });
}