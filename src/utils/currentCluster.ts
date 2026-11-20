import { Utils } from '@kinvolk/headlamp-plugin/lib';

/**
 * Name of the cluster currently shown in Headlamp (from the URL), or null outside a cluster.
 * Module-level caches of cluster data (feature gates, capabilities, CRD checks) must be keyed on
 * this: Headlamp can switch between clusters without reloading the plugin.
 */
export function currentCluster(): string | null {
  try {
    return Utils?.getCluster?.() ?? null;
  } catch {
    return null;
  }
}
