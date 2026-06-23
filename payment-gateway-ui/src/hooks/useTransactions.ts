'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Transaction, TransactionFilterType } from '../types';
import { apiFetch } from '../lib/api';
import { applyTransactionFilter, computeFilterCounts, FilterCounts } from '../components/ui/TransactionFilters';

interface TransactionsApiResponse {
  success: boolean;
  data: {
    events: Array<{
      transactionId: string;
      eventType:     string;
      amount:        string;
      currency:      string;
      createdAt:     string;
    }>;
    pagination: { total: number; page: number; totalPages: number };
  };
}

interface UseTransactionsReturn {

  isLoading:    boolean;
  error:        string | null;

  filteredTransactions: Transaction[];
  filterCounts:         FilterCounts;

  activeFilter:   TransactionFilterType;
  setActiveFilter: (f: TransactionFilterType) => void;

  page:         number;
  totalPages:   number;
  goToNextPage: () => void;
  goToPrevPage: () => void;

  refetch:      () => Promise<void>;
}

function toTransactionType(eventType: string): Transaction['type'] {
  if (
    eventType.includes('DEPOSIT') ||
    eventType.includes('TOPUP') ||
    eventType.includes('GATEWAY_CHARGE') ||
    eventType.includes('PAYMENT_COMPLETED') ||
    eventType.includes('PAYMENT_FAILED') ||
    eventType === 'FRAUD_FLAGGED' ||
    eventType === 'REFUND_INITIATED'
  ) return 'TOPUP';
  if (eventType.includes('PAYOUT')) return 'PAYOUT';
  if (eventType === 'TRANSFER_DEBIT') return 'TRANSFER_OUT';
  if (eventType === 'TRANSFER_CREDIT') return 'TRANSFER_IN';
  return 'TRANSFER';
}

function toTransactionStatus(eventType: string): Transaction['status'] {
  if ([
    'PAYMENT_COMPLETED',
    'GATEWAY_CHARGE_SUCCEEDED',
    'DEPOSIT_COMPLETED',
    'TRANSFER_DEBIT',
    'TRANSFER_CREDIT',
  ].includes(eventType)) return 'COMPLETED';

  if (['PAYMENT_FAILED', 'GATEWAY_CHARGE_FAILED'].includes(eventType))
    return 'FAILED';
  if (['FRAUD_FLAGGED', 'REFUND_INITIATED'].includes(eventType))
    return 'FLAGGED';
  return 'PENDING';
}

const ITEMS_PER_PAGE = 10;

export function useTransactions(): UseTransactionsReturn {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading,    setIsLoading]    = useState<boolean>(true);
  const [error,        setError]        = useState<string | null>(null);

  const [page,         setPage]         = useState<number>(1);
  const [totalPages,   setTotalPages]   = useState<number>(1);

  const [activeFilter, setActiveFilter] = useState<TransactionFilterType>('all');

  const fetchTransactions = useCallback(async (currentPage: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TransactionsApiResponse>(
        `/api/transactions?page=${currentPage}&limit=${ITEMS_PER_PAGE}`,
      );
      setTransactions(
        res.data.events.map((e) => ({
          id:        e.transactionId,
          amount:    parseFloat(e.amount),
          type:      toTransactionType(e.eventType),
          status:    toTransactionStatus(e.eventType),
          currency:  e.currency,
          createdAt: e.createdAt,
        })),
      );
      setTotalPages(res.data.pagination.totalPages);
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTransactions(page); }, [page, fetchTransactions]);

  const filterCounts = useMemo(() => computeFilterCounts(transactions), [transactions]);
  const filteredTransactions = useMemo(
    () => applyTransactionFilter(transactions, activeFilter),
    [transactions, activeFilter]
  );

  return {
    isLoading,
    error,
    filteredTransactions,
    filterCounts,
    activeFilter,
    setActiveFilter,
    page,
    totalPages,
    goToNextPage: () => setPage((p) => Math.min(p + 1, totalPages)),
    goToPrevPage: () => setPage((p) => Math.max(p - 1, 1)),
    refetch:      () => fetchTransactions(page),
  };
}