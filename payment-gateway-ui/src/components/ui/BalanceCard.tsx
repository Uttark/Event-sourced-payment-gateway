'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, ArrowUpRight, Check } from 'lucide-react';
import {
  Wallet,
  SUPPORTED_CURRENCIES,
  formatAmount,
  getCurrencySymbol,
} from '../../types';

interface BalanceCardProps {
  wallets: Wallet[];
  selectedWallet: Wallet | null;
  isLoading: boolean;
  isPolling: boolean;
  isCreatingWallet: boolean;
  onSelectWallet: (walletId: string) => void;
  onCreateWallet: (currency: string) => void;
  onTopUpClick: () => void;
  onSendClick: () => void;

  actionsDisabled: boolean;
}

export function BalanceCard({
  wallets,
  selectedWallet,
  isLoading,
  isPolling,
  isCreatingWallet,
  onSelectWallet,
  onCreateWallet,
  onTopUpClick,
  onSendClick,
  actionsDisabled,
}: BalanceCardProps) {
  const [isCopied, setIsCopied] = useState(false);

  if (isLoading) return <BalanceCardSkeleton />;

  const displayAmount = selectedWallet ? formatAmount(selectedWallet.balance) : '0.00';
  const currencySymbol = selectedWallet ? getCurrencySymbol(selectedWallet.currency) : '';

  const handleCopyId = () => {
    if (!selectedWallet) return;
    navigator.clipboard.writeText(selectedWallet.id);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-t-white/[0.12] border-white/[0.06] bg-white/[0.04] p-8 backdrop-blur-2xl">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #3ecf8e, transparent 70%)' }}
      />

      <div className="relative">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                onClick={() => onSelectWallet(wallet.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium font-mono transition-colors ${wallet.id === selectedWallet?.id
                    ? 'bg-white/[0.10] text-[#f0f2f5]'
                    : 'bg-white/[0.02] text-[#6b7280] hover:bg-white/[0.06] hover:text-[#f0f2f5]'
                  }`}
              >
                {wallet.currency}
              </button>
            ))}
          </div>

          <CreateWalletButton
            existingCurrencies={wallets.map((w) => w.currency)}
            isCreating={isCreatingWallet}
            onCreate={onCreateWallet}
          />
        </div>

        {wallets.length === 0 ? (
          <EmptyWalletState />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#6b7280]">Ledger Balance</span>
                <span className={`h-2 w-2 rounded-full bg-[#3ecf8e] ${isPolling ? 'animate-pulse' : ''}`} />
                {isPolling && <span className="text-xs italic text-[#6b7280]">settling...</span>}
              </div>

              <div
                className="group flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 transition-colors hover:bg-white/[0.06]"
                onClick={handleCopyId}
                title="Click to copy Wallet ID"
              >
                <span className="text-[10px] uppercase tracking-wider text-[#6b7280]">ID</span>
                <span className="font-mono text-xs text-[#f0f2f5]">{selectedWallet?.id.substring(0, 8)}...</span>
                <div className="ml-1 flex items-center justify-center text-[10px] text-[#3ecf8e] opacity-0 transition-opacity group-hover:opacity-100">
                  {isCopied ? <Check size={12} className="mr-0.5" /> : null}
                  {isCopied ? 'Copied' : 'Copy'}
                </div>
              </div>
            </div>

            <div className="mb-8 flex items-baseline gap-2">
              <span className="text-2xl text-[#6b7280]">{currencySymbol}</span>
              <span className="font-mono text-5xl font-semibold tracking-tight text-[#f0f2f5]">
                {displayAmount}
              </span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onTopUpClick}
                disabled={actionsDisabled}
                className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3.5
                           font-semibold text-white transition-opacity
                           hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Top Up Wallet
              </button>
              <button
                onClick={onSendClick}
                disabled={actionsDisabled}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.10]
                           bg-white/[0.04] px-6 py-3.5 font-semibold text-[#f0f2f5] transition-colors
                           hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUpRight size={18} />
                Send Money
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CreateWalletButton({
  existingCurrencies,
  isCreating,
  onCreate,
}: {
  existingCurrencies: string[];
  isCreating: boolean;
  onCreate: (currency: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const availableCurrencies = SUPPORTED_CURRENCIES.filter(
    (c) => !existingCurrencies.includes(c),
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (availableCurrencies.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        disabled={isCreating}
        title="Create a new wallet"
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.02]
                   text-[#6b7280] transition-colors hover:bg-white/[0.06] hover:text-[#f0f2f5]
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={14} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-9 z-20 w-36 overflow-hidden rounded-xl border border-white/[0.06] bg-[#16181c] shadow-2xl">
          <p className="border-b border-white/[0.06] px-3 py-2 text-xs text-[#6b7280]">
            New wallet
          </p>
          {availableCurrencies.map((currency) => (
            <button
              key={currency}
              onClick={() => {
                onCreate(currency);
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm
                         font-mono text-[#f0f2f5] transition-colors hover:bg-white/[0.06]"
            >
              {currency}
              <span className="text-xs text-[#6b7280]">{getCurrencySymbol(currency)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyWalletState() {
  return (
    <div className="py-10 text-center">
      <p className="mb-1 text-sm text-[#f0f2f5]">No wallets yet</p>
      <p className="text-xs text-[#6b7280]">
        Use the <span className="font-mono">+</span> button above to create your first wallet.
      </p>
    </div>
  );
}

function BalanceCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-8">
      <div className="mb-6 flex gap-1.5">
        <div className="h-7 w-12 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="h-7 w-12 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
      <div className="mb-6 h-4 w-32 animate-pulse rounded-md bg-white/[0.05]" />
      <div className="mb-8 h-14 w-52 animate-pulse rounded-md bg-white/[0.05]" />
      <div className="flex gap-3">
        <div className="h-12 flex-1 animate-pulse rounded-xl bg-white/[0.05]" />
        <div className="h-12 flex-1 animate-pulse rounded-xl bg-white/[0.05]" />
      </div>
    </div>
  );
}