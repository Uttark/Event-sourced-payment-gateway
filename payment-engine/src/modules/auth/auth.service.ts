import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import crypto from 'crypto';
import { Currency, UserStatus } from '@prisma/client';
import prisma from '../../config/database';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import logger from '../../utils/logger';
import { AppError, JwtPayload } from '../../types';
import type { RegisterInput, LoginInput } from './auth.validation';

const BCRYPT_SALT_ROUNDS = 12;

export async function registerUser(data: RegisterInput): Promise<{
  user: { id: string; email: string; name: string };
  token: string;
}> {

  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });

  if (existingUser) {
    throw new AppError('Email address is already registered', 409, 'EMAIL_ALREADY_EXISTS');
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

  const { newUser } = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
      },
    });

    const defaultWallet = await tx.wallet.create({
      data: {
        userId: newUser.id,
        currency: Currency.USD,
      },
    });

    await tx.walletProjection.create({
      data: {
        walletId: defaultWallet.id,
        userId: newUser.id,
        currency: Currency.USD,
      },
    });

    return { newUser };
  });

  const token = generateJwt(newUser.id, newUser.email);

  logger.info({ userId: newUser.id, email: newUser.email }, 'New user registered');

  return {
    user: { id: newUser.id, email: newUser.email, name: newUser.name },
    token,
  };
}

export async function loginUser(data: LoginInput): Promise<{
  user: { id: string; email: string; name: string };
  token: string;
}> {
  const user = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (!user) {
    throw new AppError('Email does not exist', 401, 'EMAIL_NOT_FOUND');
  }

  if (user.status === UserStatus.DELETED) {
    throw new AppError('Email does not exist', 401, 'EMAIL_NOT_FOUND');
  }

  if (user.status === UserStatus.SUSPENDED) {
    throw new AppError(
      'Your account has been suspended. Please contact support.',
      403,
      'ACCOUNT_SUSPENDED',
    );
  }

  const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError('Wrong password', 401, 'WRONG_PASSWORD');
  }

  const token = generateJwt(user.id, user.email);

  logger.info({ userId: user.id, email: user.email }, 'User logged in');

  return {
    user: { id: user.id, email: user.email, name: user.name },
    token,
  };
}

export async function logoutUser(jti: string, tokenExp: number): Promise<void> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const remainingTtlSeconds = tokenExp - nowInSeconds;

  if (remainingTtlSeconds > 0) {

    await redisClient.set(
      `blacklist:jwt:${jti}`,
      '1',
      'EX',
      remainingTtlSeconds,
    );
    logger.info({ jti, ttlSeconds: remainingTtlSeconds }, 'JWT blacklisted on logout');
  }
}

function generateJwt(userId: string, email: string): string {

  const jti = crypto.randomUUID();

  const payload: JwtPayload = {
    userId,
    email,
    jti,
  };

  return jwt.sign(payload, env.JWT_SECRET, {

    expiresIn: env.JWT_EXPIRES_IN as any,
  });
}