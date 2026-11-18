import { useClusterConfig } from './clusterConfig';

/**
 * Cluster-wide switch (ConfigMap headlamp-kubevirt-config, key metricsDisabled: "true") that hides
 * all plugin metrics on that cluster: VM metrics, Overview top consumers, VM Doctor metrics and
 * querier, system health and the metrics endpoint settings. Set by cluster admins, per cluster.
 */
export const METRICS_DISABLED_KEY = 'metricsDisabled';

export function isMetricsDisabled(data: Record<string, string> | undefined): boolean {
  return (data?.[METRICS_DISABLED_KEY] || '').trim().toLowerCase() === 'true';
}

/** True when the current cluster's admins switched plugin metrics off. */
export default function useMetricsDisabled(): boolean {
  const { data } = useClusterConfig();
  return isMetricsDisabled(data);
}
