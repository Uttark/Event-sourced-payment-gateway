'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { TopupStatus, getCurrencySymbol } from '../../types';

interface TopUpModalProps {
    isOpen: boolean;
    status: TopupStatus;
    currency: string;
    onAmountSubmit: (amount: number) => void;
    onClose: () => void;
}

export function TopUpModal({ isOpen, status, currency, onAmountSubmit, onClose }: TopUpModalProps) {
    const [inputValue, setInputValue] = useState<string>('');

    if (!isOpen) return null;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const amount = parseFloat(inputValue);
        if (!isNaN(amount) && amount > 0) {
            onAmountSubmit(amount);
        }
    }

    const showCloseButton = status === 'idle' || status === 'error' || status === 'success';

    return (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-md rounded-2xl border border-t-white/[0.12] border-white/[0.06] bg-[#0f1012] p-8">
                {showCloseButton && (
                    <button
                        onClick={onClose}
                        className="absolute right-4 top-4 rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-white/[0.06] hover:text-[#f0f2f5]"
                    >
                        <X size={18} />
                    </button>
                )}
                <ModalBody
                    status={status}
                    currency={currency}
                    inputValue={inputValue}
                    onInputChange={setInputValue}
                    onSubmit={handleSubmit}
                    onClose={onClose}
                />
            </div>
        </div>
    );
}

interface ModalBodyProps {
    status: TopupStatus;
    currency: string;
    inputValue: string;
    onInputChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    onClose: () => void;
}

function ModalBody({ status, currency, inputValue, onInputChange, onSubmit, onClose }: ModalBodyProps) {
    switch (status) {
        case 'idle':
            return (
                <div>
                    <h2 className="mb-2 text-xl font-semibold text-[#f0f2f5]">Top Up Wallet</h2>
                    <p className="mb-6 text-sm text-[#6b7280]">
                        Enter the amount you want to add to your ledger balance.
                    </p>
                    <form onSubmit={onSubmit}>
                        <label className="mb-2 block text-sm font-medium text-[#6b7280]">
                            Amount ({currency})
                        </label>
                        <div className="relative mb-6">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[#6b7280]">
                                {getCurrencySymbol(currency)}
                            </span>
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="500.00"
                                value={inputValue}
                                onChange={(e) => onInputChange(e.target.value)}
                                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-3.5
                           pl-10 pr-4 font-mono text-[#f0f2f5] placeholder-[#6b7280] outline-none
                           transition-colors focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!inputValue || parseFloat(inputValue) <= 0}
                            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                         font-semibold text-white transition-opacity hover:opacity-90
                         disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Proceed to Payment
                        </button>
                    </form>
                </div>
            );

        case 'initiating':
            return <StatusView icon={<Loader2 className="animate-spin text-[#3ecf8e]" size={40} />} title="Creating order..." subtitle="Setting up your payment session." />;

        case 'awaiting_payment':
            return <StatusView icon={<Loader2 className="animate-spin text-[#3ecf8e]" size={40} />} title="Opening payment window..." subtitle="Complete your payment in the Razorpay checkout." />;

        case 'verifying':
            return <StatusView icon={<Loader2 className="animate-spin text-[#3ecf8e]" size={40} />} title="Verifying payment..." subtitle="Confirming your payment signature with Razorpay." />;

        case 'polling':
            return (
                <StatusView
                    icon={<Loader2 className="animate-spin text-[#3ecf8e]" size={40} />}
                    title="⏳ Ledger is settling..."
                    subtitle="Your payment was received. The ledger consumer is committing the balance update."
                />
            );

        case 'success':
            return <StatusView icon={<CheckCircle2 className="text-[#3ecf8e]" size={40} />} title="Top-up successful!" subtitle="Your ledger balance has been updated." />;

        case 'error':
            return (
                <div className="text-center">
                    <XCircle className="mx-auto mb-4 text-[#f87171]" size={40} />
                    <h3 className="mb-2 text-lg font-semibold text-[#f0f2f5]">Something went wrong</h3>
                    <p className="mb-6 text-sm text-[#6b7280]">Your card was not charged.</p>
                    <button
                        onClick={onClose}
                        className="w-full rounded-xl border border-white/[0.06] py-3 text-sm text-[#f0f2f5] hover:bg-white/[0.04]"
                    >
                        Close
                    </button>
                </div>
            );
    }
}

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