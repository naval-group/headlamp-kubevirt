import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  FEATURE_GATE_CATEGORIES,
  isFeatureGateEnabledForVersion,
} from '../kubevirt/Settings/FeatureGatesSection';
import { currentCluster } from './currentCluster';

const KNOWN_FEATURE_GATES = new Map(
  Object.values(FEATURE_GATE_CATEGORIES)
    .flatMap(category => category.gates)
    .map(gate => [gate.name, gate])
);

// Global state for feature gates
let featureGates: string[] = [];
let disabledFeatureGates: string[] = [];
let kubeVirtVersion: string | null = null;
let featureGatesLoaded = false;
let listeners: Array<() => void> = [];
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 12; // ~60s total
let retryCount = 0;
/** Cluster the gates above belong to (undefined = never loaded). */
let gatesCluster: string | null | undefined = undefined;

// Fetch feature gates from KubeVirt (of the cluster currently shown)
export async function loadFeatureGates() {
  // Clear any pending retry
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  const cluster = currentCluster();
  gatesCluster = cluster;

  try {
    const response = await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts');
    // The user switched cluster while this was loading: a newer load owns the state
    if (gatesCluster !== cluster) return;
    const items = response?.items || [];
    if (items.length > 0) {
      const kubeVirt = items[0];
      const developerConfiguration = kubeVirt?.spec?.configuration?.developerConfiguration;
      featureGates = developerConfiguration?.featureGates || [];
      disabledFeatureGates = developerConfiguration?.disabledFeatureGates || [];
      kubeVirtVersion =
        kubeVirt?.status?.observedKubeVirtVersion ||
        kubeVirt?.status?.targetKubeVirtVersion ||
        null;
    }
    featureGatesLoaded = true;
    retryCount = 0;
    listeners.forEach(listener => listener());
  } catch (error) {
    if (gatesCluster !== cluster) return;
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.debug(
        `Failed to load KubeVirt feature gates (attempt ${retryCount}/${MAX_RETRIES}), retrying in 5s`
      );
      retryTimeoutId = setTimeout(loadFeatureGates, 5000);
    } else {
      console.warn(
        'Failed to load KubeVirt feature gates after max retries, showing all sidebar entries'
      );
      featureGatesLoaded = true;
      listeners.forEach(listener => listener());
    }
  }
}

/**
 * Reload the feature gates if the cluster shown changed since they were loaded.
 * Until the new cluster's gates arrive, gates read as not loaded (no version), so nothing from
 * the previous cluster is shown.
 */
export function reloadFeatureGatesIfClusterChanged(): void {
  const cluster = currentCluster();
  if (gatesCluster === cluster) return;
  featureGates = [];
  disabledFeatureGates = [];
  kubeVirtVersion = null;
  featureGatesLoaded = false;
  retryCount = 0;
  listeners.forEach(listener => listener());
  loadFeatureGates();
}

/** Cluster the current feature gates were loaded from (for tests/diagnostics). */
export function getFeatureGatesCluster(): string | null | undefined {
  return gatesCluster;
}

// Cancel any pending retry (call on plugin unload if needed)
export function cancelFeatureGateRetry() {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  retryCount = 0;
}

// Get current feature gates
export function getFeatureGates(): string[] {
  return featureGates;
}

// Check if feature gates are loaded
export function areFeatureGatesLoaded(): boolean {
  return featureGatesLoaded;
}

// Check if a specific feature gate is enabled
export function isFeatureGateEnabled(gate: string): boolean {
  const gateInfo = KNOWN_FEATURE_GATES.get(gate);

  if (!gateInfo) return featureGates.includes(gate);
  return isFeatureGateEnabledForVersion(
    gateInfo,
    kubeVirtVersion,
    featureGates,
    disabledFeatureGates
  );
}

// Subscribe to feature gate changes
export function subscribeToFeatureGates(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

// Update feature gates (used by Settings page or watcher)
export function updateFeatureGates(
  gates: string[],
  disabledGates: string[] = disabledFeatureGates,
  version: string | null = kubeVirtVersion
) {
  featureGates = gates;
  disabledFeatureGates = disabledGates;
  kubeVirtVersion = version;
  featureGatesLoaded = true;
  listeners.forEach(listener => listener());
}
