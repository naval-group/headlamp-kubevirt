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

/**
 * Metrics are treated as disabled until the cluster config is known, so pages do not show metrics
 * panels (or the "configure metrics endpoint" box) for a moment on clusters that turned them off.
 */
export function metricsHidden(loaded: boolean, data: Record<string, string> | undefined): boolean {
  return !loaded || isMetricsDisabled(data);
}

/** True when the current cluster's admins switched plugin metrics off (or the config is not read yet). */
export default function useMetricsDisabled(): boolean {
  const { loaded, data } = useClusterConfig();
  return metricsHidden(loaded, data);
}
