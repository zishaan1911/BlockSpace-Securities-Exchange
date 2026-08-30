/**
 * ThetanutsHedgeProvider: the concrete HedgeProvider (ARCHITECTURE.md
 * §7's "one adapter... so Thetanuts types never leak") \u2014 wraps a real
 * ThetanutsClient and exposes only the GASX-shaped types from types.ts.
 * Composes fetchVolSignal (touchpoint 1) and createHedgeRequest/
 * collectBestCandidate (touchpoint 2); touchpoint 3 (autonomous
 * execution) is Phase 5, not implemented here.
 */
import type { ThetanutsClient } from '@thetanuts-finance/thetanuts-client';
import { createThetanutsClient } from './client.js';
import type { ThetanutsAdapterConfig } from './config.js';
import { collectBestCandidate, createHedgeRequest } from './rfqHedge.js';
import type {
  HedgeCandidate,
  HedgeProvider,
  HedgeRequest,
  HedgeRequestParams,
  HedgeUnderlying,
  VolSignal,
} from './types.js';
import { fetchVolSignal } from './volSignal.js';

export class ThetanutsHedgeProvider implements HedgeProvider {
  private readonly client: ThetanutsClient;

  constructor(config: ThetanutsAdapterConfig) {
    this.client = createThetanutsClient(config);
  }

  async getVolSignal(underlying: HedgeUnderlying): Promise<VolSignal> {
    const signal = await fetchVolSignal(this.client, underlying);
    if (!signal) {
      throw new Error(
        `no usable ${underlying} options quotes with greeks available right now \u2014 caller should fall back to a cached VolSignal or skip this EGSI cycle's Thetanuts component`,
      );
    }
    return signal;
  }

  async requestHedgeQuote(params: HedgeRequestParams): Promise<HedgeRequest> {
    return createHedgeRequest(this.client, params);
  }

  async getBestCandidate(request: HedgeRequest): Promise<HedgeCandidate | null> {
    return collectBestCandidate(this.client, request);
  }
}
