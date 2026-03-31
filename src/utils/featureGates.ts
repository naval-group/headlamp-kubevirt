import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

// Global state for feature gates
let featureGates: string[] = [];
let featureGatesLoaded = false;
let listeners: Array<() => void> = [];
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 12; // ~60s total
let retryCount = 0;

// Fetch feature gates from KubeVirt
export async function loadFeatureGates() {
  // Clear any pending retry
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }

  try {
    const response = await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts');
    const items = response?.items || [];
    if (items.length > 0) {
      featureGates = items[0]?.spec?.configuration?.developerConfiguration?.featureGates || [];
    }
    featureGatesLoaded = true;
    retryCount = 0;
    listeners.forEach(listener => listener());
  } catch (error) {
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
  return featureGates.includes(gate);
}

// Subscribe to feature gate changes
export function subscribeToFeatureGates(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

// Update feature gates (used by Settings page or watcher)
export function updateFeatureGates(gates: string[]) {
  featureGates = gates;
  featureGatesLoaded = true;
  listeners.forEach(listener => listener());
}
