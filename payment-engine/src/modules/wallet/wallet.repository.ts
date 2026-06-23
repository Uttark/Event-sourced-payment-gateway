import { Prisma, Currency } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../config/database';

interface LockedWalletRow {
  id: string;
  balance: string;
  status: string;
  currency: string;
}

export async function findWalletsByUserId(userId: string) {
  return prisma.wallet.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findWalletByIdAndUserId(walletId: string, userId: string) {
  return prisma.wallet.findFirst({
    where: { id: walletId, userId },
  });
}

export async function findProjectionsByUserId(userId: string) {
  return prisma.walletProjection.findMany({
    where: { userId },
  });
}

export async function findProjectionByWalletId(walletId: string) {
  return prisma.walletProjection.findUnique({
    where: { walletId },
  });
}

export async function lockWalletForUpdate(
  walletId: string,
  tx: Prisma.TransactionClient,
): Promise<LockedWalletRow | null> {
  const rows = await tx.$queryRaw<LockedWalletRow[]>`
    SELECT
      id,
      balance::TEXT   AS balance,
      status::TEXT    AS status,
      currency::TEXT  AS currency
    FROM wallets
    WHERE id = ${walletId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

export async function incrementWalletBalance(
  walletId: string,
  amount: Decimal,
  tx: Prisma.TransactionClient,
): Promise<void> {

  const amountStr = amount.toFixed(8);

  await tx.$executeRaw`
    UPDATE wallets
    SET    balance    = balance + ${amountStr}::DECIMAL(20, 8),
           updated_at = NOW()
    WHERE  id = ${walletId}
  `;
}

export async function decrementWalletBalance(
  walletId: string,
  amount: Decimal,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const amountStr = amount.toFixed(8);

  await tx.$executeRaw`
    UPDATE wallets
    SET    balance    = balance - ${amountStr}::DECIMAL(20, 8),
           updated_at = NOW()
    WHERE  id = ${walletId}
  `;
}

export async function createWallet(userId: string, currency: Currency) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.create({
      data: { userId, currency },
    });

    await tx.walletProjection.create({
      data: {
        walletId: wallet.id,
        userId,
        currency,

      },
    });

    return wallet;
  });
}