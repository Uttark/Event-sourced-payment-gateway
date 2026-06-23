'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import {
  OrphanedTransaction,
  OrphansApiResponse,
  BalanceMismatch,
  IntegrityCheckApiResponse,
  ApiError,
} from '../types';

export function useAdminIntegrity(adminKey: string) {
  const [orphans,       setOrphans]       = useState<OrphanedTransaction[]>([]);
  const [isScanning,    setIsScanning]    = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [orphanError,   setOrphanError]   = useState<string | null>(null);

  const [rebuildingIds, setRebuildingIds] = useState<Set<string>>(new Set());

  const [walletIdInput,  setWalletIdInput]  = useState('');
  const [mismatches,     setMismatches]     = useState<BalanceMismatch[] | null>(null);
  const [isCheckRunning, setIsCheckRunning] = useState(false);
  const [checkCompleted, setCheckCompleted] = useState(false);
  const [checkError,     setCheckError]     = useState<string | null>(null);

  const scanOrphans = useCallback(async () => {
    if (!adminKey) return;
    setIsScanning(true);
    setOrphanError(null);
    try {
      const res = await apiFetch<OrphansApiResponse>(
        '/api/admin/compensation/orphans',
        { headers: { 'X-Admin-Key': adminKey } },
      );
      setOrphans(res.data.orphans);
      setScanCompleted(true);
    } catch (err) {
      setOrphanError((err as ApiError).message ?? 'Orphan scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [adminKey]);

  const rebuildProjection = useCallback(async (walletId: string) => {
    if (!adminKey) return;

    setRebuildingIds((prev) => new Set(prev).add(walletId));
    try {
      await apiFetch(
        '/api/admin/compensation/rebuild-projection',
        {
          method:  'POST',
          headers: { 'X-Admin-Key': adminKey },
          body:    { walletId },
        },
      );

      setOrphans((prev) => prev.filter((o) => o.walletId !== walletId));
    } catch {

    } finally {
      setRebuildingIds((prev) => {
        const next = new Set(prev);
        next.delete(walletId);
        return next;
      });
    }
  }, [adminKey]);

  const runIntegrityCheck = useCallback(async () => {
    if (!adminKey) return;
    setIsCheckRunning(true);
    setCheckError(null);
    setMismatches(null);
    try {
      const body: Record<string, string> = {};
      if (walletIdInput.trim()) body.walletId = walletIdInput.trim();

      const res = await apiFetch<IntegrityCheckApiResponse>(
        '/api/admin/compensation/integrity-check',
        {
          method:  'POST',
          headers: { 'X-Admin-Key': adminKey },
          body,
        },
      );
      setMismatches(res.data.mismatches);
      setCheckCompleted(true);
    } catch (err) {
      setCheckError((err as ApiError).message ?? 'Integrity check failed');
    } finally {
      setIsCheckRunning(false);
    }
  }, [adminKey, walletIdInput]);

  return {
    orphans,
    isScanning,
    scanCompleted,
    orphanError,
    rebuildingIds,
    scanOrphans,
    rebuildProjection,
    walletIdInput,
    setWalletIdInput,
    mismatches,
    isCheckRunning,
    checkCompleted,
    checkError,
    runIntegrityCheck,
  };
}
