'use client';

import { useState, useEffect } from 'react';
import { Search, Loader2, ShieldOff, RotateCcw } from 'lucide-react';
import { useAdminRateLimits } from '../../hooks/useAdminRateLimits';

interface RateLimitManagerProps {
  adminKey: string;
}

const WINDOW_OPTIONS = [
  { label: '1 minute',  value: 60_000    },
  { label: '5 minutes', value: 300_000   },
  { label: '1 hour',    value: 3_600_000 },
];

export function RateLimitManager({ adminKey }: RateLimitManagerProps) {
  const rl = useAdminRateLimits(adminKey);

  const [maxRequestsInput, setMaxRequestsInput] = useState('100');
  const [windowMsInput,    setWindowMsInput]    = useState('60000');

  useEffect(() => {
    if (rl.currentLimit) {
      setMaxRequestsInput(String(rl.currentLimit.effective.maxRequests));

      const matched = WINDOW_OPTIONS.find(
        (opt) => opt.value === rl.currentLimit!.effective.windowMs,
      );
      setWindowMsInput(String(matched ? matched.value : 60_000));
    }
  }, [rl.currentLimit]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    rl.clearMessages();
    await rl.lookupLimit(rl.merchantId);
  }

  async function handleSetLimit(e: React.FormEvent) {
    e.preventDefault();
    const maxReq = parseInt(maxRequestsInput, 10);
    const winMs  = parseInt(windowMsInput, 10);
    if (isNaN(maxReq) || isNaN(winMs) || !rl.merchantId) return;
    await rl.setLimit(rl.merchantId, maxReq, winMs);
  }

  const isBlocked = rl.currentLimit?.effective.maxRequests === 0;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-6">
        <h3 className="mb-1 font-semibold text-[#f0f2f5]">Look Up Merchant</h3>
        <p className="mb-4 text-xs text-[#6b7280]">
          Enter the user's UUID (the same ID that appears in their JWT).
          This is the key used to look up their custom rate limit in Redis.
        </p>
        <form onSubmit={handleLookup} className="flex gap-3">
          <input
            type="text"
            placeholder="User ID (UUID)"
            value={rl.merchantId}
            onChange={(e) => { rl.setMerchantId(e.target.value); rl.clearMessages(); }}
            className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3
                       font-mono text-sm text-[#f0f2f5] placeholder-[#6b7280]/60 outline-none
                       focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
          />
          <button
            type="submit"
            disabled={!rl.merchantId.trim() || rl.isLooking}
            className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06]
                       px-4 py-3 text-sm text-[#f0f2f5] transition-colors hover:bg-white/[0.10]
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rl.isLooking
              ? <Loader2 size={15} className="animate-spin" />
              : <Search size={15} />
            }
            {rl.isLooking ? 'Looking up...' : 'Look Up'}
          </button>
        </form>
      </div>

      {rl.error && (
        <div className="rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
          {rl.error}
        </div>
      )}
      {rl.successMsg && (
        <div className="rounded-xl border border-[#3ecf8e]/20 bg-[#3ecf8e]/5 px-4 py-3 text-sm text-[#3ecf8e]">
          {rl.successMsg}
        </div>
      )}

      {rl.currentLimit && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-[#f0f2f5]">Current Limit</h3>
              <p className="mt-0.5 font-mono text-sm text-[#6b7280]">{rl.currentLimit.status}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isBlocked
                  ? 'bg-red-500/15 text-red-400'
                  : rl.currentLimit.isCustom
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-white/[0.06] text-[#6b7280]'
              }`}
            >
              {isBlocked ? 'BLOCKED' : rl.currentLimit.isCustom ? 'Custom' : 'Default'}
            </span>
          </div>

          <form onSubmit={handleSetLimit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-[#6b7280]">
                  Max Requests (0 = block all)
                </label>
                <input
                  type="number"
                  min="0"
                  value={maxRequestsInput}
                  onChange={(e) => setMaxRequestsInput(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5
                             font-mono text-sm text-[#f0f2f5] outline-none
                             focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-[#6b7280]">Window</label>
                <select
                  value={windowMsInput}
                  onChange={(e) => setWindowMsInput(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.06] bg-[#16181c] px-3 py-2.5
                             text-sm text-[#f0f2f5] outline-none focus:border-[#3ecf8e]/40"
                >
                  {WINDOW_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={rl.isSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl
                           bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5
                           text-sm font-semibold text-white transition-opacity
                           hover:opacity-90 disabled:opacity-50"
              >
                {rl.isSaving && <Loader2 size={14} className="animate-spin" />}
                {rl.isSaving ? 'Saving...' : 'Set Limit'}
              </button>

              <button
                type="button"
                onClick={() => rl.setLimit(rl.merchantId, 0, 60_000)}
                disabled={rl.isSaving || isBlocked}
                title="Set maxRequests to 0 — completely blocks API access"
                className="flex items-center gap-1.5 rounded-xl border border-[#f87171]/30
                           bg-[#f87171]/5 px-4 py-2.5 text-sm text-[#f87171]
                           hover:bg-[#f87171]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldOff size={14} />
                Block
              </button>

              <button
                type="button"
                onClick={() => rl.resetLimit(rl.merchantId)}
                disabled={rl.isResetting || !rl.currentLimit.isCustom}
                title="Remove custom limit — restores to system default"
                className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-4
                           py-2.5 text-sm text-[#6b7280] hover:text-[#f0f2f5]
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rl.isResetting
                  ? <Loader2 size={14} className="animate-spin" />
                  : <RotateCcw size={14} />
                }
                {rl.isResetting ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </form>

          <p className="mt-3 text-xs text-[#6b7280]">
            "Reset" removes any custom limit and restores the system default of 100 requests per
            minute. "Block" sets requests to 0 which returns HTTP 403 on every API call.
          </p>
        </div>
      )}
    </div>
  );
}
