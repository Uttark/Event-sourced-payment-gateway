'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter }          from 'next/navigation';
import { LogOut }             from 'lucide-react';

import { useAuth }               from '../../context/AuthContext';
import { useWallet }             from '../../hooks/useWallet';
import { useTransactions }       from '../../hooks/useTransactions';
import { useTransactionDetail }  from '../../hooks/useTransactionDetail';
import { BalanceCard }           from '../../components/ui/BalanceCard';
import { TopUpModal }            from '../../components/ui/TopUpModal';
import { SendMoneyModal }        from '../../components/ui/SendMoneyModal';
import { TransactionRow }        from '../../components/ui/TransactionRow';
import { TransactionDetailPanel } from '../../components/ui/TransactionDetailPanel';
import { SystemHealthBar }       from '../../components/ui/SystemHealthBar';
import { TransactionListSkeleton } from '../../components/ui/SkeletonLoader';
import { Toast }                 from '../../components/ui/Toast';
import { ErrorBoundary }         from '../../components/ErrorBoundary';
import { TransactionFilters }    from '../../components/ui/TransactionFilters';
import { apiFetch }              from '../../lib/api';
import { loadRazorpayScript, openCheckout } from '../../lib/razorpay';
import {
  TopupStatus,
  TopupInitiateResponse,
  SendMoneyStatus,
  SendMoneyErrorInfo,
  TransferApiResponse,
  ApiError,
  classifySendMoneyError,
} from '../../types';

interface ToastState {
  message: string;
  type:    'success' | 'error' | 'info';
  retryAfter?: number;
}

export default function DashboardPage() {
  const router                    = useRouter();
  const { authState, logout }     = useAuth();
  const wallet                    = useWallet();
  const txList                    = useTransactions();
  const txDetail                  = useTransactionDetail();

  const [mounted,       setMounted]       = useState(false);
  const [topupStatus,   setTopupStatus]   = useState<TopupStatus>('idle');
  const [isTopUpOpen,   setIsTopUpOpen]   = useState(false);
  const [sendStatus,    setSendStatus]    = useState<SendMoneyStatus>('idle');
  const [sendErrorInfo, setSendErrorInfo] = useState<SendMoneyErrorInfo | null>(null);
  const [isSendOpen,    setIsSendOpen]    = useState(false);

  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);

  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !authState.token) router.replace('/');
  }, [mounted, authState.token, router]);

  const handleTransactionClick = useCallback((transactionId: string) => {
    setSelectedTransactionId(transactionId);
    txDetail.loadDetail(transactionId);
  }, [txDetail]);

  const handleCloseDetail = useCallback(() => {
    setSelectedTransactionId(null);
    txDetail.clearDetail();
  }, [txDetail]);

  useEffect(() => {
    if (topupStatus !== 'success') return;
    const timer = setTimeout(() => { setIsTopUpOpen(false); setTopupStatus('idle'); }, 2000);
    return () => clearTimeout(timer);
  }, [topupStatus]);

  useEffect(() => {
    if (sendStatus !== 'success') return;
    const timer = setTimeout(() => { setIsSendOpen(false); setSendStatus('idle'); setSendErrorInfo(null); }, 2000);
    return () => clearTimeout(timer);
  }, [sendStatus]);

  function showToast(message: string, type: ToastState['type'], retryAfter?: number) {
    setToast({ message, type, retryAfter });
  }

  const handleCreateWallet = useCallback(async (currency: string) => {
    try {
      await wallet.createWallet(currency);
      showToast(`${currency} wallet created.`, 'success');
    } catch (err) {
      const e = err as ApiError;
      showToast(e.message ?? 'Failed to create wallet.', 'error', e.retryAfter);
    }
  }, [wallet]);

  const handleInitiateTopUp = useCallback(async (amount: number) => {
    const activeWallet = wallet.selectedWallet;
    if (!activeWallet) return;
    const balanceBeforeTopup = activeWallet.balance;
    const walletId = activeWallet.id;

    try {
      setTopupStatus('initiating');
      const res = await apiFetch<TopupInitiateResponse>(
        '/api/transactions/topup/initiate',
        { method: 'POST', body: { walletId, amount } },
      );
      setTopupStatus('awaiting_payment');
      await loadRazorpayScript();
      openCheckout({
        key:         process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '',
        amount:      Math.round(amount * 100),
        currency:    activeWallet.currency || 'INR',
        name:        'Payment Engine',
        description: 'Wallet Top-Up',
        order_id:    res.data.orderId,
        handler:     (razorpayResponse) => {
          handleVerifyTopUp(razorpayResponse, walletId, balanceBeforeTopup);
        },
        modal: { ondismiss: () => setTopupStatus('idle') },
        prefill: { name: authState.user?.name, email: authState.user?.email },
        theme: { color: '#3ecf8e' },
      });
    } catch (err) {
      setTopupStatus('error');
      const e = err as ApiError;
      showToast(e.message ?? 'Failed to initiate top-up.', 'error', e.retryAfter);
    }
  }, [wallet.selectedWallet, authState.user]);

  const handleVerifyTopUp = useCallback(async (
    razorpayResponse: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
    walletId: string,
    balanceBeforeTopup: string,
  ) => {
    try {
      setTopupStatus('verifying');
      await apiFetch('/api/transactions/topup/verify', {
        method: 'POST',
        body: {
          walletId,
          razorpay_order_id:   razorpayResponse.razorpay_order_id,
          razorpay_payment_id: razorpayResponse.razorpay_payment_id,
          razorpay_signature:  razorpayResponse.razorpay_signature,
        },
      });
      setTopupStatus('polling');
      const didUpdate = await wallet.pollUntilUpdated(walletId, balanceBeforeTopup);
      setTopupStatus('success');
      showToast(
        didUpdate
          ? 'Wallet topped up successfully!'
          : 'Payment received. Your balance will reflect shortly.',
        didUpdate ? 'success' : 'info',
      );
      await txList.refetch();
    } catch (err) {
      setTopupStatus('error');
      const e = err as ApiError;
      showToast(e.message ?? 'Payment verification failed.', 'error', e.retryAfter);
    }
  }, [wallet.pollUntilUpdated, txList]);

  const handleSendMoney = useCallback(async (recipientWalletId: string, amount: number) => {
    const activeWallet = wallet.selectedWallet;
    if (!activeWallet) return;
    setSendStatus('submitting');
    setSendErrorInfo(null);
    try {
      await apiFetch<TransferApiResponse>('/api/wallets/transfer', {
        method: 'POST',
        body: {
          senderWalletId:    activeWallet.id,
          recipientWalletId: recipientWalletId,
          amount,
          description: `Transfer to wallet ${recipientWalletId.substring(0, 8)}...`,
        },
      });
      setSendStatus('success');
      showToast('Transfer completed successfully!', 'success');
      await wallet.refetch();
      await txList.refetch();
    } catch (err) {
      const e = err as ApiError;
      setSendErrorInfo(classifySendMoneyError(e));
      setSendStatus('error');
      if (e.statusCode === 429) {
        showToast(e.message, 'error', e.retryAfter);
      }
    }
  }, [wallet, txList]);

  if (!mounted || !authState.user) return null;

  const actionsDisabled =
    topupStatus !== 'idle' || sendStatus !== 'idle' || !wallet.selectedWallet;

  return (
    <div className="min-h-screen bg-[#08090a] px-4 py-8">
      <div className="mx-auto max-w-2xl">

        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-[#6b7280]">Signed in as</p>
            <h2 className="font-semibold text-[#f0f2f5]">{authState.user.name}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/merchant')}
              className="text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
            >
              Merchant ↗
            </button>
            <button
              onClick={() => router.push('/admin')}
              className="text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
            >
              Admin ↗
            </button>
            <button
              onClick={() => logout()}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] px-4 py-2
                         text-sm text-[#6b7280] transition-colors hover:border-white/[0.12] hover:text-[#f0f2f5]"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        <SystemHealthBar />

        <div className="mb-6">
          <ErrorBoundary sectionName="Balance Card">
            <BalanceCard
              wallets={wallet.wallets}
              selectedWallet={wallet.selectedWallet}
              isLoading={wallet.isLoading}
              isPolling={wallet.isPolling}
              isCreatingWallet={wallet.isCreatingWallet}
              onSelectWallet={wallet.selectWallet}
              onCreateWallet={handleCreateWallet}
              onTopUpClick={() => setIsTopUpOpen(true)}
              onSendClick={() => setIsSendOpen(true)}
              actionsDisabled={actionsDisabled}
            />
          </ErrorBoundary>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-[#f0f2f5]">Transaction History</h3>
            {!txList.isLoading && (
              <span className="text-xs text-[#6b7280]">
                Page {txList.page} of {txList.totalPages}
              </span>
            )}
          </div>

          <div className="mb-4">
            <TransactionFilters
              activeFilter={txList.activeFilter}
              onFilterChange={txList.setActiveFilter}
              counts={txList.filterCounts}
              isLoading={txList.isLoading}
            />
          </div>

          <ErrorBoundary sectionName="Transaction History">
            {txList.isLoading ? (
              <TransactionListSkeleton />
            ) : txList.error ? (
              <p className="text-center text-sm text-[#f87171]">{txList.error}</p>
            ) : txList.filteredTransactions.length === 0 ? (
              <p className="py-12 text-center text-sm text-[#6b7280]">
                No transactions match this filter.
              </p>
            ) : (
              <div className="space-y-2">
                {txList.filteredTransactions.map((tx) => (
                  <TransactionRow
                    key={tx.id + tx.createdAt}
                    transaction={tx}
                    onClick={() => handleTransactionClick(tx.id)}
                  />
                ))}
              </div>
            )}
          </ErrorBoundary>

          {!txList.isLoading && txList.totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-3">
              <button
                onClick={txList.goToPrevPage}
                disabled={txList.page === 1}
                className="rounded-lg border border-white/[0.06] px-4 py-2 text-sm text-[#6b7280]
                           disabled:opacity-40 hover:border-white/[0.12] hover:text-[#f0f2f5]"
              >
                Previous
              </button>
              <button
                onClick={txList.goToNextPage}
                disabled={txList.page === txList.totalPages}
                className="rounded-lg border border-white/[0.06] px-4 py-2 text-sm text-[#6b7280]
                           disabled:opacity-40 hover:border-white/[0.12] hover:text-[#f0f2f5]"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>

      <TopUpModal
        isOpen={isTopUpOpen}
        status={topupStatus}
        currency={wallet.selectedWallet?.currency ?? 'USD'}
        onAmountSubmit={handleInitiateTopUp}
        onClose={() => { setIsTopUpOpen(false); setTopupStatus('idle'); }}
      />
      <SendMoneyModal
        isOpen={isSendOpen}
        status={sendStatus}
        errorInfo={sendErrorInfo}
        selectedWallet={wallet.selectedWallet}
        onSubmit={handleSendMoney}
        onClose={() => { setIsSendOpen(false); setSendStatus('idle'); setSendErrorInfo(null); }}
      />

      <TransactionDetailPanel
        isOpen={selectedTransactionId !== null}
        detail={txDetail.detail}
        isLoading={txDetail.isLoading}
        error={txDetail.error}
        onClose={handleCloseDetail}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          retryAfter={toast.retryAfter}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}