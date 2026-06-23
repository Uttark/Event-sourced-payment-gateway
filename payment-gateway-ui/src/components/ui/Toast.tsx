'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, X, Clock } from 'lucide-react';

interface ToastProps {
  message:     string;
  type:        'success' | 'error' | 'info';

  retryAfter?: number;
  onDismiss:   () => void;
}

const TOAST_STYLE = {
  success: {
    border:  'border-[#3ecf8e]/20',
    icon:    CheckCircle2,
    iconCls: 'text-[#3ecf8e]',
  },
  error: {
    border:  'border-[#f87171]/20',
    icon:    XCircle,
    iconCls: 'text-[#f87171]',
  },
  info: {
    border:  'border-white/[0.10]',
    icon:    CheckCircle2,
    iconCls: 'text-[#6b7280]',
  },
} as const;

const DEFAULT_DISMISS_MS = 4_000;

export function Toast({ message, type, retryAfter, onDismiss }: ToastProps) {
  const config  = TOAST_STYLE[type];
  const Icon    = retryAfter ? Clock : config.icon;

  const [countdown, setCountdown] = useState<number>(retryAfter ?? 0);

  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (retryAfter && retryAfter > 0) {

      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            onDismissRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }

    const timer = setTimeout(() => onDismissRef.current(), DEFAULT_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-xl
                  border ${config.border} bg-[#16181c] p-4 shadow-2xl`}
    >
      <Icon size={18} className={`mt-0.5 flex-shrink-0 ${config.iconCls}`} />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#f0f2f5]">{message}</p>

        {retryAfter && countdown > 0 && (
          <div className="mt-2">
            <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[#fbbf24] transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / retryAfter) * 100}%` }}
              />
            </div>
            <p className="font-mono text-xs text-[#fbbf24]">
              Retry available in {countdown}s
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
      >
        <X size={16} />
      </button>
    </div>
  );
}