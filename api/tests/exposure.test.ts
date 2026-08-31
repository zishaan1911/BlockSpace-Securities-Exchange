import { describe, expect, it } from 'vitest';
import { assessExposure, type ExposureConfig } from '../src/exposure.js';

const config: ExposureConfig = {
  ethBeta: 0.5,
  hedgeThresholdNotional: 5000,
  hedgeContracts: 1,
  offerDeadlineMinutes: 10,
};

describe('assessExposure', () => {
  it('computes signed EGSI notional from contracts, multiplier and level', () => {
    const result = assessExposure({ netContracts: 10, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.egsiNotional).toBe(50_000);
  });

  it('applies the configured ETH beta to get ETH-beta notional', () => {
    const result = assessExposure({ netContracts: 10, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.ethBetaNotional).toBe(25_000); // 50_000 * 0.5
  });

  it('reports a flat book as not breached', () => {
    const result = assessExposure({ netContracts: 0, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.egsiNotional).toBe(0);
    expect(result.breached).toBe(false);
    expect(result.suggestedOptionType).toBeNull();
  });

  it('reports a small position as within threshold', () => {
    // 1 * 10 * 500 * 0.5 = 2500, under the 5000 threshold.
    const result = assessExposure({ netContracts: 1, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.breached).toBe(false);
    expect(result.suggestedOptionType).toBeNull();
  });

  it('suggests a PUT hedge for a breaching net-long book', () => {
    const result = assessExposure({ netContracts: 10, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.breached).toBe(true);
    expect(result.suggestedOptionType).toBe('PUT');
  });

  it('suggests a CALL hedge for a breaching net-short book', () => {
    const result = assessExposure({ netContracts: -10, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.ethBetaNotional).toBe(-25_000);
    expect(result.breached).toBe(true);
    expect(result.suggestedOptionType).toBe('CALL');
  });

  it('treats the threshold as strictly exclusive (exactly at threshold is not breached)', () => {
    // Tuned so ethBetaNotional lands exactly on 5000.
    const result = assessExposure({ netContracts: 2, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.ethBetaNotional).toBe(5000);
    expect(result.breached).toBe(false);
  });

  it('breaches just above the threshold', () => {
    const result = assessExposure({ netContracts: 3, contractMultiplier: 10, egsiLevel: 500 }, config);
    expect(result.ethBetaNotional).toBe(7500);
    expect(result.breached).toBe(true);
  });

  it('scales with the configured beta', () => {
    const lowBeta = assessExposure(
      { netContracts: 10, contractMultiplier: 10, egsiLevel: 500 },
      { ...config, ethBeta: 0.1 },
    );
    const highBeta = assessExposure(
      { netContracts: 10, contractMultiplier: 10, egsiLevel: 500 },
      { ...config, ethBeta: 0.9 },
    );
    expect(highBeta.ethBetaNotional).toBeGreaterThan(lowBeta.ethBetaNotional);
    expect(lowBeta.breached).toBe(false); // 5000 exactly -> not breached
    expect(highBeta.breached).toBe(true);
  });

  it('scales with the EGSI level (same position, more stressed market)', () => {
    const calm = assessExposure({ netContracts: 5, contractMultiplier: 10, egsiLevel: 100 }, config);
    const stressed = assessExposure({ netContracts: 5, contractMultiplier: 10, egsiLevel: 900 }, config);
    expect(calm.breached).toBe(false);
    expect(stressed.breached).toBe(true);
  });
});
