'use client';

import { ScanLine, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { OrphanedTransaction, formatAmount, getCurrencySymbol } from '../../types';

interface OrphanScannerProps {
  orphans:       OrphanedTransaction[];
  isScanning:    boolean;
  scanCompleted: boolean;
  orphanError:   string | null;
  rebuildingIds: Set<string>;
  onScan:        () => void;
  onRebuild:     (walletId: string) => void;
}

export function OrphanScanner({
  orphans, isScanning, scanCompleted, orphanError, rebuildingIds, onScan, onRebuild,
}: OrphanScannerProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-[#f0f2f5]">Orphaned Transactions</h3>
          <p className="mt-1 text-xs text-[#6b7280]">
            Finds transactions stuck at <span className="font-mono">GATEWAY_CHARGE_SUCCEEDED</span>{' '}
            with no downstream <span className="font-mono">PAYMENT_COMPLETED</span>. This indicates
            the ledger consumer failed or is behind. The compensation worker heals these
            automatically every 15 minutes.
          </p>
        </div>
        <button
          onClick={onScan}
          disabled={isScanning}
          className="flex flex-shrink-0 items-center gap-2 rounded-xl border border-white/[0.08]
                     bg-white/[0.04] px-4 py-2.5 text-sm text-[#f0f2f5] transition-colors
                     hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isScanning
            ? <Loader2 size={15} className="animate-spin" />
            : <ScanLine size={15} />
          }
          {isScanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {orphanError && (
        <div className="mb-4 rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
          {orphanError}
        </div>
      )}

      {!scanCompleted && !isScanning && (
        <div className="py-8 text-center text-sm text-[#6b7280]">
          Click "Scan Now" to query the event store for stuck transactions.
        </div>
      )}

      {scanCompleted && orphans.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-[#3ecf8e]/20 bg-[#3ecf8e]/5 px-4 py-3">
          <CheckCircle2 size={16} className="flex-shrink-0 text-[#3ecf8e]" />
          <p className="text-sm text-[#3ecf8e]">
            All transactions are healthy — no orphaned events found.
          </p>
        </div>
      )}

      {scanCompleted && orphans.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#fbbf24]/20 bg-[#fbbf24]/5 px-4 py-3">
            <AlertTriangle size={14} className="flex-shrink-0 text-[#fbbf24]" />
            <p className="text-sm text-[#fbbf24]">
              Found {orphans.length} orphaned transaction{orphans.length !== 1 ? 's' : ''}.
              Use "Rebuild" to manually repair the wallet projection for each.
            </p>
          </div>

          {orphans.map((orphan) => {
            const symbol = getCurrencySymbol(orphan.currency);
            return (
              <div
                key={orphan.transactionId}
                className="flex items-center gap-4 rounded-xl border border-white/[0.04] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-[#6b7280]">
                    txn_{orphan.transactionId.substring(0, 8)}...
                  </p>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="font-mono text-sm font-medium text-[#f0f2f5]">
                      {symbol}{formatAmount(orphan.amount)}
                    </span>
                    <span className="font-mono text-xs text-[#6b7280]">{orphan.currency}</span>
                  </div>
                </div>
                <button
                  onClick={() => onRebuild(orphan.walletId)}
                  disabled={rebuildingIds.has(orphan.walletId)}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06]
                             px-3 py-1.5 text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]
                             disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rebuildingIds.has(orphan.walletId)
                    ? <Loader2 size={12} className="animate-spin" />
                    : <RefreshCw size={12} />
                  }
                  {rebuildingIds.has(orphan.walletId) ? 'Rebuilding...' : 'Rebuild Projection'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
