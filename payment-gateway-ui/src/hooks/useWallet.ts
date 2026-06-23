'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { Wallet, WalletsApiResponse, CreateWalletApiResponse, ApiError } from '../types';

interface UseWalletReturn {
  wallets: Wallet[];
  selectedWalletId: string | null;
  selectedWallet: Wallet | null;
  isLoading: boolean;
  isPolling: boolean;
  isCreatingWallet: boolean;
  error: string | null;
  selectWallet: (walletId: string) => void;
  createWallet: (currency: string) => Promise<void>;
  refetch: () => Promise<void>;
  pollUntilUpdated: (walletId: string, previousBalance: string) => Promise<boolean>;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 12;

export function useWallet(): UseWalletReturn {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isCreatingWallet, setIsCreatingWallet] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWallets = useCallback(async (): Promise<Wallet[]> => {
    const res = await apiFetch<WalletsApiResponse>('/api/wallets');
    const fetched = res.data.wallets;
    setWallets(fetched);

    setSelectedWalletId((current) => {
      if (current && fetched.some((w) => w.id === current)) return current;
      return fetched[0]?.id ?? null;
    });

    return fetched;
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await fetchWallets();
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load wallets');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWallets]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const selectWallet = useCallback((walletId: string) => {
    setSelectedWalletId(walletId);
  }, []);

  const createWallet = useCallback(async (currency: string) => {
    setIsCreatingWallet(true);
    try {
      const res = await apiFetch<CreateWalletApiResponse>('/api/wallets', {
        method: 'POST',
        body: { currency },
      });
      await fetchWallets();
      setSelectedWalletId(res.data.wallet.id);
    } finally {
      setIsCreatingWallet(false);
    }
  }, [fetchWallets]);

  const pollUntilUpdated = useCallback(
    (walletId: string, previousBalance: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setIsPolling(true);
        let attempts = 0;

        intervalRef.current = setInterval(async () => {
          attempts++;
          try {
            const freshWallets = await fetchWallets();
            const target = freshWallets.find((w) => w.id === walletId);
            const hasIncreased =
              target !== undefined &&
              parseFloat(target.balance) > parseFloat(previousBalance);

            if (hasIncreased) {
              clearInterval(intervalRef.current!);
              intervalRef.current = null;
              setIsPolling(false);
              resolve(true);
              return;
            }
          } catch {

          }

          if (attempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            setIsPolling(false);
            resolve(false);
          }
        }, POLL_INTERVAL_MS);
      });
    },
    [fetchWallets],
  );

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId) ?? null;

  return {
    wallets,
    selectedWalletId,
    selectedWallet,
    isLoading,
    isPolling,
    isCreatingWallet,
    error,
    selectWallet,
    createWallet,
    refetch,
    pollUntilUpdated,
  };
}