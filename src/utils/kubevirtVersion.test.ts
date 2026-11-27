import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { detectKubeVirtCapabilities } from './kubevirtVersion';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
}));

const request = vi.mocked(ApiProxy.request);

/** A VirtualMachine / VirtualMachineSnapshot schema with every probed field. */
const VM_SCHEMA = {
  properties: {
    spec: {
      properties: {
        template: {
          properties: {
            spec: {
              properties: {
                volumes: { items: { properties: { containerPath: {} } } },
                domain: {
                  properties: {
                    rebootPolicy: {},
                    devices: {
                      properties: { interfaces: { items: { properties: { passtBinding: {} } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const SNAPSHOT_SCHEMA = { properties: { status: { properties: { sourceIndications: {} } } } };

const httpError = (status: number, text: string) =>
  Promise.reject(Object.assign(new Error(`${status} ${text}`), { status }));
const forbidden = () => httpError(403, 'Forbidden');
const notFound = () => httpError(404, 'Not Found');
const badGateway = () => httpError(502, 'Bad Gateway');

/** Answers requests by path; anything not listed is a 404. */
function serve(routes: Record<string, () => Promise<unknown>>) {
  request.mockImplementation(((path: string) =>
    (routes[path] ?? notFound)()) as unknown as typeof ApiProxy.request);
}

const discovery = (version: string) => () =>
  Promise.resolve({ preferredVersion: { groupVersion: `x/${version}`, version } });

const KUBEVIRTS = () =>
  Promise.resolve({ items: [{ status: { observedKubeVirtVersion: 'v1.9.1' } }] });

describe('detectKubeVirtCapabilities', () => {
  afterEach(() => request.mockReset());

  it('detects features from OpenAPI v3 when CRDs are not readable (namespace-scoped user)', async () => {
    serve({
      '/apis/kubevirt.io/v1/kubevirts': KUBEVIRTS,
      '/apis/kubevirt.io': discovery('v1'),
      '/apis/snapshot.kubevirt.io': discovery('v1beta1'),
      '/apis/pool.kubevirt.io': discovery('v1beta1'),
      '/openapi/v3/apis/kubevirt.io/v1': () =>
        Promise.resolve({
          components: { schemas: { 'io.kubevirt.v1.VirtualMachine': VM_SCHEMA } },
        }),
      '/openapi/v3/apis/snapshot.kubevirt.io/v1beta1': () =>
        Promise.resolve({
          components: {
            schemas: { 'io.kubevirt.snapshot.v1beta1.VirtualMachineSnapshot': SNAPSHOT_SCHEMA },
          },
        }),
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/virtualmachines.kubevirt.io':
        forbidden,
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/virtualmachinesnapshots.snapshot.kubevirt.io':
        forbidden,
    });

    const caps = await detectKubeVirtCapabilities();

    expect(caps.features).toEqual({
      containerPath: true,
      rebootPolicy: true,
      passtBinding: true,
      vmBackup: false,
      vmPool: true,
      snapshotSourceIndications: true,
    });
    expect(caps.level).toBe('1.8+');
    // One OpenAPI document per group, shared by the three VirtualMachine probes
    expect(
      request.mock.calls.filter(([p]) => p === '/openapi/v3/apis/kubevirt.io/v1')
    ).toHaveLength(1);
    expect(request.mock.calls.some(([p]) => String(p).includes('customresourcedefinitions'))).toBe(
      false
    );
  });

  it('reports a field missing from the OpenAPI schema as absent', async () => {
    serve({
      '/apis/kubevirt.io': discovery('v1'),
      '/openapi/v3/apis/kubevirt.io/v1': () =>
        Promise.resolve({ components: { schemas: { 'io.kubevirt.v1.VirtualMachine': {} } } }),
    });

    const caps = await detectKubeVirtCapabilities();

    expect(caps.features.containerPath).toBe(false);
    expect(caps.features.rebootPolicy).toBe(false);
  });

  it('falls back to the CRD when the OpenAPI document is not available', async () => {
    serve({
      '/apis/kubevirt.io': discovery('v1'),
      '/openapi/v3/apis/kubevirt.io/v1': notFound,
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/virtualmachines.kubevirt.io': () =>
        Promise.resolve({
          spec: { versions: [{ name: 'v1', schema: { openAPIV3Schema: VM_SCHEMA } }] },
        }),
    });

    const caps = await detectKubeVirtCapabilities();

    expect(caps.features.containerPath).toBe(true);
    expect(caps.features.passtBinding).toBe(true);
  });

  it('waits while the cluster API is not answering yet (login race), then detects', async () => {
    vi.useFakeTimers();
    try {
      const openApi = () =>
        Promise.resolve({
          components: { schemas: { 'io.kubevirt.v1.VirtualMachine': VM_SCHEMA } },
        });
      serve({ '/apis/kubevirt.io': badGateway, '/openapi/v3/apis/kubevirt.io/v1': badGateway });

      const pending = detectKubeVirtCapabilities();
      await vi.advanceTimersByTimeAsync(0);
      // The token is in place now: the cluster answers
      serve({ '/apis/kubevirt.io': discovery('v1'), '/openapi/v3/apis/kubevirt.io/v1': openApi });
      await vi.advanceTimersByTimeAsync(5000);
      const caps = await pending;

      expect(caps.features.containerPath).toBe(true);
      expect(caps.level).toBe('1.8+');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries when only some requests fail (502 on the OpenAPI document)', async () => {
    vi.useFakeTimers();
    try {
      const openApi = () =>
        Promise.resolve({
          components: { schemas: { 'io.kubevirt.v1.VirtualMachine': VM_SCHEMA } },
        });
      serve({
        '/apis/kubevirt.io': discovery('v1'),
        '/openapi/v3/apis/kubevirt.io/v1': badGateway,
      });

      const pending = detectKubeVirtCapabilities();
      await vi.advanceTimersByTimeAsync(0);
      serve({ '/apis/kubevirt.io': discovery('v1'), '/openapi/v3/apis/kubevirt.io/v1': openApi });
      await vi.advanceTimersByTimeAsync(5000);
      const caps = await pending;

      expect(caps.features.containerPath).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait when KubeVirt is not installed (404)', async () => {
    serve({});

    const caps = await detectKubeVirtCapabilities();

    expect(caps.features.containerPath).toBe(false);
    expect(caps.level).toBe('unknown');
  });

  it('does not read the CRD of an API group the cluster does not serve', async () => {
    serve({
      '/apis/kubevirt.io': discovery('v1'),
      '/openapi/v3/apis/kubevirt.io/v1': () =>
        Promise.resolve({
          components: { schemas: { 'io.kubevirt.v1.VirtualMachine': VM_SCHEMA } },
        }),
    });

    const caps = await detectKubeVirtCapabilities();

    expect(caps.features.snapshotSourceIndications).toBe(false);
    expect(
      request.mock.calls.some(([p]) =>
        String(p).includes('customresourcedefinitions/virtualmachinesnapshots')
      )
    ).toBe(false);
  });
});
