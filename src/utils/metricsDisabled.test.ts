import { describe, expect, it } from 'vitest';
import { isMetricsDisabled } from './metricsDisabled';

describe('isMetricsDisabled', () => {
  it('is only on for "true"', () => {
    expect(isMetricsDisabled({ metricsDisabled: 'true' })).toBe(true);
    expect(isMetricsDisabled({ metricsDisabled: ' True ' })).toBe(true);
    expect(isMetricsDisabled({ metricsDisabled: 'false' })).toBe(false);
    expect(isMetricsDisabled({ metricsDisabled: 'yes' })).toBe(false);
    expect(isMetricsDisabled({})).toBe(false);
    expect(isMetricsDisabled(undefined)).toBe(false);
  });
});
