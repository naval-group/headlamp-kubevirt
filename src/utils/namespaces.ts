import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';

/**
 * Names of the namespaces to offer in namespace dropdowns.
 *
 * If allowed namespaces are set in the Headlamp cluster settings, those are
 * returned and the namespace list is not requested: users who may not list
 * namespaces set them for exactly this case, and Headlamp's own namespace
 * selector does the same.
 */
export async function fetchNamespaceNames(): Promise<string[]> {
  const allowed = K8s.cluster.getAllowedNamespaces();
  if (allowed.length > 0) {
    return [...allowed];
  }
  const response: { items?: Array<{ metadata: { name: string } }> } = await ApiProxy.request(
    '/api/v1/namespaces'
  );
  return response?.items?.map(ns => ns.metadata.name) || [];
}
