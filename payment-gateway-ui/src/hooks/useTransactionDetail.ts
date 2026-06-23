'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import {
  TransactionDetail,
  TransactionDetailApiResponse,
  ApiError,
} from '../types';

interface UseTransactionDetailReturn {
  detail:    TransactionDetail | null;
  isLoading: boolean;
  error:     string | null;
  loadDetail: (transactionId: string) => Promise<void>;
  clearDetail: () => void;
}

export function useTransactionDetail(): UseTransactionDetailReturn {
  const [detail,    setDetail]    = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const loadDetail = useCallback(async (transactionId: string) => {

    setDetail(null);
    setError(null);
    setIsLoading(true);

    try {
      const res = await apiFetch<TransactionDetailApiResponse>(
        `/api/transactions/${transactionId}`,
      );
      setDetail(res.data);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load transaction detail.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearDetail = useCallback(() => {
    setDetail(null);
    setError(null);
  }, []);

  return { detail, isLoading, error, loadDetail, clearDetail };
}
