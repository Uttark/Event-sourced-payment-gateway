'use client';

import { useState } from 'react';
import { Store, Loader2 } from 'lucide-react';
import { ApiError } from '../../types';

interface MerchantOnboardingProps {
  isRegistering: boolean;
  onRegister:    (businessName: string) => Promise<void>;
}

export function MerchantOnboarding({ isRegistering, onRegister }: MerchantOnboardingProps) {
  const [businessName, setBusinessName] = useState('');
  const [error,        setError]        = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) return;
    setError(null);
    try {
      await onRegister(businessName.trim());
    } catch (err) {
      setError((err as ApiError).message ?? 'Registration failed. Please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-8">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3ecf8e]/10">
          <Store size={28} className="text-[#3ecf8e]" />
        </div>

        <h2 className="mb-2 text-center text-xl font-semibold text-[#f0f2f5]">
          Become a Merchant
        </h2>
        <p className="mb-6 text-center text-sm text-[#6b7280]">
          Register your business to receive real-time signed webhook notifications
          for payments, transfers, fraud events, and payouts.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#6b7280]">
              Business Name
            </label>
            <input
              type="text"
              placeholder="e.g. Tata Enterprises"
              value={businessName}
              maxLength={100}
              onChange={(e) => { setBusinessName(e.target.value); setError(null); }}
              required
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3
                         text-[#f0f2f5] placeholder-[#6b7280]/60 outline-none transition-colors
                         focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
            />
          </div>

          {error && <p className="text-sm text-[#f87171]">{error}</p>}

          <button
            type="submit"
            disabled={!businessName.trim() || isRegistering}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                       font-semibold text-white transition-opacity hover:opacity-90
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRegistering ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Registering...
              </span>
            ) : (
              'Register as Merchant'
            )}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#6b7280]">
          What you get
        </p>
        <ul className="space-y-2 text-sm text-[#6b7280]">
          {[
            'Real-time webhook delivery for every payment event',
            'HMAC-SHA256 signed payloads — tamper-proof verification',
            'Automatic retry with exponential backoff (5 attempts)',
            'Dead Letter Queue for permanently failed deliveries',
            'Per-endpoint event type filtering',
          ].map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-[#3ecf8e]">✓</span>
              {benefit}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
