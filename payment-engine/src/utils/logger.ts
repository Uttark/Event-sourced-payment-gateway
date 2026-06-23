import pino from 'pino';
import { env } from '../config/env';

const isDevelopment = env.NODE_ENV === 'development';

const logger = pino(
  {
    level: env.LOG_LEVEL,

    ...(isDevelopment
      ? {}
      : {
          timestamp: pino.stdTimeFunctions.epochTime,
        }),
  },

  isDevelopment
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
        },
      })
    : undefined,
);

export default logger;