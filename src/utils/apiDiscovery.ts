import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

/**
 * Whether the cluster serves `resource` in `groupVersion` (e.g. 'k8s.cni.cncf.io/v1',
 * 'network-attachment-definitions').
 *
 * Uses API discovery, which every authenticated user may read (system:discovery), so the
 * answer does not depend on the user's RBAC, unlike reading the CRD, which needs
 * cluster-scoped access to customresourcedefinitions.
 */
export async function isApiResourceServed(
  groupVersion: string,
  resource: string
): Promise<boolean> {
  try {
    const list = (await ApiProxy.request(`/apis/${groupVersion}`)) as {
      resources?: Array<{ name?: string }>;
    };
    return !!list?.resources?.some(r => r.name === resource);
  } catch {
    return false;
  }
}
