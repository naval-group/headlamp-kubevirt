import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNamespaceNames } from './namespaces';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: vi.fn(),
  },
  K8s: {
    cluster: {
      getAllowedNamespaces: vi.fn(),
    },
  },
}));

const getAllowedNamespaces = vi.mocked(K8s.cluster.getAllowedNamespaces);

describe('fetchNamespaceNames', () => {
  beforeEach(() => {
    vi.mocked(ApiProxy.request).mockReset();
    getAllowedNamespaces.mockReset();
  });

  it('uses the allowed namespaces from the cluster settings without listing namespaces', async () => {
    getAllowedNamespaces.mockReturnValue(['team-a', 'team-b']);

    await expect(fetchNamespaceNames()).resolves.toEqual(['team-a', 'team-b']);
    expect(ApiProxy.request).not.toHaveBeenCalled();
  });

  it('lists the namespaces when no allowed namespaces are set', async () => {
    getAllowedNamespaces.mockReturnValue([]);
    vi.mocked(ApiProxy.request).mockResolvedValue({
      items: [{ metadata: { name: 'default' } }, { metadata: { name: 'kubevirt' } }],
    });

    await expect(fetchNamespaceNames()).resolves.toEqual(['default', 'kubevirt']);
    expect(ApiProxy.request).toHaveBeenCalledWith('/api/v1/namespaces');
  });

  it('returns an empty list when the response has no items', async () => {
    getAllowedNamespaces.mockReturnValue([]);
    vi.mocked(ApiProxy.request).mockResolvedValue({});

    await expect(fetchNamespaceNames()).resolves.toEqual([]);
  });
});
