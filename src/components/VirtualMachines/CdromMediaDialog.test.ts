import { describe, expect, it } from 'vitest';
import { buildMediaOptions } from './CdromMediaDialog';

describe('buildMediaOptions', () => {
  it('shows a DataVolume once (not also its PVC), plus standalone PVCs, sorted', () => {
    const dvs = [
      {
        metadata: { name: 'ubuntu-iso' },
        spec: { storage: { resources: { requests: { storage: '3Gi' } } } },
        status: { phase: 'Succeeded' },
      },
    ];
    const pvcs = [
      {
        metadata: { name: 'ubuntu-iso' },
        status: { phase: 'Bound', capacity: { storage: '3Gi' } },
      },
      {
        metadata: { name: 'alpine-iso' },
        status: { phase: 'Bound', capacity: { storage: '1Gi' } },
      },
      { metadata: { name: 'vm1-root' }, status: { phase: 'Bound', capacity: { storage: '30Gi' } } },
    ];
    const options = buildMediaOptions(dvs, pvcs, ['vm1-root']);
    expect(options).toEqual([
      {
        kind: 'persistentVolumeClaim',
        name: 'alpine-iso',
        size: '1Gi',
        phase: 'Bound',
        inUse: false,
      },
      { kind: 'dataVolume', name: 'ubuntu-iso', size: '3Gi', phase: 'Succeeded', inUse: false },
      {
        kind: 'persistentVolumeClaim',
        name: 'vm1-root',
        size: '30Gi',
        phase: 'Bound',
        inUse: true,
      },
    ]);
  });
});
