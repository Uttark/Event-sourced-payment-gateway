'use client';

import { useState } from 'react';
import {
    Loader2,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    RefreshCw,
    X,
} from 'lucide-react';
import {
    SendMoneyStatus,
    SendMoneyErrorInfo,
    Wallet,
    getCurrencySymbol,
} from '../../types';

interface SendMoneyModalProps {
    isOpen: boolean;
    status: SendMoneyStatus;
    errorInfo: SendMoneyErrorInfo | null;
    selectedWallet: Wallet | null;
    onSubmit: (recipientWalletId: string, amount: number) => void;
    onClose: () => void;
}

export function SendMoneyModal({
    isOpen,
    status,
    errorInfo,
    selectedWallet,
    onSubmit,
    onClose,
}: SendMoneyModalProps) {
    const [recipientWalletId, setRecipientWalletId] = useState('');
    const [amountInput, setAmountInput] = useState('');

    if (!isOpen || !selectedWallet) return null;

    const amount = parseFloat(amountInput);
    const isAmountValid = !isNaN(amount) && amount > 0;
    const isRecipientValid = recipientWalletId.trim().length > 0;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (isAmountValid && isRecipientValid) {
            onSubmit(recipientWalletId.trim(), amount);
        }
    }

    function handleRetry() {
        if (isAmountValid && isRecipientValid) {
            onSubmit(recipientWalletId.trim(), amount);
        }
    }

    function handleClose() {
        setRecipientWalletId('');
        setAmountInput('');
        onClose();
    }

    const showCloseButton = status === 'idle' || status === 'error' || status === 'success';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-md rounded-2xl border border-t-white/[0.12] border-white/[0.06] bg-[#0f1012] p-8">
                {showCloseButton && (
                    <button
                        onClick={handleClose}
                        className="absolute right-4 top-4 rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-white/[0.06] hover:text-[#f0f2f5]"
                    >
                        <X size={18} />
                    </button>
                )}

                {status === 'idle' && (
                    <IdleForm
                        selectedWallet={selectedWallet}
                        recipientWalletId={recipientWalletId}
                        amountInput={amountInput}
                        onRecipientChange={setRecipientWalletId}
                        onAmountChange={setAmountInput}
                        onSubmit={handleSubmit}
                        canSubmit={isAmountValid && isRecipientValid}
                    />
                )}

                {status === 'submitting' && (
                    <StatusView
                        icon={<Loader2 className="animate-spin text-[#3ecf8e]" size={40} />}
                        title="Processing payment..."
                        subtitle="Running fraud checks and contacting the payment gateway."
                    />
                )}

                {status === 'success' && (
                    <StatusView
                        icon={<CheckCircle2 className="text-[#3ecf8e]" size={40} />}
                        title="Payment sent!"
                        subtitle="Your wallet balance has been updated."
                    />
                )}

                {status === 'error' && errorInfo && (
                    <ErrorView errorInfo={errorInfo} onRetry={handleRetry} onClose={handleClose} />
                )}
            </div>
        </div>
    );
}

interface IdleFormProps {
    selectedWallet: Wallet;
    recipientWalletId: string;
    amountInput: string;
    onRecipientChange: (v: string) => void;
    onAmountChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    canSubmit: boolean;
}

function IdleForm({
    selectedWallet,
    recipientWalletId,
    amountInput,
    onRecipientChange,
    onAmountChange,
    onSubmit,
    canSubmit,
}: IdleFormProps) {
    const symbol = getCurrencySymbol(selectedWallet.currency);

    return (
        <div>
            <h2 className="mb-2 text-xl font-semibold text-[#f0f2f5]">Send Money</h2>
            <p className="mb-6 text-sm text-[#6b7280]">
                Send funds from your{' '}
                <span className="font-mono text-[#f0f2f5]">{selectedWallet.currency}</span> wallet.
                The recipient must also hold a{' '}
                <span className="font-mono text-[#f0f2f5]">{selectedWallet.currency}</span> wallet.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
                <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#6b7280]">
                        Recipient Wallet ID
                    </label>
                    <input
                        type="text"
                        placeholder="e.g. b4f2a3c1-9d8e-4f7b-a2c1-3d4e5f6a7b8c"
                        value={recipientWalletId}
                        onChange={(e) => onRecipientChange(e.target.value)}
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3
                       font-mono text-sm text-[#f0f2f5] placeholder-[#6b7280]/50 outline-none
                       transition-colors focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
                    />
                </div>

                <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#6b7280]">Amount</label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[#6b7280]">
                                {symbol}
                            </span>
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="0.00"
                                value={amountInput}
                                onChange={(e) => onAmountChange(e.target.value)}
                                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-3.5
                           pl-10 pr-4 font-mono text-[#f0f2f5] placeholder-[#6b7280] outline-none
                           transition-colors focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
                            />
                        </div>
                        <div className="flex w-20 items-center justify-center rounded-xl border border-white/[0.06]
                            bg-white/[0.02] font-mono text-sm text-[#6b7280]">
                            {selectedWallet.currency}
                        </div>
                    </div>
                    <p className="mt-1.5 text-xs text-[#6b7280]">
                        Available: {symbol}{selectedWallet.balance ? parseFloat(selectedWallet.balance).toFixed(2) : '0.00'}
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                     font-semibold text-white transition-opacity hover:opacity-90
                     disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Send Payment
                </button>
            </form>
        </div>
    );
}

function ErrorView({
    errorInfo,
    onRetry,
    onClose,
}: {
    errorInfo: SendMoneyErrorInfo;
    onRetry: () => void;
    onClose: () => void;
}) {
    const config = ERROR_DISPLAY_CONFIG[errorInfo.kind];
    const Icon = config.icon;

    return (
        <div className="text-center">
            <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${config.iconBg}`}>
                <Icon className={config.iconColor} size={32} />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-[#f0f2f5]">{config.title}</h3>
            <p className="mb-6 text-sm text-[#6b7280]">{config.getDescription(errorInfo)}</p>

            <div className="flex gap-3">
                {config.showRetry && (
                    <button
                        onClick={onRetry}
                        className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3
                       text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                        Try Again
                    </button>
                )}
                <button
                    onClick={onClose}
                    className={`${config.showRetry ? 'flex-1' : 'w-full'} rounded-xl border border-white/[0.06]
                     py-3 text-sm text-[#f0f2f5] transition-colors hover:bg-white/[0.04]`}
                >
                    Close
                </button>
            </div>
        </div>
    );
}

const ERROR_DISPLAY_CONFIG: Record<
  SendMoneyErrorInfo['kind'],
  {
    icon: typeof XCircle;
    iconColor: string;
    iconBg: string;
    title: string;
    getDescription: (err: SendMoneyErrorInfo) => string;
    showRetry: boolean;
  }
> = {

  GATEWAY_DECLINE: {
    icon: XCircle,
    iconColor: 'text-[#f87171]',
    iconBg: 'bg-[#f87171]/10',
    title: 'Payment Declined',
    getDescription: () =>
      'The payment gateway declined this transaction — most likely insufficient funds. Your wallet was not charged.',
    showRetry: false,
  },

  FRAUD_BLOCK: {
    icon: AlertTriangle,
    iconColor: 'text-[#fbbf24]',
    iconBg: 'bg-[#fbbf24]/10',
    title: 'Transaction Blocked',
    getDescription: (err) =>
      err.message || 'Our fraud detection system flagged this transaction and blocked it for your protection.',
    showRetry: false,
  },

  WALLET_BUSY: {
    icon: RefreshCw,
    iconColor: 'text-[#fbbf24]',
    iconBg: 'bg-[#fbbf24]/10',
    title: 'Wallet Busy',
    getDescription: () =>
      'This wallet has another transaction in progress. No charge was made — please try again in a moment.',
    showRetry: true,
  },

  GENERIC: {
    icon: XCircle,
    iconColor: 'text-[#f87171]',
    iconBg: 'bg-[#f87171]/10',
    title: 'Something Went Wrong',
    getDescription: (err) => err.message || 'An unexpected error occurred. Your card was not charged.',
    showRetry: true,
  },
};

function StatusView({
    icon, title, subtitle,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
}) {
    return (
        <div className="py-4 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
                {icon}
            </div>
            <h3 className="mb-2 text-lg font-semibold text-[#f0f2f5]">{title}</h3>
            <p className="text-sm text-[#6b7280]">{subtitle}</p>
        </div>
    );
}