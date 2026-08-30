import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiMarketService } from '../lib/api';
import { MockMarketService } from '../lib/mock';
import type { MarketService, MarketState, OrderRequest, OrderResult } from '../lib/types';

export interface UseMarketState {
  state: MarketState | null;
  mode: 'mock' | 'live';
  submitting: boolean;
  submitOrder: (order: OrderRequest) => Promise<OrderResult>;
}

/**
 * Owns the market feed: simulated (mock) until a backend exists, otherwise
 * REST poll + WebSocket push against the API gateway. The rest of the UI
 * never cares which one is running.
 */
export function useMarketState(): UseMarketState {
  const serviceRef = useRef<MarketService | null>(null);
  const [state, setState] = useState<MarketState | null>(null);
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const useMock =
      import.meta.env.VITE_USE_MOCK === 'true' || !import.meta.env.VITE_API_URL;
    const service: MarketService = useMock
      ? new MockMarketService()
      : new ApiMarketService(
          import.meta.env.VITE_API_URL ?? '',
          import.meta.env.VITE_WS_URL ?? '',
        );
    serviceRef.current = service;
    setMode(useMock ? 'mock' : 'live');
    service.subscribe(setState);
    service.start();
    return () => service.stop();
  }, []);

  const submitOrder = useCallback(async (order: OrderRequest): Promise<OrderResult> => {
    setSubmitting(true);
    try {
      const service = serviceRef.current;
      if (!service) return { ok: false, message: 'Market feed not ready yet.' };
      return await service.submitOrder(order);
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { state, mode, submitting, submitOrder };
}
