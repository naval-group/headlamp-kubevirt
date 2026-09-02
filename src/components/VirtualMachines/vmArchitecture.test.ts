import {
  DEFAULT_VM_ARCHITECTURE,
  getCPUModelsForArchitecture,
  isCPUModelCompatible,
  isMachineTypeCompatible,
  MACHINE_TYPE_OPTIONS,
  supportsCPUModelSelection,
  VM_ARCHITECTURES,
} from './vmArchitecture';

describe('VM architecture options', () => {
  it('keeps amd64 as the default for new VMs', () => {
    expect(DEFAULT_VM_ARCHITECTURE).toBe('amd64');
  });

  it('only offers architectures supported by KubeVirt', () => {
    expect(VM_ARCHITECTURES.map(option => option.value)).toEqual(['amd64', 'arm64', 's390x']);
  });

  it('loads CPU models advertised by nodes for the selected architecture', () => {
    const nodes = [
      {
        metadata: {
          labels: {
            'kubernetes.io/arch': 'amd64',
            'cpu-model.node.kubevirt.io/Skylake-Client-v4': 'true',
            'cpu-model.node.kubevirt.io/EPYC-Milan': 'false',
          },
        },
      },
      {
        metadata: {
          labels: {
            'kubernetes.io/arch': 'amd64',
            'cpu-model.node.kubevirt.io/Broadwell-v4': 'true',
            'cpu-model.node.kubevirt.io/Skylake-Client-v4': 'true',
          },
        },
      },
      {
        metadata: {
          labels: {
            'kubernetes.io/arch': 's390x',
            'cpu-model.node.kubevirt.io/z14': 'true',
          },
        },
      },
    ];

    expect(getCPUModelsForArchitecture(nodes, 'amd64')).toEqual([
      'Broadwell-v4',
      'Skylake-Client-v4',
    ]);
    expect(getCPUModelsForArchitecture(nodes, 's390x')).toEqual(['z14']);
    expect(getCPUModelsForArchitecture(nodes, 'arm64')).toEqual([]);
  });

  it('matches CPU models to the models advertised for their architecture', () => {
    expect(isCPUModelCompatible('Skylake-Client-v4', 'amd64', ['Skylake-Client-v4'])).toBe(true);
    expect(isCPUModelCompatible('EPYC-Milan', 'amd64', ['Skylake-Client-v4'])).toBe(false);
    expect(isCPUModelCompatible('EPYC-Milan', 'arm64', ['EPYC-Milan'])).toBe(false);
    expect(isCPUModelCompatible('host-passthrough', 'arm64')).toBe(true);
    expect(isCPUModelCompatible('host-model', 'arm64')).toBe(false);
    expect(isCPUModelCompatible('z14', 's390x', ['z14'])).toBe(true);
  });

  it('hides CPU model selection for host-passthrough-only architectures', () => {
    expect(supportsCPUModelSelection('amd64')).toBe(true);
    expect(supportsCPUModelSelection('arm64')).toBe(false);
    expect(supportsCPUModelSelection('s390x')).toBe(true);
  });

  it('matches machine types to their architecture', () => {
    expect(isMachineTypeCompatible('q35', 'amd64')).toBe(true);
    expect(isMachineTypeCompatible('q35', 'arm64')).toBe(false);
    expect(isMachineTypeCompatible('virt', 'arm64')).toBe(true);
    expect(isMachineTypeCompatible('s390-ccw-virtio', 's390x')).toBe(true);
  });

  it('includes the default machine type as a selectable option', () => {
    expect(MACHINE_TYPE_OPTIONS.amd64[0]).toEqual({ value: '', label: 'Default (q35)' });
    expect(MACHINE_TYPE_OPTIONS.arm64[0]).toEqual({ value: '', label: 'Default (virt)' });
  });
});
