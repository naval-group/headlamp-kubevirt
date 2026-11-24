import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { isApiResourceServed } from './apiDiscovery';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
}));

const request = vi.mocked(ApiProxy.request);

describe('isApiResourceServed', () => {
  afterEach(() => request.mockReset());

  it('is true when discovery lists the resource', async () => {
    request.mockResolvedValue({
      resources: [{ name: 'network-attachment-definitions' }],
    });
    await expect(
      isApiResourceServed('k8s.cni.cncf.io/v1', 'network-attachment-definitions')
    ).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('/apis/k8s.cni.cncf.io/v1');
  });

  it('is false when the group version does not list it', async () => {
    request.mockResolvedValue({ resources: [{ name: 'ipamclaims' }] });
    await expect(
      isApiResourceServed('k8s.cni.cncf.io/v1', 'network-attachment-definitions')
    ).resolves.toBe(false);
  });

  it('is false when the group version is not served', async () => {
    request.mockRejectedValue(new Error('404 page not found'));
    await expect(
      isApiResourceServed('k8s.cni.cncf.io/v1', 'network-attachment-definitions')
    ).resolves.toBe(false);
  });
});
