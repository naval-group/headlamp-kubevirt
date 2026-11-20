import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useState } from 'react';

/**
 * Cluster-wide plugin configuration.
 *
 * Headlamp plugin settings are stored per browser, so anything that must be the same for every
 * user of a cluster lives in a ConfigMap in that cluster instead. Each cluster has its own
 * ConfigMap, so values can differ per cluster.
 *
 * The ConfigMap is read with a single GET in the namespace KubeVirt is installed in (taken from the
 * KubeVirt CR, which every authenticated user can read via the kubevirt.io:default ClusterRole).
 * Users only need `get` on this one ConfigMap, not cluster-wide ConfigMap list access.
 */

export const CLUSTER_CONFIG_NAME = 'headlamp-kubevirt-config';
export const DEFAULT_KUBEVIRT_NAMESPACE = 'kubevirt';

/** Comma-separated namespaces whose NADs may be used by VMs in any namespace. */
export const SHARED_NAD_NAMESPACES_KEY = 'sharedNadNamespaces';

export type ClusterConfigData = Record<string, string>;

export interface ClusterConfigState {
  data: ClusterConfigData;
  namespace: string;
  loaded: boolean;
  /** Set when the ConfigMap could not be read for a reason other than "not found". */
  error: string | null;
}

const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Parse a comma/space separated namespace list: trimmed, de-duplicated, invalid names dropped. */
export function parseNamespaceList(value: string | undefined | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(/[\s,]+/)) {
    const ns = part.trim();
    if (ns && ns.length <= 63 && DNS1123_LABEL.test(ns)) seen.add(ns);
  }
  return Array.from(seen);
}

function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

/** Namespace KubeVirt is installed in, falling back to "kubevirt". */
export async function getKubeVirtNamespace(): Promise<string> {
  try {
    const resp = (await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts')) as {
      items?: Array<{ metadata?: { namespace?: string } }>;
    };
    return resp?.items?.[0]?.metadata?.namespace || DEFAULT_KUBEVIRT_NAMESPACE;
  } catch {
    return DEFAULT_KUBEVIRT_NAMESPACE;
  }
}

function configMapPath(namespace: string): string {
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${CLUSTER_CONFIG_NAME}`;
}

/** Read the cluster-wide plugin config. A missing ConfigMap is not an error (empty config). */
export async function readClusterConfig(): Promise<Omit<ClusterConfigState, 'loaded'>> {
  const namespace = await getKubeVirtNamespace();
  try {
    const cm = (await ApiProxy.request(configMapPath(namespace))) as {
      data?: ClusterConfigData;
    };
    return { data: cm?.data || {}, namespace, error: null };
  } catch (err) {
    if (errorStatus(err) === 404) return { data: {}, namespace, error: null };
    return {
      data: {},
      namespace,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Merge keys into the cluster-wide plugin config (creates the ConfigMap if needed).
 * A key set to an empty string is removed.
 */
export async function saveClusterConfig(
  namespace: string,
  updates: ClusterConfigData
): Promise<void> {
  const path = configMapPath(namespace);
  let existing: { data?: ClusterConfigData } | null = null;
  try {
    existing = (await ApiProxy.request(path)) as { data?: ClusterConfigData };
  } catch (err) {
    if (errorStatus(err) !== 404) throw err;
  }

  if (existing) {
    // JSON merge patch: null removes a key
    const data: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(updates)) data[k] = v === '' ? null : v;
    await ApiProxy.patch(path, { data }); // merge patch
    return;
  }

  const data: ClusterConfigData = {};
  for (const [k, v] of Object.entries(updates)) if (v !== '') data[k] = v;
  await ApiProxy.post(`/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`, {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: CLUSTER_CONFIG_NAME, namespace },
    data,
  });
}

/**
 * Last config read per cluster, kept for the browser session. A page that mounts again (e.g. going
 * back to the Overview) starts from it instead of an empty config, so settings such as
 * metricsDisabled do not flicker; the hook still re-reads the ConfigMap in the background.
 */
const configCache = new Map<string, Omit<ClusterConfigState, 'loaded'>>();

/** For tests. */
export function clearClusterConfigCache(): void {
  configCache.clear();
}

/** Initial hook state for a cluster: the cached config (loaded) or an empty, not-loaded one. */
export function initialClusterConfigState(cluster: string | null | undefined): ClusterConfigState {
  const cached = configCache.get(cluster || '');
  if (cached) return { ...cached, loaded: true };
  return { data: {}, namespace: DEFAULT_KUBEVIRT_NAMESPACE, loaded: false, error: null };
}

/** React hook: the cluster-wide plugin config of the current cluster, plus a reload function. */
export function useClusterConfig(): ClusterConfigState & { reload: () => void } {
  // Each cluster has its own ConfigMap: reload when the user switches cluster
  const cluster = K8s.useCluster();
  const [state, setState] = useState<ClusterConfigState>(() => initialClusterConfigState(cluster));
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const key = cluster || '';
    // Known cluster: keep showing its cached config while refreshing; unknown: start empty
    setState(initialClusterConfigState(key));
    readClusterConfig().then(result => {
      if (cancelled) return;
      if (!result.error) configCache.set(key, result);
      setState({ ...result, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [generation, cluster]);

  const reload = useCallback(() => setGeneration(g => g + 1), []);
  return { ...state, reload };
}
