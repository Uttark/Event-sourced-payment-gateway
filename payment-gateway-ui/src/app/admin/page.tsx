'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, LogOut, Key } from 'lucide-react';

import { useAdminDlq }        from '../../hooks/useAdminDlq';
import { useAdminIntegrity }  from '../../hooks/useAdminIntegrity';
import { SystemHealthBar }    from '../../components/ui/SystemHealthBar';
import { DLQStatsBar }        from '../../components/admin/DLQStatsBar';
import { DLQTable }           from '../../components/admin/DLQTable';
import { RateLimitManager }   from '../../components/admin/RateLimitManager';
import { OrphanScanner }      from '../../components/admin/OrphanScanner';
import { IntegrityChecker }   from '../../components/admin/IntegrityChecker';

type AdminTab = 'dlq' | 'rate-limits' | 'integrity';

export default function AdminPage() {
  const router = useRouter();

  const [keyInput,        setKeyInput]        = useState('');
  const [adminKey,        setAdminKey]        = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError,       setAuthError]       = useState<string | null>(null);
  const [isVerifying,     setIsVerifying]     = useState(false);
  const [activeTab,       setActiveTab]       = useState<AdminTab>('dlq');

  const dlq       = useAdminDlq(adminKey);
  const integrity = useAdminIntegrity(adminKey);

  async function handleKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setIsVerifying(true);
    setAuthError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/admin/dlq/stats`,
        {
          headers: {
            'X-Admin-Key':   keyInput.trim(),
            'Content-Type':  'application/json',
          },
        },
      );
      if (res.status === 401 || res.status === 403) {
        setAuthError('Invalid admin key. Check the ADMIN_API_KEY in your backend .env file.');
        return;
      }
      if (!res.ok && res.status !== 200) {
        setAuthError('Backend returned an unexpected error. Ensure all containers are running.');
        return;
      }

      setAdminKey(keyInput.trim());
      setIsAuthenticated(true);
    } catch {
      setAuthError('Unable to reach the backend. Run `docker compose ps` to check container health.');
    } finally {
      setIsVerifying(false);
    }
  }

  function handleSignOut() {
    setAdminKey('');
    setKeyInput('');
    setIsAuthenticated(false);
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#08090a] px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fbbf24]/10">
              <Shield size={20} className="text-[#fbbf24]" />
            </div>
            <div>
              <h1 className="font-semibold text-[#f0f2f5]">Admin Console</h1>
              <p className="text-xs text-[#6b7280]">Payment Engine Operations</p>
            </div>
          </div>

          <div className="rounded-2xl border border-t-white/[0.12] border-white/[0.06] bg-white/[0.04] p-8">
            <p className="mb-6 text-sm text-[#6b7280]">
              Enter the admin key set via{' '}
              <span className="font-mono text-[#f0f2f5]">ADMIN_API_KEY</span> in your backend{' '}
              <span className="font-mono text-[#f0f2f5]">.env</span> file.
            </p>

            <form onSubmit={handleKeySubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-[#6b7280]">Admin Key</label>
                <div className="relative">
                  <Key
                    size={14}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6b7280]"
                  />
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => { setKeyInput(e.target.value); setAuthError(null); }}
                    placeholder="Enter admin key..."
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-3
                               pl-10 pr-4 text-[#f0f2f5] outline-none placeholder-[#6b7280]/60
                               focus:border-[#fbbf24]/40 focus:ring-1 focus:ring-[#fbbf24]/20"
                  />
                </div>
              </div>

              {authError && (
                <p className="text-sm text-[#f87171]">{authError}</p>
              )}

              <button
                type="submit"
                disabled={!keyInput.trim() || isVerifying}
                className="w-full rounded-xl bg-[#fbbf24]/10 py-3 text-sm font-semibold
                           text-[#fbbf24] transition-colors hover:bg-[#fbbf24]/20
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isVerifying ? 'Verifying...' : 'Access Console'}
              </button>
            </form>
          </div>

          <div className="mt-4 flex justify-center gap-4 text-xs text-[#6b7280]">
            <button onClick={() => router.push('/')} className="hover:text-[#f0f2f5]">
              ← Dashboard
            </button>
            <span className="text-[#6b7280]/40">·</span>
            <button onClick={() => router.push('/merchant')} className="hover:text-[#f0f2f5]">
              Merchant Portal
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090a] px-4 py-8">
      <div className="mx-auto max-w-4xl">

        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fbbf24]/10">
              <Shield size={15} className="text-[#fbbf24]" />
            </div>
            <div>
              <h1 className="font-semibold text-[#f0f2f5]">Admin Console</h1>
              <p className="text-xs text-[#6b7280]">Payment Engine Operations</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
            >
              ← Dashboard
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-3
                         py-1.5 text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
            >
              <LogOut size={13} />
              Sign Out
            </button>
          </div>
        </header>

        <SystemHealthBar />

        <div className="mb-6 flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {(
            [
              { id: 'dlq',         label: 'Dead Letter Queue' },
              { id: 'rate-limits', label: 'Rate Limits'       },
              { id: 'integrity',   label: 'System Integrity'  },
            ] as { id: AdminTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white/[0.08] text-[#f0f2f5]'
                  : 'text-[#6b7280] hover:text-[#f0f2f5]'
              }`}
            >
              {tab.label}
              {tab.id === 'dlq' && dlq.stats && dlq.stats.unresolved > 0 && (
                <span className="ml-2 rounded-full bg-[#f87171]/20 px-1.5 py-0.5 text-xs text-[#f87171]">
                  {dlq.stats.unresolved}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'dlq' && (
          <div>
            <DLQStatsBar stats={dlq.stats} isLoading={dlq.isLoadingStats} />
            <DLQTable
              items={dlq.items}
              isLoading={dlq.isLoadingItems}
              page={dlq.page}
              totalPages={dlq.totalPages}
              unresolvedOnly={dlq.unresolvedOnly}
              error={dlq.error}
              onUnresolvedOnlyChange={dlq.setUnresolvedOnly}
              onNextPage={dlq.goToNextPage}
              onPrevPage={dlq.goToPrevPage}
              onReplay={dlq.replayItem}
              onResolve={dlq.resolveItem}
              onRefetch={dlq.refetch}
            />
          </div>
        )}

        {activeTab === 'rate-limits' && (
          <RateLimitManager adminKey={adminKey} />
        )}

        {activeTab === 'integrity' && (
          <div className="space-y-5">
            <OrphanScanner
              orphans={integrity.orphans}
              isScanning={integrity.isScanning}
              scanCompleted={integrity.scanCompleted}
              orphanError={integrity.orphanError}
              rebuildingIds={integrity.rebuildingIds}
              onScan={integrity.scanOrphans}
              onRebuild={integrity.rebuildProjection}
            />
            <IntegrityChecker
              walletIdInput={integrity.walletIdInput}
              setWalletIdInput={integrity.setWalletIdInput}
              mismatches={integrity.mismatches}
              isCheckRunning={integrity.isCheckRunning}
              checkCompleted={integrity.checkCompleted}
              checkError={integrity.checkError}
              onRunCheck={integrity.runIntegrityCheck}
            />
          </div>
        )}
      </div>
    </div>
  );
}
