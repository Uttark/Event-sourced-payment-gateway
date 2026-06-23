import cron from 'node-cron';
import Decimal from 'decimal.js';
import { TransactionEventType, Currency } from '@prisma/client';

import prisma from '../config/database';
import logger from '../utils/logger';

const ORPHAN_THRESHOLD_MINUTES = 10;

interface OrphanedChargeRow {
  transaction_id:   string;
  source_event_id:  string;
  wallet_id:        string;
  user_id:          string;
  amount:           string;
  currency:         string;
  gateway_order_id:   string | null;
  gateway_payment_id: string | null;
}

interface ProjectionTotalsRow {
  total_credited:      string;
  total_debited:       string;
  transaction_count:   string;
  last_transaction_at: Date | null;
}

interface BalanceMismatchRow {
  wallet_id:            string;
  wallet_balance:       string;
  calculated_balance:   string;
  difference:           string;
}

export async function findOrphanedTransactions(): Promise<OrphanedChargeRow[]> {
  const cutoffTime = new Date(
    Date.now() - ORPHAN_THRESHOLD_MINUTES * 60 * 1000,
  );

  return prisma.$queryRaw<OrphanedChargeRow[]>`
    SELECT
      te.transaction_id,
      te.event_id             AS source_event_id,
      te.wallet_id,
      te.user_id,
      te.amount::TEXT         AS amount,
      te.currency::TEXT       AS currency,
      te.gateway_order_id,
      te.gateway_payment_id
    FROM  transaction_events te
    WHERE te.event_type  = 'GATEWAY_CHARGE_SUCCEEDED'
      AND te.created_at  < ${cutoffTime}
      AND NOT EXISTS (
        SELECT 1
        FROM   transaction_events te2
        WHERE  te2.transaction_id = te.transaction_id
          AND  te2.event_type IN (
                 'PAYMENT_COMPLETED',
                 'PAYMENT_FAILED',
                 'REFUND_INITIATED',
                 'FRAUD_FLAGGED'
               )
      )
    ORDER BY te.created_at ASC
  `;
}

export async function rebuildWalletProjection(walletId: string): Promise<{
  walletId: string;
  newBalance: string;
  totalCredited: string;
  totalDebited: string;
  transactionCount: number;
  wasProjectionMissing: boolean;
}> {

  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, balance: true, currency: true, userId: true },
  });

  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found in the wallets table`);
  }

  const result = await prisma.$queryRaw<ProjectionTotalsRow[]>`
    SELECT
      COALESCE(SUM(
        CASE WHEN event_type IN ('DEPOSIT_COMPLETED', 'REFUND_COMPLETED')
             THEN amount ELSE 0 END
      ), 0)::TEXT   AS total_credited,
      COALESCE(SUM(
        CASE WHEN event_type IN ('GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED')
             THEN amount ELSE 0 END
      ), 0)::TEXT   AS total_debited,
      COUNT(
        CASE WHEN event_type IN ('DEPOSIT_COMPLETED', 'GATEWAY_CHARGE_SUCCEEDED')
             THEN 1 END
      )::TEXT       AS transaction_count,
      MAX(created_at) AS last_transaction_at
    FROM transaction_events
    WHERE wallet_id  = ${walletId}
      AND event_type IN (
            'DEPOSIT_COMPLETED', 'REFUND_COMPLETED',
            'GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED'
          )
  `;

  const totals = result[0];

  if (!totals) {
    throw new Error(
      `Failed to aggregate transaction_events for wallet ${walletId}`,
    );
  }

  const totalCredited = new Decimal(totals.total_credited);
  const totalDebited  = new Decimal(totals.total_debited);

  const authoritativeBalance = new Decimal(wallet.balance.toString());
  const transactionCount     = parseInt(totals.transaction_count, 10);

  const existingProjection = await prisma.walletProjection.findUnique({
    where: { walletId },
    select: { id: true },
  });

  await prisma.walletProjection.upsert({
    where: { walletId },
    create: {
      walletId,
      userId:             wallet.userId,
      currency:           wallet.currency,
      balance:            authoritativeBalance,
      totalCredited,
      totalDebited,
      transactionCount,
      lastTransactionAt:  totals.last_transaction_at,
    },
    update: {
      balance:            authoritativeBalance,
      totalCredited,
      totalDebited,
      transactionCount,
      lastTransactionAt:  totals.last_transaction_at,
    },
  });

  logger.info(
    {
      walletId,
      authoritativeBalance:  authoritativeBalance.toFixed(2),
      totalCredited:         totalCredited.toFixed(2),
      totalDebited:          totalDebited.toFixed(2),
      transactionCount,
      wasProjectionMissing:  !existingProjection,
    },
    'Compensation: wallet projection rebuilt from event store',
  );

  return {
    walletId,
    newBalance:           authoritativeBalance.toFixed(8),
    totalCredited:        totalCredited.toFixed(8),
    totalDebited:         totalDebited.toFixed(8),
    transactionCount,
    wasProjectionMissing: !existingProjection,
  };
}

export async function checkBalanceIntegrity(
  walletId?: string,
): Promise<BalanceMismatchRow[]> {

  const TOLERANCE = 0.00001;

  if (walletId) {

    return prisma.$queryRaw<BalanceMismatchRow[]>`
      WITH event_sums AS (
        SELECT
          wallet_id,
          SUM(CASE WHEN event_type IN ('DEPOSIT_COMPLETED', 'REFUND_COMPLETED')
                   THEN amount ELSE 0 END) -
          SUM(CASE WHEN event_type IN ('GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED')
                   THEN amount ELSE 0 END) AS calculated_balance
        FROM  transaction_events
        WHERE wallet_id  = ${walletId}
          AND event_type IN (
                'DEPOSIT_COMPLETED', 'REFUND_COMPLETED',
                'GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED'
              )
        GROUP BY wallet_id
      )
      SELECT
        w.id                                                    AS wallet_id,
        w.balance::TEXT                                         AS wallet_balance,
        COALESCE(es.calculated_balance, 0)::TEXT                AS calculated_balance,
        ABS(w.balance - COALESCE(es.calculated_balance, 0))::TEXT AS difference
      FROM  wallets w
      LEFT  JOIN event_sums es ON es.wallet_id = w.id
      WHERE w.id = ${walletId}
        AND ABS(w.balance - COALESCE(es.calculated_balance, 0)) > ${TOLERANCE}
    `;
  }

  return prisma.$queryRaw<BalanceMismatchRow[]>`
    WITH event_sums AS (
      SELECT
        wallet_id,
        SUM(CASE WHEN event_type IN ('DEPOSIT_COMPLETED', 'REFUND_COMPLETED')
                 THEN amount ELSE 0 END) -
        SUM(CASE WHEN event_type IN ('GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED')
                 THEN amount ELSE 0 END) AS calculated_balance
      FROM  transaction_events
      WHERE event_type IN (
              'DEPOSIT_COMPLETED', 'REFUND_COMPLETED',
              'GATEWAY_CHARGE_SUCCEEDED', 'PAYOUT_COMPLETED'
            )
      GROUP BY wallet_id
    )
    SELECT
      w.id                                                    AS wallet_id,
      w.balance::TEXT                                         AS wallet_balance,
      COALESCE(es.calculated_balance, 0)::TEXT                AS calculated_balance,
      ABS(w.balance - COALESCE(es.calculated_balance, 0))::TEXT AS difference
    FROM  wallets w
    LEFT  JOIN event_sums es ON es.wallet_id = w.id
    WHERE ABS(w.balance - COALESCE(es.calculated_balance, 0)) > ${TOLERANCE}
    ORDER BY ABS(w.balance - COALESCE(es.calculated_balance, 0)) DESC
    LIMIT 100
  `;
}

async function runCompensationScan(): Promise<void> {
  const orphans = await findOrphanedTransactions();

  if (orphans.length === 0) {
    logger.debug('Compensation scan: no orphaned transactions found — system healthy');
    return;
  }

  logger.warn(
    { count: orphans.length, thresholdMinutes: ORPHAN_THRESHOLD_MINUTES },
    'Compensation scan: found GATEWAY_CHARGE_SUCCEEDED events without PAYMENT_COMPLETED — ledger consumer may be degraded',
  );

  for (const orphan of orphans) {
    try {

      const amount = new Decimal(orphan.amount);

      const alreadyResolved = await prisma.transactionEvent.findFirst({
        where: {
          transactionId: orphan.transaction_id,
          eventType: {
            in: [
              TransactionEventType.PAYMENT_COMPLETED,
              TransactionEventType.PAYMENT_FAILED,
              TransactionEventType.REFUND_INITIATED,
              TransactionEventType.FRAUD_FLAGGED,
            ],
          },
        },
        select: { id: true },
      });

      if (alreadyResolved) {
        logger.debug(
          { transactionId: orphan.transaction_id },
          'Compensation scan: race condition — orphan was resolved between scan and heal. Skipping.',
        );
        continue;
      }

      await prisma.transactionEvent.create({
        data: {
          transactionId:    orphan.transaction_id,
          walletId:         orphan.wallet_id,
          userId:           orphan.user_id,
          eventType:        TransactionEventType.PAYMENT_COMPLETED,
          amount,
          currency:         orphan.currency as Currency,
          gatewayOrderId:   orphan.gateway_order_id,
          gatewayPaymentId: orphan.gateway_payment_id,
          metadata: {
            sealedFromEventId: orphan.source_event_id,
            source:            'COMPENSATION_WORKER',
            compensatedAt:     new Date().toISOString(),
            reason:
              'Ledger consumer failed to write PAYMENT_COMPLETED — recovered by compensation cron',
          },
        },
      });

      logger.warn(
        {
          transactionId:    orphan.transaction_id,
          walletId:         orphan.wallet_id,
          amount:           amount.toFixed(2),
          currency:         orphan.currency,
          sourceEventId:    orphan.source_event_id,
        },
        'Compensation: PAYMENT_COMPLETED written directly — investigate ledger consumer health',
      );
    } catch (err) {

      logger.error(
        { err, transactionId: orphan.transaction_id },
        'Compensation scan: failed to write PAYMENT_COMPLETED — will retry next cron run',
      );
    }
  }
}

if (require.main === module) {
  const SCHEDULE = '*/15 * * * *';

  const cronJob = cron.schedule(SCHEDULE, () => {
    void runCompensationScan().catch((err: unknown) => {
      logger.error(
        { err },
        'Compensation worker: unhandled error in cron callback',
      );
    });
  });

  logger.info(
    {
      schedule:               SCHEDULE,
      orphanThresholdMinutes: ORPHAN_THRESHOLD_MINUTES,
    },
    'Compensation Worker started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Compensation worker: shutdown signal received');
    cronJob.destroy();
    await prisma.$disconnect();
    logger.info('Compensation worker: shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT');  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Compensation worker: unhandled rejection — crashing');
    process.exit(1);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Compensation worker: uncaught exception — crashing');
    process.exit(1);
  });
}