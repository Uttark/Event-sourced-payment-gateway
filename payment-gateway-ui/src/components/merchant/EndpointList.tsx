'use client';

import { useState, useCallback } from 'react';
import { Power, ExternalLink, Loader2 } from 'lucide-react';
import { WebhookEndpoint } from '../../types';

interface EndpointListProps {
  endpoints:       WebhookEndpoint[];
  isLoading:       boolean;
  error:           string | null;
  deactivatingIds: Set<string>;
  onDeactivate:    (endpointId: string) => Promise<void>;
}

export function EndpointList({
  endpoints, isLoading, error, deactivatingIds, onDeactivate,
}: EndpointListProps) {

  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());

  const handleDeactivate = useCallback(async (endpointId: string) => {
    try {
      await onDeactivate(endpointId);
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Failed to deactivate endpoint';
      setRowErrors((prev) => new Map(prev).set(endpointId, message));

      setTimeout(() => {
        setRowErrors((prev) => {
          const next = new Map(prev);
          next.delete(endpointId);
          return next;
        });
      }, 5000);
    }
  }, [onDeactivate]);

  if (isLoading) return <EndpointListSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
        {error}
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.10] py-10 text-center">
        <p className="text-sm text-[#f0f2f5]">No webhook endpoints registered yet.</p>
        <p className="mt-1 text-xs text-[#6b7280]">
          Use the form above to register your first endpoint.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {endpoints.map((endpoint) => (
        <EndpointRow
          key={endpoint.id}
          endpoint={endpoint}
          isDeactivating={deactivatingIds.has(endpoint.id)}
          rowError={rowErrors.get(endpoint.id) ?? null}
          onDeactivate={() => handleDeactivate(endpoint.id)}
        />
      ))}
    </div>
  );
}

function EndpointRow({
  endpoint, isDeactivating, rowError, onDeactivate,
}: {
  endpoint:      WebhookEndpoint;
  isDeactivating: boolean;
  rowError:       string | null;
  onDeactivate:   () => void;
}) {

  const eventSummary =
    endpoint.eventTypes.length === 0
      ? 'All events'
      : endpoint.eventTypes.length <= 2
      ? endpoint.eventTypes.join(', ')
      : `${endpoint.eventTypes.slice(0, 2).join(', ')} +${endpoint.eventTypes.length - 2} more`;

  return (
    <div
      className={`rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 transition-opacity ${
        endpoint.isActive ? '' : 'opacity-50'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <a
            href={endpoint.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 flex items-center gap-1.5 truncate font-mono text-sm
                       text-[#f0f2f5] transition-colors hover:text-[#3ecf8e]"
          >
            <span className="truncate">{endpoint.url}</span>
            <ExternalLink size={11} className="flex-shrink-0" />
          </a>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                endpoint.isActive
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-white/[0.06] text-[#6b7280]'
              }`}
            >
              {endpoint.isActive ? 'Active' : 'Inactive'}
            </span>

            <span className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[#6b7280]">
              {eventSummary}
            </span>

            <span className="text-[#6b7280]">
              {new Date(endpoint.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </span>
          </div>

          {rowError && (
            <p className="mt-2 text-xs text-[#f87171]">{rowError}</p>
          )}
        </div>

        {endpoint.isActive && (
          <button
            onClick={onDeactivate}
            disabled={isDeactivating}
            title="Stop all future webhook deliveries to this URL"
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06]
                       px-3 py-1.5 text-xs text-[#6b7280] transition-colors
                       hover:border-[#f87171]/30 hover:text-[#f87171]
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeactivating
              ? <Loader2 size={12} className="animate-spin" />
              : <Power size={12} />
            }
            {isDeactivating ? 'Deactivating...' : 'Deactivate'}
          </button>
        )}
      </div>
    </div>
  );
}

function EndpointListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
          <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-white/[0.05]" />
          <div className="flex gap-2">
            <div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="h-5 w-24 animate-pulse rounded-full bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}
