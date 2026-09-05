/**
 * ThetanutsHedgeProvider: the concrete HedgeProvider (ARCHITECTURE.md
 * §7's "one adapter... so Thetanuts types never leak") -- wraps a real
 * ThetanutsClient and exposes only the GASX-shaped types from types.ts.
 * Composes fetchVolSignal (touchpoint 1), createHedgeRequest/
 * collectBestCandidate (touchpoint 2), and executeHedge (touchpoint 3,
 * autonomous execution -- real money on Base mainnet, no reversal; see
 * rfqHedge.ts's executeHedge for the full safety design, which lives in
 * the gateway route that calls this, not in this adapter method).
 */
import type { ThetanutsClient } from '@thetanuts-finance/thetanuts-client';
import { createThetanutsClient } from './client.js';
import type { ThetanutsAdapterConfig } from './config.js';
import { collectBestCandidate, createHedgeRequest, executeHedge } from './rfqHedge.js';
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

  async executeHedge(
    request: HedgeRequest,
    candidate: HedgeCandidate,
  ): Promise<{ transactionHash: string }> {
    return executeHedge(this.client, request, candidate);
  }
}
