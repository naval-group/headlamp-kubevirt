import { isFeatureGateEnabled, updateFeatureGates } from './featureGates';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
}));

vi.mock('@kinvolk/headlamp-plugin/lib/components/common', () => ({
  SectionBox: () => null,
}));

describe('isFeatureGateEnabled', () => {
  afterEach(() => updateFeatureGates([], [], null));

  it('uses version-specific default states', () => {
    updateFeatureGates([], [], '1.9.0');

    expect(isFeatureGateEnabled('Snapshot')).toBe(true);
    expect(isFeatureGateEnabled('VMExport')).toBe(true);
    expect(isFeatureGateEnabled('VMStatsCollector')).toBe(false);
  });

  it('honors explicit disable and enable precedence', () => {
    updateFeatureGates([], ['RebootPolicy'], '1.9.0');
    expect(isFeatureGateEnabled('RebootPolicy')).toBe(false);

    updateFeatureGates(['RebootPolicy'], ['RebootPolicy'], '1.9.0');
    expect(isFeatureGateEnabled('RebootPolicy')).toBe(true);
  });

  it('keeps unknown gates opt-in only', () => {
    updateFeatureGates([], [], '1.9.0');
    expect(isFeatureGateEnabled('CustomGate')).toBe(false);

    updateFeatureGates(['CustomGate'], [], '1.9.0');
    expect(isFeatureGateEnabled('CustomGate')).toBe(true);
  });

  it('does not infer default states without a version', () => {
    updateFeatureGates([], [], null);
    expect(isFeatureGateEnabled('Snapshot')).toBe(false);

    updateFeatureGates(['Snapshot'], [], null);
    expect(isFeatureGateEnabled('Snapshot')).toBe(true);
  });
});
