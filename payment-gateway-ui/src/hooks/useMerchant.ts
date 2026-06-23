'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import {
  Merchant,
  MerchantCreateApiResponse,
  MerchantGetApiResponse,
  WebhookEndpoint,
  WebhookEndpointsApiResponse,
  CreateEndpointApiResponse,
  ApiError,
} from '../types';

interface UseMerchantReturn {

  merchant:             Merchant | null;
  isLoadingMerchant:   boolean;
  isMerchantChecked:   boolean;
  merchantError:        string | null;

  justCreatedSecret:    string | null;
  clearJustCreatedSecret: () => void;

  isRegistering:        boolean;
  registerMerchant:     (businessName: string) => Promise<void>;

  endpoints:            WebhookEndpoint[];
  isLoadingEndpoints:  boolean;
  endpointsError:       string | null;
  isCreatingEndpoint:  boolean;
  deactivatingIds:      Set<string>;
  createEndpoint:       (url: string, eventTypes: string[]) => Promise<void>;
  deactivateEndpoint:   (endpointId: string) => Promise<void>;
  refetchEndpoints:     () => Promise<void>;
}

export function useMerchant(): UseMerchantReturn {
  const [merchant,           setMerchant]           = useState<Merchant | null>(null);
  const [isLoadingMerchant,  setIsLoadingMerchant]  = useState(true);
  const [isMerchantChecked,  setIsMerchantChecked]  = useState(false);
  const [merchantError,      setMerchantError]      = useState<string | null>(null);

  const [justCreatedSecret, setJustCreatedSecret]   = useState<string | null>(null);
  const [isRegistering,     setIsRegistering]       = useState(false);

  const [endpoints,          setEndpoints]           = useState<WebhookEndpoint[]>([]);
  const [isLoadingEndpoints, setIsLoadingEndpoints]  = useState(false);
  const [endpointsError,     setEndpointsError]      = useState<string | null>(null);
  const [isCreatingEndpoint, setIsCreatingEndpoint]  = useState(false);
  const [deactivatingIds,    setDeactivatingIds]     = useState<Set<string>>(new Set());

  const fetchEndpoints = useCallback(async () => {
    setIsLoadingEndpoints(true);
    setEndpointsError(null);
    try {
      const res = await apiFetch<WebhookEndpointsApiResponse>('/api/webhooks/endpoints');
      setEndpoints(res.data.endpoints);
    } catch (err) {
      setEndpointsError((err as ApiError).message ?? 'Failed to load endpoints');
    } finally {
      setIsLoadingEndpoints(false);
    }
  }, []);

  const checkMerchantStatus = useCallback(async () => {
    setIsLoadingMerchant(true);
    setMerchantError(null);
    try {
      const res = await apiFetch<MerchantGetApiResponse>('/api/webhooks/merchants/me');
      setMerchant(res.data.merchant);

      await fetchEndpoints();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.statusCode === 404) {

        setMerchant(null);
      } else {
        setMerchantError(apiErr.message ?? 'Failed to check merchant status');
      }
    } finally {
      setIsLoadingMerchant(false);
      setIsMerchantChecked(true);
    }
  }, [fetchEndpoints]);

  useEffect(() => {
    checkMerchantStatus();
  }, [checkMerchantStatus]);

  const registerMerchant = useCallback(async (businessName: string) => {
    setIsRegistering(true);
    try {
      const res = await apiFetch<MerchantCreateApiResponse>('/api/webhooks/merchants', {
        method: 'POST',
        body:   { businessName },
      });

      const { webhookSecret, ...merchantWithoutSecret } = res.data.merchant;
      setMerchant(merchantWithoutSecret);
      setJustCreatedSecret(webhookSecret);
      setEndpoints([]);
    } finally {
      setIsRegistering(false);
    }

  }, []);

  const clearJustCreatedSecret = useCallback(() => {
    setJustCreatedSecret(null);
  }, []);

  const createEndpoint = useCallback(async (url: string, eventTypes: string[]) => {
    setIsCreatingEndpoint(true);
    try {
      const res = await apiFetch<CreateEndpointApiResponse>('/api/webhooks/endpoints', {
        method: 'POST',
        body:   { url, eventTypes },
      });

      setEndpoints((prev) => [res.data.endpoint, ...prev]);
    } finally {
      setIsCreatingEndpoint(false);
    }

  }, []);

  const deactivateEndpoint = useCallback(async (endpointId: string) => {

    setDeactivatingIds((prev) => new Set(prev).add(endpointId));
    try {
      await apiFetch(`/api/webhooks/endpoints/${endpointId}`, { method: 'DELETE' });

      setEndpoints((prev) =>
        prev.map((ep) => ep.id === endpointId ? { ...ep, isActive: false } : ep),
      );
    } finally {

      setDeactivatingIds((prev) => {
        const next = new Set(prev);
        next.delete(endpointId);
        return next;
      });
    }
  }, []);

  return {
    merchant,
    isLoadingMerchant,
    isMerchantChecked,
    merchantError,
    justCreatedSecret,
    clearJustCreatedSecret,
    isRegistering,
    registerMerchant,
    endpoints,
    isLoadingEndpoints,
    endpointsError,
    isCreatingEndpoint,
    deactivatingIds,
    createEndpoint,
    deactivateEndpoint,
    refetchEndpoints: fetchEndpoints,
  };
}
