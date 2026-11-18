import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let cluster: string | null = 'site-a';
vi.mock('./currentCluster', () => ({ currentCluster: () => cluster }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));

import { detectIPAMCRD, isIPAMCRDAvailable } from './ipamCrd';

const request = ApiProxy.request as unknown as ReturnType<typeof vi.fn>;
const group = (versions: string[]) => ({ versions: versions.map(v => ({ groupVersion: v })) });

describe('detectIPAMCRD', () => {
  beforeEach(() => request.mockReset());

  it('is false without probing ipamclaims when only NADs (v1) exist', async () => {
    cluster = 'site-a';
    request.mockResolvedValueOnce(group(['k8s.cni.cncf.io/v1']));
    expect(await detectIPAMCRD(true)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/apis/k8s.cni.cncf.io');
  });

  it('is true when v1alpha1 serves ipamclaims, and re-checks per cluster', async () => {
    cluster = 'site-b';
    request
      .mockResolvedValueOnce(group(['k8s.cni.cncf.io/v1', 'k8s.cni.cncf.io/v1alpha1']))
      .mockResolvedValueOnce({ resources: [{ name: 'ipamclaims' }] });
    expect(await detectIPAMCRD()).toBe(true);
    expect(isIPAMCRDAvailable()).toBe(true);

    request.mockClear();
    expect(await detectIPAMCRD()).toBe(true); // same cluster: cached
    expect(request).not.toHaveBeenCalled();

    cluster = 'site-c';
    request.mockRejectedValueOnce({ status: 404 }); // no multus at all
    expect(await detectIPAMCRD()).toBe(false);
  });
});
