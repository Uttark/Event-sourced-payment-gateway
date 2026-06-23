'use client';

import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import {
  DLQItem,
  DLQListApiResponse,
  DLQStats,
  DLQStatsApiResponse,
  ApiError,
} from '../types';

const PAGE_SIZE = 15;

export function useAdminDlq(adminKey: string) {
  const [items,          setItems]          = useState<DLQItem[]>([]);
  const [stats,          setStats]          = useState<DLQStats | null>(null);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [page,           setPage]           = useState(1);
  const [totalPages,     setTotalPages]     = useState(1);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [error,          setError]          = useState<string | null>(null);

  const fetchItems = useCallback(async (currentPage: number, unresolved: boolean) => {
    if (!adminKey) return;
    setIsLoadingItems(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page:           String(currentPage),
        limit:          String(PAGE_SIZE),
        unresolvedOnly: String(unresolved),
      });
      const res = await apiFetch<DLQListApiResponse>(
        `/api/admin/dlq?${qs}`,
        { headers: { 'X-Admin-Key': adminKey } },
      );
      setItems(res.data.items);
      setTotalPages(res.data.pagination.totalPages);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load DLQ items');
    } finally {
      setIsLoadingItems(false);
    }
  }, [adminKey]);

  const fetchStats = useCallback(async () => {
    if (!adminKey) return;
    setIsLoadingStats(true);
    try {
      const res = await apiFetch<DLQStatsApiResponse>(
        '/api/admin/dlq/stats',
        { headers: { 'X-Admin-Key': adminKey } },
      );
      setStats(res.data.stats);
    } catch {

    } finally {
      setIsLoadingStats(false);
    }
  }, [adminKey]);

  useEffect(() => {
    fetchItems(page, unresolvedOnly);
  }, [fetchItems, page, unresolvedOnly]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const replayItem = useCallback(async (dlqId: string): Promise<string> => {
    const res = await apiFetch<{ success: boolean; data: { newDeliveryId: string } }>(
      `/api/admin/dlq/${dlqId}/replay`,
      { method: 'POST', headers: { 'X-Admin-Key': adminKey } },
    );
    setItems((prev) => prev.filter((item) => item.id !== dlqId));

    void fetchStats();
    return res.data.newDeliveryId;
  }, [adminKey, fetchStats]);

  const resolveItem = useCallback(async (dlqId: string): Promise<void> => {
    await apiFetch(
      `/api/admin/dlq/${dlqId}/resolve`,
      { method: 'POST', headers: { 'X-Admin-Key': adminKey } },
    );
    setItems((prev) => prev.filter((item) => item.id !== dlqId));
    void fetchStats();
  }, [adminKey, fetchStats]);

  return {
    items,
    stats,
    isLoadingItems,
    isLoadingStats,
    page,
    totalPages,
    unresolvedOnly,
    error,

    setUnresolvedOnly: (v: boolean) => { setUnresolvedOnly(v); setPage(1); },
    goToNextPage:      () => setPage((p) => Math.min(p + 1, totalPages)),
    goToPrevPage:      () => setPage((p) => Math.max(p - 1, 1)),
    replayItem,
    resolveItem,
    refetch:           () => { fetchItems(page, unresolvedOnly); void fetchStats(); },
  };
}
