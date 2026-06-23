'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { RateLimitInfo, RateLimitApiResponse, ApiError } from '../types';

export function useAdminRateLimits(adminKey: string) {
  const [merchantId,   setMerchantId]   = useState('');
  const [currentLimit, setCurrentLimit] = useState<RateLimitInfo | null>(null);
  const [isLooking,    setIsLooking]    = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [isResetting,  setIsResetting]  = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null);

  const lookupLimit = useCallback(async (id: string) => {
    if (!id.trim() || !adminKey) return;
    setIsLooking(true);
    setError(null);
    setCurrentLimit(null);
    try {
      const res = await apiFetch<RateLimitApiResponse>(
        `/api/admin/rate-limits/${id.trim()}`,
        { headers: { 'X-Admin-Key': adminKey } },
      );
      setCurrentLimit(res.data);
    } catch (err) {
      setError((err as ApiError).message ?? 'Merchant not found or lookup failed');
    } finally {
      setIsLooking(false);
    }
  }, [adminKey]);

  const setLimit = useCallback(async (
    id: string,
    maxRequests: number,
    windowMs: number,
  ) => {
    if (!adminKey) return;
    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(
        `/api/admin/rate-limits/${id}`,
        {
          method:  'POST',
          headers: { 'X-Admin-Key': adminKey },
          body:    { maxRequests, windowMs },
        },
      );
      const windowLabel = windowMs >= 3_600_000 ? '1 hour' : windowMs >= 300_000 ? '5 min' : '1 min';
      setSuccessMsg(
        maxRequests === 0
          ? 'Merchant is now fully blocked.'
          : `Rate limit updated: ${maxRequests} requests per ${windowLabel}.`,
      );
      await lookupLimit(id);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to set rate limit');
    } finally {
      setIsSaving(false);
    }
  }, [adminKey, lookupLimit]);

  const resetLimit = useCallback(async (id: string) => {
    if (!adminKey) return;
    setIsResetting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(
        `/api/admin/rate-limits/${id}`,
        { method: 'DELETE', headers: { 'X-Admin-Key': adminKey } },
      );
      setSuccessMsg('Custom limit removed. Merchant restored to system default (100 req / min).');
      await lookupLimit(id);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to reset rate limit');
    } finally {
      setIsResetting(false);
    }
  }, [adminKey, lookupLimit]);

  return {
    merchantId,
    setMerchantId,
    currentLimit,
    isLooking,
    isSaving,
    isResetting,
    error,
    successMsg,
    clearMessages: () => { setError(null); setSuccessMsg(null); },
    lookupLimit,
    setLimit,
    resetLimit,
  };
}
