import { useEffect, useState } from 'react';
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../utils/featureGates';

/**
 * Hook that subscribes to a KubeVirt feature gate and returns whether it's enabled.
 * Automatically updates when feature gates change (e.g. via Settings page).
 */
export default function useFeatureGate(gate: string): boolean {
  const [enabled, setEnabled] = useState(() => isFeatureGateEnabled(gate));

  useEffect(() => {
    setEnabled(isFeatureGateEnabled(gate));
    return subscribeToFeatureGates(() => setEnabled(isFeatureGateEnabled(gate)));
  }, [gate]);

  return enabled;
}
