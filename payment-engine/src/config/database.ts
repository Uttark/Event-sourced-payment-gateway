import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import logger from '../utils/logger';
import { env } from './env';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const logConfig: Prisma.LogDefinition[] = env.NODE_ENV === 'development'
  ? [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ]
  : [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ];

const prisma = new PrismaClient({ adapter, log: logConfig });

if (env.NODE_ENV === 'development') {
  (prisma as any).$on('query', (event: any) => {
    logger.debug(
      { query: event.query, params: event.params, duration: `${event.duration}ms` },
      'Prisma query',
    );
  });
}

(prisma as any).$on('warn', (event: any) => {
  logger.warn({ message: event.message }, 'Prisma warning');
});

(prisma as any).$on('error', (event: any) => {
  logger.error({ message: event.message }, 'Prisma error');
});

export default prisma;