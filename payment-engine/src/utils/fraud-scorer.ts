import axios from 'axios';
import Decimal from 'decimal.js';
import { env } from '../config/env';
import logger from './logger';
import { FraudAiScoringResult, TransactionEventJobData } from '../types';

function computeMockFraudScore(
  jobData: TransactionEventJobData,
): FraudAiScoringResult {
  const amount = new Decimal(jobData.amount);
  const reasons: string[] = [];

  const amountFixed = amount.toFixed(2);

  if (amountFixed.endsWith('.77')) {
    return {
      score: 0.90,
      decision: 'BLOCK',
      reasons: ['TEST_HOOK: amount ending .77 → forced BLOCK (score 0.90)'],
      modelVersion: 'mock-v1.0',
    };
  }

  if (amountFixed.endsWith('.55')) {
    return {
      score: 0.65,
      decision: 'FLAG',
      reasons: ['TEST_HOOK: amount ending .55 → forced FLAG (score 0.65)'],
      modelVersion: 'mock-v1.0',
    };
  }

  let score = 0.0;

  if (amount.greaterThan(new Decimal('1000'))) {
    score += 0.30;
    reasons.push(
      `High-value transaction: ${amount.toFixed(2)} ${jobData.currency}`,
    );
  } else if (amount.greaterThan(new Decimal('500'))) {
    score += 0.15;
    reasons.push(
      `Elevated transaction amount: ${amount.toFixed(2)} ${jobData.currency}`,
    );
  } else if (amount.greaterThan(new Decimal('100'))) {
    score += 0.05;
  }

  if (jobData.metadata?.fraudFlagged === true) {
    score += 0.25;
    reasons.push(
      `Tier 1 velocity flag carried over: ${
        (jobData.metadata.fraudRule as string) ?? 'velocity threshold exceeded'
      }`,
    );
  }

  const fractionalPart = amount.minus(amount.floor());
  const isExactlyRound = fractionalPart.isZero();

  if (isExactlyRound && amount.greaterThanOrEqualTo(new Decimal('200'))) {
    score += 0.10;
    reasons.push(
      `Round-number amount pattern (${amount.toFixed(2)}) — potential card testing`,
    );
  }

  const utcHour = new Date().getUTCHours();
  if (utcHour >= 2 && utcHour <= 5) {
    score += 0.10;
    reasons.push(
      `High-risk time window: ${String(utcHour).padStart(2, '0')}:00 UTC`,
    );
  }

  score = Math.min(score, 1.0);

  let decision: 'ALLOW' | 'FLAG' | 'BLOCK';

  if (score >= env.FRAUD_SCORE_BLOCK_THRESHOLD) {
    decision = 'BLOCK';
  } else if (score >= env.FRAUD_SCORE_FLAG_THRESHOLD) {
    decision = 'FLAG';
  } else {
    decision = 'ALLOW';
    if (reasons.length === 0) {
      reasons.push('All risk indicators within normal range');
    }
  }

  return {
    score,
    decision,
    reasons,
    modelVersion: 'mock-v1.0',
  };
}

async function callFraudApi(
  jobData: TransactionEventJobData,
): Promise<FraudAiScoringResult> {

  const requestPayload = {
    transactionId: jobData.transactionId,
    userId: jobData.userId,
    walletId: jobData.walletId,
    amount: jobData.amount,
    currency: jobData.currency,
    gatewayOrderId: jobData.gatewayOrderId,
    tier1FraudFlagged: jobData.metadata?.fraudFlagged ?? false,
    tier1FraudRule: jobData.metadata?.fraudRule ?? null,
    transactionTimestamp: jobData.createdAt,
  };

  const response = await axios.post<FraudAiScoringResult>(
    env.FRAUD_API_URL as string,
    requestPayload,
    {
      headers: {
        Authorization: `Bearer ${env.FRAUD_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      timeout: 5_000,
    },
  );

  return response.data;
}

export async function scoreTransaction(
  jobData: TransactionEventJobData,
): Promise<FraudAiScoringResult> {
  if (env.MOCK_GATEWAY || !env.FRAUD_API_URL) {
    return computeMockFraudScore(jobData);
  }

  try {
    const result = await callFraudApi(jobData);

    logger.debug(
      {
        transactionId: jobData.transactionId,
        score: result.score,
        decision: result.decision,
        modelVersion: result.modelVersion,
      },
      'External fraud API scored transaction',
    );

    return result;
  } catch (err) {

    logger.warn(
      { err, transactionId: jobData.transactionId },
      'Fraud API call failed — falling back to mock scorer (fail-open)',
    );

    return computeMockFraudScore(jobData);
  }
}