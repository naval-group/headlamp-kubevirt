import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let cluster: string | null = 'site-a';
vi.mock('./currentCluster', () => ({ currentCluster: () => cluster }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('@kinvolk/headlamp-plugin/lib/components/common', () => ({ SectionBox: () => null }));

import {
  areFeatureGatesLoaded,
  getFeatureGatesCluster,
  isFeatureGateEnabled,
  loadFeatureGates,
  reloadFeatureGatesIfClusterChanged,
} from './featureGates';

const kubevirts = (gates: string[]) => ({
  items: [
    {
      spec: { configuration: { developerConfiguration: { featureGates: gates } } },
      status: { observedKubeVirtVersion: 'v1.9.1' },
    },
  ],
});
const request = ApiProxy.request as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise(r => setTimeout(r, 0));

describe('feature gates per cluster', () => {
  beforeEach(async () => {
    request.mockReset();
    cluster = 'site-a';
    request.mockResolvedValue(kubevirts(['HotplugVolumes']));
    await loadFeatureGates();
  });

  it('reloads the gates when the cluster changes', async () => {
    expect(getFeatureGatesCluster()).toBe('site-a');
    expect(isFeatureGateEnabled('HotplugVolumes')).toBe(true);

    cluster = 'site-b';
    request.mockResolvedValue(kubevirts([]));
    reloadFeatureGatesIfClusterChanged();
    // Nothing from site-a is shown while site-b loads
    expect(areFeatureGatesLoaded()).toBe(false);
    expect(isFeatureGateEnabled('HotplugVolumes')).toBe(false);
    await flush();

    expect(getFeatureGatesCluster()).toBe('site-b');
    expect(areFeatureGatesLoaded()).toBe(true);
    expect(isFeatureGateEnabled('HotplugVolumes')).toBe(false);
    expect(isFeatureGateEnabled('DeclarativeHotplugVolumes')).toBe(true); // Beta in 1.9
  });

  it('does nothing when the cluster is unchanged', () => {
    request.mockClear();
    reloadFeatureGatesIfClusterChanged();
    expect(request).not.toHaveBeenCalled();
    expect(isFeatureGateEnabled('HotplugVolumes')).toBe(true);
  });

  it('ignores a late answer from the previous cluster', async () => {
    let answerFirst: (v: unknown) => void = () => {};
    request.mockReturnValueOnce(new Promise(r => (answerFirst = r)));
    cluster = 'site-c';
    reloadFeatureGatesIfClusterChanged(); // slow site-c request...
    cluster = 'site-a';
    request.mockResolvedValueOnce(kubevirts([]));
    reloadFeatureGatesIfClusterChanged(); // ...then back to site-a, answered first
    await flush();
    answerFirst(kubevirts(['HotplugVolumes'])); // site-c's late answer
    await flush();

    expect(getFeatureGatesCluster()).toBe('site-a');
    expect(isFeatureGateEnabled('HotplugVolumes')).toBe(false);
  });
});
