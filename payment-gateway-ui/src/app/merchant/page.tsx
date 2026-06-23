'use client';

import { useEffect, useState } from 'react';
import { useRouter }            from 'next/navigation';
import { Store, ArrowLeft }     from 'lucide-react';

import { useAuth }               from '../../context/AuthContext';
import { useMerchant }           from '../../hooks/useMerchant';
import { MerchantOnboarding }    from '../../components/merchant/MerchantOnboarding';
import { WebhookSecretReveal }   from '../../components/merchant/WebhookSecretReveal';
import { EndpointList }          from '../../components/merchant/EndpointList';
import { AddEndpointForm }       from '../../components/merchant/AddEndpointForm';
import { SystemHealthBar }       from '../../components/ui/SystemHealthBar';

export default function MerchantPage() {
  const router        = useRouter();
  const { authState } = useAuth();
  const m             = useMerchant();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!authState.token) router.replace('/');
  }, [authState.token, router]);

  if (!mounted || !authState.user) return null;

  return (
    <div className="min-h-screen bg-[#08090a] px-4 py-8">
      <div className="mx-auto max-w-2xl">

        <button
          onClick={() => router.push('/dashboard')}
          className="mb-6 flex items-center gap-1.5 text-sm text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
        >
          <ArrowLeft size={15} />
          Back to Dashboard
        </button>

        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3ecf8e]/10">
            <Store size={20} className="text-[#3ecf8e]" />
          </div>
          <div>
            <h1 className="font-semibold text-[#f0f2f5]">Merchant Dashboard</h1>
            <p className="text-xs text-[#6b7280]">
              Webhook endpoints and delivery settings
            </p>
          </div>
        </header>

        <SystemHealthBar />

        {m.isLoadingMerchant && !m.isMerchantChecked && (
          <div className="py-20 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/[0.10] border-t-[#3ecf8e]" />
            <p className="mt-3 text-sm text-[#6b7280]">Checking merchant status...</p>
          </div>
        )}

        {m.merchantError && (
          <div className="mb-6 rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-3 text-sm text-[#f87171]">
            {m.merchantError}
          </div>
        )}

        {m.isMerchantChecked && !m.merchant && !m.justCreatedSecret && (
          <MerchantOnboarding
            isRegistering={m.isRegistering}
            onRegister={m.registerMerchant}
          />
        )}

        {m.justCreatedSecret && m.merchant && (
          <WebhookSecretReveal
            secret={m.justCreatedSecret}
            merchantId={m.merchant.id}
            onDismiss={m.clearJustCreatedSecret}
          />
        )}

        {m.merchant && !m.justCreatedSecret && (
          <div className="space-y-6">
            <MerchantProfileCard
              businessName={m.merchant.businessName}
              merchantId={m.merchant.id}
              createdAt={m.merchant.createdAt}
            />

            <section>
              <div className="mb-4">
                <h2 className="font-semibold text-[#f0f2f5]">Webhook Endpoints</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Each active endpoint receives a signed HTTP POST when a subscribed event
                  occurs. Failed deliveries retry up to 5 times with exponential backoff
                  (2s → 4s → 8s → 16s → 32s) before moving to the Dead Letter Queue.
                </p>
              </div>

              <div className="space-y-3">
                <AddEndpointForm
                  isCreating={m.isCreatingEndpoint}
                  onAdd={m.createEndpoint}
                />
                <EndpointList
                  endpoints={m.endpoints}
                  isLoading={m.isLoadingEndpoints}
                  error={m.endpointsError}
                  deactivatingIds={m.deactivatingIds}
                  onDeactivate={m.deactivateEndpoint}
                />
              </div>
            </section>

            <VerificationSnippet />
          </div>
        )}
      </div>
    </div>
  );
}

function MerchantProfileCard({
  businessName, merchantId, createdAt,
}: {
  businessName: string;
  merchantId:   string;
  createdAt:    string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#6b7280]">Registered business</p>
          <h3 className="mt-0.5 font-semibold text-[#f0f2f5]">{businessName}</h3>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          Active Merchant
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-xs">
        <div>
          <span className="block text-[#6b7280]/60">Merchant ID</span>
          <code className="font-mono text-[#f0f2f5]">
            {merchantId.substring(0, 18)}...
          </code>
        </div>
        <div>
          <span className="block text-[#6b7280]/60">Member since</span>
          <span className="text-[#f0f2f5]">
            {new Date(createdAt).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

function VerificationSnippet() {
  return (
    <details className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center justify-between font-medium text-[#f0f2f5] outline-none">
        How Verifying Webhook signatures works
        <span className="transition-transform duration-200 group-open:rotate-180 text-[#6b7280]">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <p className="mb-4 text-xs text-[#6b7280]">
          Add this logic to your endpoint to make sure you're rejecting spoofed requests.
          Make sure to use <code className="font-mono">express.raw()</code> so you get the exact byte sequence of the body. If you parse the JSON first, the signature won't match!
        </p>
        <pre className="overflow-x-auto rounded-xl bg-[#08090a] p-4 font-mono text-xs leading-relaxed text-[#f0f2f5]">
{`const crypto = require('crypto');

function verifySignature(rawBody, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  if (hash.length !== signature.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-webhook-signature'];

  if (!verifySignature(req.body, sig, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Signature mismatch' });
  }

  const event = JSON.parse(req.body.toString());
  console.log('Got verified event:', event.type);

  res.status(200).send('OK');
});`}
        </pre>
      </div>
    </details>
  );
}
