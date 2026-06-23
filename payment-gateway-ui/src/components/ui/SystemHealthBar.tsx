'use client';

import { useEffect, useState } from 'react';
import { HealthStatus } from '../../types';

const POLL_INTERVAL_MS = 30_000;

export function SystemHealthBar() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [hasError, setHasError] = useState(false);

  async function fetchHealth() {
    try {

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/health`,
        { cache: 'no-store' },
      );
      const data = await res.json() as HealthStatus;
      setHealth(data);
      setHasError(false);
    } catch {

      setHasError(true);
    }
  }

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!health && !hasError) return null;

  if (hasError) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-[#f87171]/20 bg-[#f87171]/5 px-4 py-2.5">
        <StatusDot status="error" />
        <span className="text-xs text-[#f87171]">
          Backend unreachable — check that your Docker containers are running
        </span>
      </div>
    );
  }

  const isHealthy = health!.status === 'ok';

  return (
    <div
      className={`mb-6 flex items-center gap-4 rounded-xl border px-4 py-2.5 ${
        isHealthy
          ? 'border-[#3ecf8e]/10 bg-[#3ecf8e]/[0.03]'
          : 'border-[#fbbf24]/20 bg-[#fbbf24]/5'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot status={isHealthy ? 'connected' : 'error'} />
        <span className={`text-xs font-medium ${isHealthy ? 'text-[#3ecf8e]' : 'text-[#fbbf24]'}`}>
          {isHealthy ? 'All systems operational' : 'Degraded'}
        </span>
      </div>

      <div className="h-3 w-px bg-white/[0.08]" />

      <div className="flex items-center gap-4">
        <ServiceStatus label="Database" status={health!.services.database} />
        <ServiceStatus label="Redis"    status={health!.services.redis}    />
      </div>

      {health!.version && health!.version !== 'unknown' && (
        <>
          <div className="ml-auto h-3 w-px bg-white/[0.08]" />
          <span className="font-mono text-xs text-[#6b7280]">v{health!.version}</span>
        </>
      )}
    </div>
  );
}

function ServiceStatus({
  label,
  status,
}: {
  label:  string;
  status: 'connected' | 'error' | 'unknown';
}) {
  return (
    <div className="flex items-center gap-1.5">
      <StatusDot status={status} />
      <span className="text-xs text-[#6b7280]">{label}</span>
    </div>
  );
}

function StatusDot({ status }: { status: 'connected' | 'error' | 'unknown' }) {
  const color =
    status === 'connected' ? 'bg-[#3ecf8e]' :
    status === 'error'     ? 'bg-[#f87171]' :
                             'bg-[#6b7280]';
  return <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${color}`} />;
}
