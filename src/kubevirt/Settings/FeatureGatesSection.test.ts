import type { FeatureGateInfo, FeatureGateState } from './FeatureGatesSection';
import {
  FEATURE_GATE_CATEGORIES,
  getGateStateForVersion,
  isFeatureGateEnabledForVersion,
  parseKubeVirtVersion,
  updateFeatureGateLists,
} from './FeatureGatesSection';

vi.mock('@kinvolk/headlamp-plugin/lib/components/common', () => ({
  SectionBox: () => null,
}));

const gates = Object.values(FEATURE_GATE_CATEGORIES).flatMap(category => category.gates);

function getGate(name: string): FeatureGateInfo {
  const gate = gates.find(candidate => candidate.name === name);
  if (!gate) throw new Error(`Unknown feature gate: ${name}`);
  return gate;
}

describe('KubeVirt 1.9 feature gates', () => {
  it.each<[string, FeatureGateState]>([
    ['VMExport', 'GA'],
    ['HotplugVolumes', 'Deprecated'],
    ['DeclarativeHotplugVolumes', 'Beta'],
    ['LiveUpdateNADRef', 'GA'],
    ['RebootPolicy', 'Beta'],
    ['VmiMemoryOverheadReport', 'Beta'],
    ['GPUsWithDRA', 'Beta'],
    ['HostDevicesWithDRA', 'Beta'],
    ['PanicDevices', 'GA'],
    ['WorkloadEncryptionSEV', 'Beta'],
    ['SecureExecution', 'GA'],
    ['OptOutRoleAggregation', 'Beta'],
    ['MigrationPriorityQueue', 'GA'],
    ['LibvirtHooksServerAndClient', 'Beta'],
    ['VideoConfig', 'GA'],
    ['PersistentReservation', 'GA'],
    ['Template', 'Beta'],
  ])('marks %s as %s', (name, state) => {
    expect(getGateStateForVersion(getGate(name), '1.9.0')).toBe(state);
  });

  it.each([
    'NetworkDevicesWithDRA',
    'VMStatsCollector',
    'OCIExport',
    'Plugins',
    'GraceIOVirtualization',
    'IOMMUFD',
    'FirmwareAutoSelection',
    'MigrationStallDetection',
    'CrossArchitectureVirtualization',
    'PortRangesSpec',
  ])('introduces %s as Alpha in 1.9', name => {
    const gate = getGate(name);
    expect(getGateStateForVersion(gate, '1.8.0')).toBeNull();
    expect(getGateStateForVersion(gate, '1.9.0')).toBe('Alpha');
  });

  it('keeps the ExpandDisks GA transition introduced in 1.8', () => {
    expect(getGateStateForVersion(getGate('ExpandDisks'), '1.8.0')).toBe('GA');
  });

  it('accepts the v-prefixed version reported by KubeVirt', () => {
    expect(getGateStateForVersion(getGate('VMExport'), 'v1.9.0')).toBe('GA');
  });
});

describe('KubeVirt version parsing', () => {
  it('accepts release and prerelease versions', () => {
    expect(parseKubeVirtVersion('v1.9.0')).toEqual([1, 9]);
    expect(parseKubeVirtVersion('1.9.0-rc.1')).toEqual([1, 9]);
  });

  it('does not invent a version for unavailable values', () => {
    expect(parseKubeVirtVersion('Unknown')).toBeNull();
    expect(parseKubeVirtVersion(undefined)).toBeNull();
  });
});

describe('feature gate enablement', () => {
  const isEnabled = (name: string, enabled: string[] = [], disabled: string[] = []) =>
    isFeatureGateEnabledForVersion(getGate(name), '1.9.0', enabled, disabled);

  it('enables GA and Beta gates by default', () => {
    expect(isEnabled('VMExport')).toBe(true);
    expect(isEnabled('RebootPolicy')).toBe(true);
  });

  it('keeps Alpha and Deprecated gates disabled by default', () => {
    expect(isEnabled('VMStatsCollector')).toBe(false);
    expect(isEnabled('HotplugVolumes')).toBe(false);
  });

  it('uses KubeVirt precedence for explicit enable and disable lists', () => {
    expect(isEnabled('RebootPolicy', [], ['RebootPolicy'])).toBe(false);
    expect(isEnabled('RebootPolicy', ['RebootPolicy'], ['RebootPolicy'])).toBe(true);
    expect(isEnabled('VMExport', [], ['VMExport'])).toBe(true);
  });

  it('writes Beta opt-outs to disabledFeatureGates', () => {
    expect(updateFeatureGateLists('RebootPolicy', 'Beta', false, [], [])).toEqual({
      enabledFeatureGates: [],
      disabledFeatureGates: ['RebootPolicy'],
    });
  });

  it('removes Beta opt-outs when restoring the default', () => {
    expect(updateFeatureGateLists('RebootPolicy', 'Beta', true, [], ['RebootPolicy'])).toEqual({
      enabledFeatureGates: [],
      disabledFeatureGates: [],
    });
  });

  it('continues to store Alpha opt-ins in featureGates', () => {
    expect(updateFeatureGateLists('VMStatsCollector', 'Alpha', true, [], [])).toEqual({
      enabledFeatureGates: ['VMStatsCollector'],
      disabledFeatureGates: [],
    });
  });
});
