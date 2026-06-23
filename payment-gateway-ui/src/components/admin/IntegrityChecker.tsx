'use client';

import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BalanceMismatch, formatAmount } from '../../types';

interface IntegrityCheckerProps {
  walletIdInput:    string;
  setWalletIdInput: (v: string) => void;
  mismatches:       BalanceMismatch[] | null;
  isCheckRunning:   boolean;
  checkCompleted:   boolean;
  checkError:       string | null;
  onRunCheck:       () => void;
}

export function IntegrityChecker({
  walletIdInput, setWalletIdInput, mismatches,
  isCheckRunning, checkCompleted, checkError, onRunCheck,
}: IntegrityCheckerProps) {
  const isConsistent  = checkCompleted && mismatches !== null && mismatches.length === 0;
  const hasMismatches = checkCompleted && mismatches !== null && mismatches.length > 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-6">
      <h3 className="mb-1 font-semibold text-[#f0f2f5]">Balance Integrity Check</h3>
      <p className="mb-4 text-xs text-[#6b7280]">
        Compares <span className="font-mono">wallets.balance</span> against{' '}
        <span className="font-mono">SUM(credits) - SUM(debits)</span> from the event store. A
        mismatch is a critical finding — do NOT auto-fix; it requires a manual investigation into
        which event or balance update caused the discrepancy.
      </p>

      <div className="mb-3 flex gap-3">
        <input
          type="text"
          placeholder="Wallet ID (UUID) — leave blank to scan all wallets"
          value={walletIdInput}
          onChange={(e) => setWalletIdInput(e.target.value)}
          className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5
                     font-mono text-sm text-[#f0f2f5] placeholder-[#6b7280]/50 outline-none
                     focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
        />
        <button
          onClick={onRunCheck}
          disabled={isCheckRunning}
          className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06]
                     px-4 py-2.5 text-sm text-[#f0f2f5] transition-colors hover:bg-white/[0.10]
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCheckRunning
            ? <Loader2 size={15} className="animate-spin" />
            : <ShieldCheck size={15} />
          }
          {isCheckRunning ? 'Checking...' : 'Run Check'}
        </button>
      </div>

      {!walletIdInput.trim() && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-[#fbbf24]">
          <AlertTriangle size={12} />
          Full scan is slow. Run during off-peak hours.
        </p>
      )}

      {checkError && (
        <div className="rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
          {checkError}
        </div>
      )}

      {isConsistent && (
        <div className="flex items-center gap-3 rounded-xl border border-[#3ecf8e]/20 bg-[#3ecf8e]/5 px-4 py-3">
          <CheckCircle2 size={16} className="flex-shrink-0 text-[#3ecf8e]" />
          <p className="text-sm text-[#3ecf8e]">
            ✓ All wallets are consistent — event-derived balance matches authoritative balance.
          </p>
        </div>
      )}

      {hasMismatches && mismatches && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3">
            <AlertTriangle size={14} className="flex-shrink-0 text-[#f87171]" />
            <p className="text-sm text-[#f87171]">
              {mismatches.length} wallet{mismatches.length !== 1 ? 's' : ''} with discrepancies.
              Manual investigation required.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.04]">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.06]">
                <tr className="text-left text-xs text-[#6b7280]">
                  <th className="px-4 py-3 font-medium">Wallet ID</th>
                  <th className="px-4 py-3 font-medium">Authoritative</th>
                  <th className="px-4 py-3 font-medium">Event-Derived</th>
                  <th className="px-4 py-3 font-medium text-[#f87171]">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {mismatches.map((m) => (
                  <tr key={m.walletId} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-[#6b7280]">
                      {m.walletId.substring(0, 8)}...
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[#f0f2f5]">
                      {formatAmount(m.authoritativeBalance)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[#f0f2f5]">
                      {formatAmount(m.eventDerivedBalance)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-[#f87171]">
                      {formatAmount(m.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
