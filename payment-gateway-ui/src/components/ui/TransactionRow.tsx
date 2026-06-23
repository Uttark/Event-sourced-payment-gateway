import {
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Transaction, formatINR, getCurrencySymbol } from '../../types';

interface TransactionRowProps {
  transaction: Transaction;
  onClick?:    () => void;
}

const TYPE_CONFIG = {
  TOPUP: {
    icon:      ArrowDownRight,
    iconColor: 'text-[#3ecf8e]',
    iconBg:    'bg-[#3ecf8e]/10',
    amountColor: 'text-[#3ecf8e]',
    prefix:    '+',
  },
  PAYOUT: {
    icon:      ArrowUpRight,
    iconColor: 'text-[#f87171]',
    iconBg:    'bg-[#f87171]/10',
    amountColor: 'text-[#f87171]',
    prefix:    '-',
  },
  TRANSFER: {
    icon:      RefreshCw,
    iconColor: 'text-[#6b7280]',
    iconBg:    'bg-white/[0.06]',
    amountColor: 'text-[#f0f2f5]',
    prefix:    '',
  },
  TRANSFER_IN: {
    icon:      ArrowDownRight,
    iconColor: 'text-[#3ecf8e]',
    iconBg:    'bg-[#3ecf8e]/10',
    amountColor: 'text-[#3ecf8e]',
    prefix:    '+',
  },
  TRANSFER_OUT: {
    icon:      ArrowUpRight,
    iconColor: 'text-[#f87171]',
    iconBg:    'bg-[#f87171]/10',
    amountColor: 'text-[#f87171]',
    prefix:    '-',
  },
};

const STATUS_CONFIG = {
  COMPLETED: { label: 'Completed', classes: 'bg-emerald-500/10 text-emerald-400' },
  PENDING:   { label: 'Pending',   classes: 'bg-amber-500/10 text-amber-400'     },
  FAILED:    { label: 'Failed',    classes: 'bg-red-500/10 text-red-400'          },
  FLAGGED:   { label: 'Flagged',   classes: 'bg-amber-500/10 text-amber-400'     },
};

export function TransactionRow({ transaction, onClick }: TransactionRowProps) {
  const typeConfig   = TYPE_CONFIG[transaction.type]   ?? TYPE_CONFIG.TRANSFER;
  const statusConfig = STATUS_CONFIG[transaction.status] ?? STATUS_CONFIG.PENDING;
  const Icon         = transaction.status === 'FLAGGED' ? AlertTriangle : typeConfig.icon;

  const shortId = transaction.id.substring(0, 8) + '...';

  const formattedDate = new Date(transaction.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-xl border border-white/[0.04]
                  px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]
                  ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${typeConfig.iconBg}`}>
        <Icon size={18} className={transaction.status === 'FLAGGED' ? 'text-[#fbbf24]' : typeConfig.iconColor} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-[#6b7280]">{shortId}</p>
        <p className="text-xs text-[#6b7280]">{formattedDate}</p>
      </div>

      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.classes}`}>
        {statusConfig.label}
      </span>

      <p className={`w-24 text-right font-mono text-sm font-medium ${typeConfig.amountColor}`}>
        {typeConfig.prefix}{getCurrencySymbol(transaction.currency)}{formatINR(transaction.amount)}
      </p>
    </button>
  );
}