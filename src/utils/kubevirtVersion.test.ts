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

const forbidden = () => Promise.reject(new Error('403 Forbidden'));
const notFound = () => Promise.reject(new Error('404 Not Found'));

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
