'use client';

import {
  X,
  Clock,
  CreditCard,
  CheckCircle2,
  XCircle,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import {
  TransactionDetail,
  TransactionDetailEvent,
  formatAmount,
  getCurrencySymbol,
} from '../../types';

interface TransactionDetailPanelProps {
  isOpen:    boolean;
  detail:    TransactionDetail | null;
  isLoading: boolean;
  error:     string | null;
  onClose:   () => void;
}

export function TransactionDetailPanel({
  isOpen,
  detail,
  isLoading,
  error,
  onClose,
}: TransactionDetailPanelProps) {
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col
                    border-l border-white/[0.06] bg-[#0f1012]
                    transform transition-transform duration-300 ease-in-out ${
                      isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h2 className="font-semibold text-[#f0f2f5]">Transaction Detail</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-white/[0.06] hover:text-[#f0f2f5]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading && <PanelSkeleton />}
          {error    && <PanelError message={error} />}
          {detail   && <PanelContent detail={detail} />}
        </div>
      </div>
    </>
  );
}

function PanelContent({ detail }: { detail: TransactionDetail }) {
  const symbol = getCurrencySymbol(detail.currency);

  return (
    <div>
      <div className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
        <p className="mb-1 font-mono text-xs text-[#6b7280]">
          {detail.transactionId.substring(0, 8)}...
        </p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg text-[#6b7280]">{symbol}</span>
          <span className="font-mono text-3xl font-semibold text-[#f0f2f5]">
            {formatAmount(detail.amount)}
          </span>
          <span className="ml-2 font-mono text-sm text-[#6b7280]">{detail.currency}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={detail.currentStatus} />
          <span className="text-xs text-[#6b7280]">{detail.eventCount} events</span>
        </div>
      </div>

      <p className="mb-4 text-xs font-medium uppercase tracking-wider text-[#6b7280]">
        Event Timeline
      </p>

      <EventTimeline events={detail.events} />
    </div>
  );
}

function EventTimeline({ events }: { events: TransactionDetailEvent[] }) {
  return (
    <div>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const config = getEventConfig(event.eventType);
        const Icon   = config.icon;

        return (
          <div key={event.eventId} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${config.bgColor}`}
              >
                <Icon size={14} className={config.iconColor} />
              </div>
              {!isLast && <div className="my-1 w-px flex-1 bg-white/[0.06]" />}
            </div>

            <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[#f0f2f5]">
                  {config.label}
                </span>
                <span className="flex-shrink-0 font-mono text-xs text-[#6b7280]">
                  {new Date(event.createdAt).toLocaleTimeString('en-US', {
                    hour:   '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              {event.gatewayOrderId && (
                <p className="mt-1 truncate font-mono text-xs text-[#6b7280]">
                  Order: {event.gatewayOrderId}
                </p>
              )}
              {event.gatewayPaymentId && (
                <p className="mt-0.5 truncate font-mono text-xs text-[#6b7280]">
                  Payment: {event.gatewayPaymentId}
                </p>
              )}

              {event.fraudScore !== null && (
                <FraudScoreBar score={event.fraudScore} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FraudScoreBar({ score }: { score: number }) {

  const percentage = Math.round(score * 100);
  const barColor =
    score >= 0.85 ? 'bg-[#f87171]' :
    score >= 0.50 ? 'bg-[#fbbf24]' :
                    'bg-[#3ecf8e]';

  return (
    <div className="mt-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-[#6b7280]">Fraud Score</span>
        <span className="font-mono text-xs text-[#6b7280]">{percentage}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PAYMENT_COMPLETED:        'bg-emerald-500/10 text-emerald-400',
    GATEWAY_CHARGE_SUCCEEDED: 'bg-emerald-500/10 text-emerald-400',
    DEPOSIT_COMPLETED:        'bg-emerald-500/10 text-emerald-400',
    TRANSFER_DEBIT:           'bg-emerald-500/10 text-emerald-400',
    TRANSFER_CREDIT:          'bg-emerald-500/10 text-emerald-400',
    PAYMENT_FAILED:           'bg-red-500/10 text-red-400',
    GATEWAY_CHARGE_FAILED:    'bg-red-500/10 text-red-400',
    FRAUD_FLAGGED:            'bg-amber-500/10 text-amber-400',
    INITIALIZED:              'bg-white/[0.06] text-[#6b7280]',
  };

  const label = status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-white/[0.06] text-[#6b7280]'}`}>
      {label}
    </span>
  );
}

function PanelSkeleton() {
  return (
    <div>
      <div className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
        <div className="mb-2 h-3 w-32 animate-pulse rounded bg-white/[0.05]" />
        <div className="h-9 w-40 animate-pulse rounded bg-white/[0.05]" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="mb-5 flex gap-4">
          <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-36 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-2.5 w-48 animate-pulse rounded bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <XCircle className="mb-3 text-[#f87171]" size={32} />
      <p className="text-sm text-[#f0f2f5]">Failed to load events</p>
      <p className="mt-1 text-xs text-[#6b7280]">{message}</p>
    </div>
  );
}

interface EventConfig {
  label:     string;
  icon:      LucideIcon;
  iconColor: string;
  bgColor:   string;
}

function getEventConfig(eventType: string): EventConfig {
  const configs: Record<string, EventConfig> = {
    INITIALIZED:              { label: 'Payment Initialized',    icon: Clock,         iconColor: 'text-[#6b7280]', bgColor: 'bg-white/[0.06]'   },
    GATEWAY_CHARGE_SUCCEEDED: { label: 'Gateway Charge Success', icon: CreditCard,    iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    GATEWAY_CHARGE_FAILED:    { label: 'Gateway Charge Failed',  icon: XCircle,       iconColor: 'text-[#f87171]', bgColor: 'bg-[#f87171]/10'   },
    PAYMENT_COMPLETED:        { label: 'Payment Completed',      icon: CheckCircle2,  iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    PAYMENT_FAILED:           { label: 'Payment Failed',         icon: XCircle,       iconColor: 'text-[#f87171]', bgColor: 'bg-[#f87171]/10'   },
    DEPOSIT_INITIATED:        { label: 'Deposit Initiated',      icon: ArrowDownLeft, iconColor: 'text-[#6b7280]', bgColor: 'bg-white/[0.06]'   },
    DEPOSIT_COMPLETED:        { label: 'Deposit Completed',      icon: ArrowDownLeft, iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    TRANSFER_DEBIT:           { label: 'Funds Sent',             icon: ArrowUpRight,  iconColor: 'text-[#f87171]', bgColor: 'bg-[#f87171]/10'   },
    TRANSFER_CREDIT:          { label: 'Funds Received',         icon: ArrowDownLeft, iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    FRAUD_FLAGGED:            { label: 'Fraud Flagged',          icon: AlertTriangle, iconColor: 'text-[#fbbf24]', bgColor: 'bg-[#fbbf24]/10'   },
    FRAUD_CLEARED:            { label: 'Fraud Cleared',          icon: ShieldCheck,   iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    REFUND_INITIATED:         { label: 'Refund Initiated',       icon: RefreshCw,     iconColor: 'text-[#fbbf24]', bgColor: 'bg-[#fbbf24]/10'   },
    REFUND_COMPLETED:         { label: 'Refund Completed',       icon: RefreshCw,     iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    REFUND_FAILED:            { label: 'Refund Failed',          icon: XCircle,       iconColor: 'text-[#f87171]', bgColor: 'bg-[#f87171]/10'   },
    PAYOUT_INITIATED:         { label: 'Payout Initiated',       icon: ArrowUpRight,  iconColor: 'text-[#6b7280]', bgColor: 'bg-white/[0.06]'   },
    PAYOUT_COMPLETED:         { label: 'Payout Completed',       icon: ArrowUpRight,  iconColor: 'text-[#3ecf8e]', bgColor: 'bg-[#3ecf8e]/10'   },
    PAYOUT_FAILED:            { label: 'Payout Failed',          icon: XCircle,       iconColor: 'text-[#f87171]', bgColor: 'bg-[#f87171]/10'   },
  };

  return configs[eventType] ?? {
    label:     eventType.replace(/_/g, ' '),
    icon:      Clock,
    iconColor: 'text-[#6b7280]',
    bgColor:   'bg-white/[0.06]',
  };
}
