/**
 * Thin HTTP client for the Python AI service (ai/main.py's FastAPI app)
 * — GET /egsi/current, GET /forecast, POST /cycle. Uses Node's built-in
 * fetch (Node >= 18, per this package's engines field) rather than
 * adding an HTTP client dependency.
 */

export interface EgsiComponentsDto {
  base_fee: number;
  utilization: number;
  mempool_pressure: number;
  fee_momentum: number;
  gas_volatility: number;
  dex_activity: number;
  thetanuts_iv: number | null;
}

export interface EgsiSnapshotDto {
  market: string;
  score: number;
  components: EgsiComponentsDto;
  block_number: number;
  timestamp: number;
}

export interface ForecastDto {
  market: string;
  expected_egsi: number;
  confidence: number;
  p_tail_500: number;
  model_version: string;
}

export interface RunCycleInput {
  thetanutsAtmIv?: number;
  thetanutsSkew25Delta?: number;
}

export interface AiClient {
  getCurrentEgsi(): Promise<EgsiSnapshotDto | null>;
  getForecast(): Promise<ForecastDto | null>;
  runCycle(input?: RunCycleInput): Promise<EgsiSnapshotDto>;
}

/** Thrown by runCycle (which callers need to actually observe failures
 * from — it's a POST triggering real work, not a best-effort read).
 * getCurrentEgsi/getForecast deliberately don't throw; see their doc
 * comments. */
export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

export class HttpAiClient implements AiClient {
  constructor(private readonly baseUrl: string) {}

  /** Returns null (rather than throwing) on any failure — including the
   * AI service being unreachable, or a 503 because it has no snapshot
   * yet (ai/main.py's own "no EGSI snapshot yet — call POST /cycle
   * first" state). GET /api/v1/market composes this with the Sui read;
   * a down AI service shouldn't take the whole market-state response
   * down with it, just omit the egsi field. */
  async getCurrentEgsi(): Promise<EgsiSnapshotDto | null> {
    try {
      const res = await fetch(`${this.baseUrl}/egsi/current`);
      if (!res.ok) return null;
      return (await res.json()) as EgsiSnapshotDto;
    } catch {
      return null;
    }
  }

  /** Same best-effort contract as getCurrentEgsi — see its doc comment. */
  async getForecast(): Promise<ForecastDto | null> {
    try {
      const res = await fetch(`${this.baseUrl}/forecast`);
      if (!res.ok) return null;
      return (await res.json()) as ForecastDto;
    } catch {
      return null;
    }
  }

  /** Unlike the two reads above, this throws on failure — POST /cycle
   * does real ingestion work server-side and a caller (the hedge-signal
   * bridge route) needs to know if it didn't actually happen, not
   * silently proceed as if it had. */
  async runCycle(input?: RunCycleInput): Promise<EgsiSnapshotDto> {
    const body = input
      ? {
          thetanuts_atm_iv: input.thetanutsAtmIv,
          thetanuts_skew_25delta: input.thetanutsSkew25Delta,
        }
      : {};
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AiServiceError(`AI service unreachable at ${this.baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new AiServiceError(`AI service POST /cycle failed with status ${res.status}`, res.status);
    }
    return (await res.json()) as EgsiSnapshotDto;
  }
}
