import { describe, expect, it } from 'vitest';
import { formatBytes, parseQuantity, pvcSizes, vmStorageTotal } from './vmStorage';

const GiB = 2 ** 30;

describe('parseQuantity', () => {
  it('parses binary, decimal, exponent and plain quantities', () => {
    expect(parseQuantity('65Gi')).toBe(65 * GiB);
    expect(parseQuantity('512Mi')).toBe(512 * 2 ** 20);
    expect(parseQuantity('1.5Ti')).toBe(1.5 * 2 ** 40);
    expect(parseQuantity('500M')).toBe(500e6);
    expect(parseQuantity('2G')).toBe(2e9);
    expect(parseQuantity('1e9')).toBe(1e9);
    expect(parseQuantity('1073741824')).toBe(GiB);
    expect(parseQuantity(1024)).toBe(1024);
  });

  it('rejects invalid values', () => {
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('10GB')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
});

describe('pvcSizes', () => {
  it('prefers capacity over the request and skips incomplete PVCs', () => {
    const sizes = pvcSizes([
      {
        metadata: { name: 'a', namespace: 'ns' },
        spec: { resources: { requests: { storage: '10Gi' } } },
        status: { capacity: { storage: '12Gi' } },
      },
      {
        metadata: { name: 'b', namespace: 'ns' },
        spec: { resources: { requests: { storage: '5Gi' } } },
      },
      { metadata: { name: 'c' } },
    ]);
    expect(sizes.get('ns/a')).toBe(12 * GiB);
    expect(sizes.get('ns/b')).toBe(5 * GiB);
    expect(sizes.size).toBe(2);
  });
});

function vm(name: string, volumes: object[], templates: object[] = [], namespace = 'ns') {
  return {
    metadata: { name, namespace },
    spec: { dataVolumeTemplates: templates, template: { spec: { volumes } } },
  };
}

describe('vmStorageTotal', () => {
  it('sums PVC and DataVolume disks, ignores ephemeral volumes', () => {
    const vms = [
      vm('v1', [
        { dataVolume: { name: 'v1-root' } },
        { containerDisk: {} },
        { cloudInitNoCloud: {} },
      ]),
      vm('v2', [{ persistentVolumeClaim: { claimName: 'data' } }]),
    ];
    const pvcs = new Map([
      ['ns/v1-root', 65 * GiB],
      ['ns/data', 100 * GiB],
    ]);
    expect(vmStorageTotal(vms, pvcs)).toEqual({ bytes: 165 * GiB, disks: 2, unknown: 0 });
  });

  it('falls back to the dataVolumeTemplate size when the PVC is not known', () => {
    const vms = [
      vm(
        'v1',
        [{ dataVolume: { name: 'v1-root' } }, { dataVolume: { name: 'v1-data' } }],
        [
          {
            metadata: { name: 'v1-root' },
            spec: { storage: { resources: { requests: { storage: '20Gi' } } } },
          },
          {
            metadata: { name: 'v1-data' },
            spec: { pvc: { resources: { requests: { storage: '1Ti' } } } },
          },
        ]
      ),
    ];
    expect(vmStorageTotal(vms, new Map())).toEqual({
      bytes: 20 * GiB + 2 ** 40,
      disks: 2,
      unknown: 0,
    });
  });

  it('counts a shared claim once and reports disks without a size', () => {
    const vms = [
      vm('v1', [
        { persistentVolumeClaim: { claimName: 'shared' } },
        { dataVolume: { name: 'nosize' } },
      ]),
      vm('v2', [{ persistentVolumeClaim: { claimName: 'shared' } }]),
      vm('v3', [{ persistentVolumeClaim: { claimName: 'shared' } }], [], 'other'),
    ];
    const pvcs = new Map([
      ['ns/shared', 10 * GiB],
      ['other/shared', 1 * GiB],
    ]);
    expect(vmStorageTotal(vms, pvcs)).toEqual({ bytes: 11 * GiB, disks: 3, unknown: 1 });
  });

  it('handles empty input', () => {
    expect(vmStorageTotal([], new Map())).toEqual({ bytes: 0, disks: 0, unknown: 0 });
  });
});

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(65 * GiB)).toBe('65.0 GiB');
    expect(formatBytes(1536 * GiB)).toBe('1.5 TiB');
  });
});
