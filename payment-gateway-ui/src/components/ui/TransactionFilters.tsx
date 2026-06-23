'use client';

import { TransactionFilterType, Transaction } from '../../types';

interface FilterConfig {
  key:   TransactionFilterType;
  label: string;
}

const FILTER_TABS: FilterConfig[] = [
  { key: 'all',       label: 'All'       },
  { key: 'topups',    label: 'Top-ups'   },
  { key: 'transfers', label: 'Transfers' },
  { key: 'payments',  label: 'Payments'  },
  { key: 'failed',    label: 'Failed'    },
];

export type FilterCounts = Record<TransactionFilterType, number>;

export function computeFilterCounts(transactions: Transaction[]): FilterCounts {
  return {
    all:       transactions.length,
    topups:    transactions.filter((t) => t.type === 'TOPUP').length,
    transfers: transactions.filter((t) => t.type === 'TRANSFER' || t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT').length,
    payments:  transactions.filter((t) => t.type === 'PAYOUT').length,
    failed:    transactions.filter((t) => t.status === 'FAILED' || t.status === 'FLAGGED').length,
  };
}

export function applyTransactionFilter(
  transactions: Transaction[],
  filter: TransactionFilterType,
): Transaction[] {
  switch (filter) {
    case 'all':       return transactions;
    case 'topups':    return transactions.filter((t) => t.type === 'TOPUP');
    case 'transfers': return transactions.filter((t) => t.type === 'TRANSFER' || t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT');
    case 'payments':  return transactions.filter((t) => t.type === 'PAYOUT');
    case 'failed':    return transactions.filter((t) => t.status === 'FAILED' || t.status === 'FLAGGED');
  }
}

interface TransactionFiltersProps {
  activeFilter:   TransactionFilterType;
  onFilterChange: (filter: TransactionFilterType) => void;
  counts:         FilterCounts;
  isLoading:      boolean;
}

export function TransactionFilters({
  activeFilter, onFilterChange, counts, isLoading,
}: TransactionFiltersProps) {
  if (isLoading) return <TransactionFiltersSkeleton />;

  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06]
                    bg-white/[0.02] p-1">
      {FILTER_TABS.map(({ key, label }) => {
        const count       = counts[key];
        const isActive    = activeFilter === key;
        const isFailed    = key === 'failed';
        const hasItems    = count > 0;

        return (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg
                        px-3 py-2 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-white/[0.08] text-[#f0f2f5]'
                : 'text-[#6b7280] hover:text-[#f0f2f5]'
            }`}
          >
            {label}
            {hasItems && (
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-xs ${
                  isFailed
                    ? 'bg-red-500/15 text-red-400'
                    : isActive
                    ? 'bg-white/[0.12] text-[#f0f2f5]'
                    : 'bg-white/[0.05] text-[#6b7280]'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TransactionFiltersSkeleton() {
  return (
    <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-8 w-16 animate-pulse rounded-lg bg-white/[0.05]" />
      ))}
    </div>
  );
}
