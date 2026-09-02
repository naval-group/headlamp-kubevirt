import { describe, expect, it } from 'vitest';
import { buildRegistryDataVolumeSource } from './dataVolumeSource';

describe('buildRegistryDataVolumeSource', () => {
  it('sets the registry platform when the VM architecture is known', () => {
    expect(
      buildRegistryDataVolumeSource('docker://quay.io/containerdisks/centos-stream:10', 'amd64')
    ).toEqual({
      source: {
        registry: {
          url: 'docker://quay.io/containerdisks/centos-stream:10',
          platform: { architecture: 'amd64' },
        },
      },
    });
  });

  it('omits the registry platform when the VM architecture is unknown', () => {
    expect(buildRegistryDataVolumeSource('docker://quay.io/containerdisks/fedora:latest')).toEqual({
      source: {
        registry: {
          url: 'docker://quay.io/containerdisks/fedora:latest',
        },
      },
    });
  });
});
