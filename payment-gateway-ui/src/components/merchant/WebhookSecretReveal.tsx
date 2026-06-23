'use client';

import { useState, useCallback } from 'react';
import { AlertTriangle, Copy, Check, Eye, EyeOff } from 'lucide-react';

interface WebhookSecretRevealProps {
  secret:     string;
  merchantId: string;
  onDismiss:  () => void;
}

export function WebhookSecretReveal({ secret, merchantId, onDismiss }: WebhookSecretRevealProps) {
  const [isVisible,   setIsVisible]   = useState(false);
  const [isCopied,    setIsCopied]    = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const maskedSecret =
    secret.substring(0, 8) +
    '•'.repeat(Math.max(0, secret.length - 16)) +
    secret.substring(secret.length - 8);

  const handleCopy = useCallback(async () => {
    try {

      await navigator.clipboard.writeText(secret);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {

    }
  }, [secret]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 p-6">

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#fbbf24]/15">
            <AlertTriangle size={20} className="text-[#fbbf24]" />
          </div>
          <div>
            <h2 className="font-semibold text-[#f0f2f5]">Your Webhook Secret</h2>
            <p className="text-xs text-[#fbbf24]">
              This will not be shown again — store it now.
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm text-[#6b7280]">
          Use this secret to verify that webhook POST requests to your endpoint genuinely
          came from this platform. Compute{' '}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-[#f0f2f5]">
            HMAC-SHA256(requestBody, secret)
          </code>{' '}
          and compare it against the{' '}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-[#f0f2f5]">
            X-Webhook-Signature
          </code>{' '}
          header. This is the same approach Stripe and GitHub use.
        </p>

        <div className="mb-4 overflow-hidden rounded-xl border border-white/[0.10] bg-[#08090a]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
            <span className="text-xs text-[#6b7280]">Webhook Secret Key</span>
            <button
              onClick={() => setIsVisible((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
            >
              {isVisible ? <EyeOff size={11} /> : <Eye size={11} />}
              {isVisible ? 'Hide' : 'Reveal'}
            </button>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <code className="flex-1 break-all font-mono text-sm leading-relaxed text-[#f0f2f5]">
              {isVisible ? secret : maskedSecret}
            </code>
            <button
              onClick={handleCopy}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08]
                         px-3 py-1.5 text-xs transition-colors hover:border-white/[0.16]"
            >
              {isCopied ? (
                <>
                  <Check size={12} className="text-[#3ecf8e]" />
                  <span className="text-[#3ecf8e]">Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={12} className="text-[#6b7280]" />
                  <span className="text-[#6b7280]">Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="mb-0.5 text-xs text-[#6b7280]">Your Merchant ID</p>
          <code className="font-mono text-sm text-[#f0f2f5]">{merchantId}</code>
        </div>

        <label className="mb-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isConfirmed}
            onChange={(e) => setIsConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span className="select-none text-sm text-[#6b7280]">
            I have securely stored this secret. I understand that it cannot be
            recovered if lost, and that rotating it will require updating all my
            webhook listeners.
          </span>
        </label>

        <button
          onClick={onDismiss}
          disabled={!isConfirmed}
          className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                     font-semibold text-white transition-opacity hover:opacity-90
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          I&apos;ve saved it — continue to dashboard
        </button>
      </div>
    </div>
  );
}
