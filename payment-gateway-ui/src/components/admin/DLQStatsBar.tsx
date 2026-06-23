'use client';

import { Inbox, AlertCircle, CheckCircle2, Server } from 'lucide-react';
import { DLQStats } from '../../types';

interface DLQStatsBarProps {
  stats:     DLQStats | null;
  isLoading: boolean;
}

export function DLQStatsBar({ stats, isLoading }: DLQStatsBarProps) {
  if (isLoading || !stats) return <DLQStatsBarSkeleton />;

  const cards = [
    {
      label: 'Total Failed',
      value: stats.total,
      icon:  Inbox,
      color: 'text-[#6b7280]',
      bg:    'bg-white/[0.04]',
      border: 'border-white/[0.06]',
    },
    {
      label: 'Unresolved',
      value: stats.unresolved,
      icon:  AlertCircle,
      color:  stats.unresolved > 0 ? 'text-[#f87171]' : 'text-[#6b7280]',
      bg:     stats.unresolved > 0 ? 'bg-[#f87171]/5' : 'bg-white/[0.04]',
      border: stats.unresolved > 0 ? 'border-[#f87171]/20' : 'border-white/[0.06]',
    },
    {
      label: 'Resolved',
      value: stats.resolved,
      icon:  CheckCircle2,
      color: 'text-[#3ecf8e]',
      bg:    'bg-white/[0.04]',
      border: 'border-white/[0.06]',
    },
    {
      label: 'Failing Endpoints',
      value: stats.topFailingEndpoints.length,
      icon:  Server,
      color:  stats.topFailingEndpoints.length > 0 ? 'text-[#fbbf24]' : 'text-[#6b7280]',
      bg:     stats.topFailingEndpoints.length > 0 ? 'bg-[#fbbf24]/5' : 'bg-white/[0.04]',
      border: stats.topFailingEndpoints.length > 0 ? 'border-[#fbbf24]/20' : 'border-white/[0.06]',
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color, bg, border }) => (
        <div
          key={label}
          className={`rounded-xl border ${border} ${bg} p-4`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-[#6b7280]">{label}</span>
            <Icon size={14} className={color} />
          </div>
          <p className={`font-mono text-2xl font-semibold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function DLQStatsBarSkeleton() {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
          <div className="mb-3 h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-7 w-12 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}
