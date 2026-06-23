'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { ApiError } from '../../types';

interface AddEndpointFormProps {
  isCreating: boolean;
  onAdd:      (url: string, eventTypes: string[]) => Promise<void>;
}

const AVAILABLE_EVENT_TYPES: Array<{ value: string; label: string; description: string }> = [
  {
    value:       'PAYMENT_COMPLETED',
    label:       'Payment Completed',
    description: 'A payment was processed and settled by the ledger',
  },
  {
    value:       'GATEWAY_CHARGE_SUCCEEDED',
    label:       'Top-up Completed',
    description: 'A top-up was successfully captured from the gateway',
  },
  {
    value:       'GATEWAY_CHARGE_FAILED',
    label:       'Payment/Top-up Failed',
    description: 'Gateway declined the charge or returned an error',
  },
  {
    value:       'FRAUD_FLAGGED',
    label:       'Fraud Flagged',
    description: 'AI scorer flagged or blocked a transaction',
  },
  {
    value:       'REFUND_COMPLETED',
    label:       'Refund Completed',
    description: 'A refund was successfully processed',
  },
  {
    value:       'PAYOUT_COMPLETED',
    label:       'Payout Completed',
    description: 'Scheduled payout was successfully transferred',
  },
  {
    value:       'PAYOUT_FAILED',
    label:       'Payout Failed',
    description: 'Scheduled payout failed at the gateway',
  },
];

export function AddEndpointForm({ isCreating, onAdd }: AddEndpointFormProps) {
  const [isExpanded,    setIsExpanded]    = useState(false);
  const [url,           setUrl]           = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [urlError,      setUrlError]      = useState<string | null>(null);
  const [submitError,   setSubmitError]   = useState<string | null>(null);

  function validateUrl(value: string): string | null {
    if (!value.trim())                      return 'URL is required';
    if (!value.startsWith('https://'))      return 'URL must start with https:// — plain HTTP is not accepted for security';
    try { new URL(value); return null; }
    catch { return 'URL must be a valid URL (e.g. https://yourapp.com/webhooks)'; }
  }

  function toggleType(value: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const urlValidation = validateUrl(url);
    if (urlValidation) { setUrlError(urlValidation); return; }
    setUrlError(null);
    setSubmitError(null);

    try {
      await onAdd(url.trim(), Array.from(selectedTypes));

      setUrl('');
      setSelectedTypes(new Set());
      setIsExpanded(false);
    } catch (err) {
      setSubmitError((err as ApiError).message ?? 'Failed to register endpoint');
    }
  }

  function handleCancel() {
    setIsExpanded(false);
    setUrl('');
    setSelectedTypes(new Set());
    setUrlError(null);
    setSubmitError(null);
  }

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed
                   border-white/[0.10] py-4 text-sm text-[#6b7280] transition-colors
                   hover:border-white/[0.20] hover:text-[#f0f2f5]"
      >
        <Plus size={16} />
        Add Webhook Endpoint
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="font-medium text-[#f0f2f5]">New Webhook Endpoint</h4>
        <button
          onClick={handleCancel}
          className="text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#6b7280]">
            Endpoint URL
            <span className="ml-1.5 text-xs font-normal text-[#6b7280]/70">
              (https:// required)
            </span>
          </label>
          <input
            type="url"
            placeholder="https://yourapp.com/api/webhooks/payment-engine"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
            className={`w-full rounded-xl border ${
              urlError ? 'border-[#f87171]/50' : 'border-white/[0.06]'
            } bg-white/[0.02] px-4 py-3 font-mono text-sm text-[#f0f2f5]
              placeholder-[#6b7280]/50 outline-none transition-colors
              focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20`}
          />
          {urlError && (
            <p className="mt-1.5 text-xs text-[#f87171]">{urlError}</p>
          )}
        </div>

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <label className="text-sm font-medium text-[#6b7280]">
              Subscribe to Events
            </label>
            <span className="text-xs text-[#6b7280]">
              {selectedTypes.size === 0
                ? 'All events (none = subscribe to everything)'
                : `${selectedTypes.size} of ${AVAILABLE_EVENT_TYPES.length} selected`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AVAILABLE_EVENT_TYPES.map(({ value, label, description }) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3
                            transition-colors ${
                  selectedTypes.has(value)
                    ? 'border-[#3ecf8e]/30 bg-[#3ecf8e]/5'
                    : 'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.has(value)}
                  onChange={() => toggleType(value)}
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-emerald-500"
                />
                <div>
                  <p className="text-xs font-medium text-[#f0f2f5]">{label}</p>
                  <p className="text-xs text-[#6b7280]">{description}</p>
                </div>
              </label>
            ))}
          </div>

          {selectedTypes.size === 0 && (
            <p className="mt-2 text-xs text-[#6b7280]">
              ℹ️  Leaving all unchecked subscribes this endpoint to all current
              and future event types.
            </p>
          )}
        </div>

        {submitError && (
          <p className="text-sm text-[#f87171]">{submitError}</p>
        )}

        <button
          type="submit"
          disabled={!url.trim() || isCreating}
          className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                     font-semibold text-white transition-opacity hover:opacity-90
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" />
              Registering...
            </span>
          ) : (
            'Register Endpoint'
          )}
        </button>
      </form>
    </div>
  );
}
