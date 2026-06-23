'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { DLQItem } from '../../types';

type RowActionStatus = 'replaying' | 'resolving' | null;

interface DLQTableProps {
  items:                  DLQItem[];
  isLoading:              boolean;
  page:                   number;
  totalPages:             number;
  unresolvedOnly:         boolean;
  error:                  string | null;
  onUnresolvedOnlyChange: (v: boolean) => void;
  onNextPage:             () => void;
  onPrevPage:             () => void;
  onReplay:               (id: string) => Promise<string>;
  onResolve:              (id: string) => Promise<void>;
  onRefetch:              () => void;
}

export function DLQTable({
  items, isLoading, page, totalPages, unresolvedOnly, error,
  onUnresolvedOnlyChange, onNextPage, onPrevPage, onReplay, onResolve, onRefetch,
}: DLQTableProps) {

  const [rowStatuses, setRowStatuses] = useState<Map<string, RowActionStatus>>(new Map());
  const [inlineMsg,   setInlineMsg]   = useState<{ text: string; isError: boolean } | null>(null);

  function setRowStatus(id: string, status: RowActionStatus) {
    setRowStatuses((prev) => {
      const next = new Map(prev);
      if (status === null) next.delete(id);
      else next.set(id, status);
      return next;
    });
  }

  function showMsg(text: string, isError = false) {
    setInlineMsg({ text, isError });
    setTimeout(() => setInlineMsg(null), 4000);
  }

  const handleReplay = useCallback(async (itemId: string) => {
    setRowStatus(itemId, 'replaying');
    try {
      const newId = await onReplay(itemId);
      showMsg(`Replayed — new delivery ID: ${newId.substring(0, 8)}...`);
    } catch (err) {
      showMsg((err as { message?: string }).message ?? 'Replay failed', true);
    } finally {
      setRowStatus(itemId, null);
    }
  }, [onReplay]);

  const handleResolve = useCallback(async (itemId: string) => {
    setRowStatus(itemId, 'resolving');
    try {
      await onResolve(itemId);
      showMsg('Item marked as resolved.');
    } catch (err) {
      showMsg((err as { message?: string }).message ?? 'Resolve failed', true);
    } finally {
      setRowStatus(itemId, null);
    }
  }, [onResolve]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          {[
            { label: 'Unresolved', value: true  },
            { label: 'All',        value: false },
          ].map(({ label, value }) => (
            <button
              key={label}
              onClick={() => onUnresolvedOnlyChange(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                unresolvedOnly === value
                  ? 'bg-white/[0.08] text-[#f0f2f5]'
                  : 'text-[#6b7280] hover:text-[#f0f2f5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={onRefetch}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-3
                     py-1.5 text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]
                     disabled:opacity-50"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
          {error}
        </div>
      )}

      {isLoading ? (
        <DLQTableSkeleton />
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-[#3ecf8e]" size={32} />
          <p className="text-sm text-[#f0f2f5]">
            {unresolvedOnly ? 'No unresolved items' : 'Dead letter queue is empty'}
          </p>
          <p className="mt-1 text-xs text-[#6b7280]">
            All webhook deliveries are resolved or no failures have occurred.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <DLQRow
              key={item.id}
              item={item}
              actionStatus={rowStatuses.get(item.id) ?? null}
              onReplay={() => handleReplay(item.id)}
              onResolve={() => handleResolve(item.id)}
            />
          ))}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={onPrevPage}
            disabled={page === 1}
            className="flex items-center gap-1 rounded-lg border border-white/[0.06] px-3 py-2
                       text-xs text-[#6b7280] disabled:opacity-40 hover:text-[#f0f2f5]"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-xs text-[#6b7280]">{page} / {totalPages}</span>
          <button
            onClick={onNextPage}
            disabled={page === totalPages}
            className="flex items-center gap-1 rounded-lg border border-white/[0.06] px-3 py-2
                       text-xs text-[#6b7280] disabled:opacity-40 hover:text-[#f0f2f5]"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {inlineMsg && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            inlineMsg.isError
              ? 'border-[#f87171]/20 bg-[#f87171]/5 text-[#f87171]'
              : 'border-[#3ecf8e]/20 bg-[#3ecf8e]/5 text-[#3ecf8e]'
          }`}
        >
          {inlineMsg.text}
        </div>
      )}
    </div>
  );
}

function DLQRow({
  item, actionStatus, onReplay, onResolve,
}: {
  item:         DLQItem;
  actionStatus: RowActionStatus;
  onReplay:     () => void;
  onResolve:    () => void;
}) {
  const isResolved = item.resolvedAt !== null;
  const isActing   = actionStatus !== null;

  return (
    <div
      className={`rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 transition-opacity ${
        isResolved ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-[#6b7280]">
              dlq_{item.id.substring(0, 8)}
            </span>
            <span className="text-[#6b7280]/40">·</span>
            <span className="font-mono text-xs text-[#6b7280]">
              evt_{item.transactionEventId.substring(0, 8)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isResolved
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {isResolved ? 'Resolved' : 'Unresolved'}
            </span>
          </div>

          <p className="mb-2 text-sm text-[#f0f2f5]">
            {item.failureReason.length > 90
              ? `${item.failureReason.substring(0, 90)}...`
              : item.failureReason}
          </p>

          <div className="flex flex-wrap gap-4 text-xs text-[#6b7280]">
            <span>
              {item.attemptCount} attempt{item.attemptCount !== 1 ? 's' : ''}
            </span>
            <span>
              {new Date(item.createdAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
            {isResolved && item.resolvedAt && (
              <span className="text-[#3ecf8e]">
                Resolved {new Date(item.resolvedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {!isResolved && (
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={onReplay}
              disabled={isActing}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500
                         to-teal-500 px-3 py-1.5 text-xs font-medium text-white
                         transition-opacity hover:opacity-90
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionStatus === 'replaying'
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />
              }
              {actionStatus === 'replaying' ? 'Queuing...' : 'Replay'}
            </button>

            <button
              onClick={onResolve}
              disabled={isActing}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-3
                         py-1.5 text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionStatus === 'resolving'
                ? <Loader2 size={12} className="animate-spin" />
                : <CheckCircle2 size={12} />
              }
              {actionStatus === 'resolving' ? 'Saving...' : 'Resolve'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DLQTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
          <div className="mb-2 flex gap-2">
            <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-3 w-20 animate-pulse rounded bg-white/[0.05]" />
          </div>
          <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-3 w-32 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}
