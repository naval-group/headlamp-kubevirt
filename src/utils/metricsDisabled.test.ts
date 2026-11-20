import { describe, expect, it } from 'vitest';
import { isMetricsDisabled, metricsHidden } from './metricsDisabled';

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

describe('metricsHidden', () => {
  it('hides metrics until the cluster config is loaded', () => {
    expect(metricsHidden(false, {})).toBe(true);
    expect(metricsHidden(false, { metricsDisabled: 'false' })).toBe(true);
    expect(metricsHidden(true, {})).toBe(false);
    expect(metricsHidden(true, { metricsDisabled: 'true' })).toBe(true);
  });
});
