import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { currentCluster } from './currentCluster';

/**
 * Whether the IPAMClaim CRD (k8s.cni.cncf.io/v1alpha1 ipamclaims) is installed on the cluster
 * shown. Uses API discovery, so a cluster without it produces no 404s, and nothing lists or
 * watches IPAMClaims there.
 */

let available = false;
let checkedCluster: string | null | undefined = undefined;
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach(l => l());
}

async function discover(): Promise<boolean> {
  const group = (await ApiProxy.request('/apis/k8s.cni.cncf.io')) as {
    versions?: Array<{ groupVersion?: string }>;
  };
  if (!group?.versions?.some(v => v.groupVersion === 'k8s.cni.cncf.io/v1alpha1')) return false;
  const resources = (await ApiProxy.request('/apis/k8s.cni.cncf.io/v1alpha1')) as {
    resources?: Array<{ name?: string }>;
  };
  return !!resources?.resources?.some(r => r.name === 'ipamclaims');
}

/** Check the cluster shown (again if it changed since the last check). */
export async function detectIPAMCRD(force = false): Promise<boolean> {
  const cluster = currentCluster();
  if (!force && checkedCluster === cluster) return available;
  checkedCluster = cluster;
  if (available) {
    available = false;
    notify();
  }
  let result = false;
  try {
    result = await discover();
  } catch {
    result = false;
  }
  // Ignore the answer if the user switched cluster meanwhile
  if (checkedCluster === cluster && result !== available) {
    available = result;
    notify();
  }
  return available;
}

export function isIPAMCRDAvailable(): boolean {
  return available;
}

export function subscribeToIPAMCRD(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

/** React hook: true once the IPAMClaim CRD is known to exist on the cluster shown. */
export function useIPAMCRDAvailable(): boolean {
  const [value, setValue] = useState(available);
  useEffect(() => {
    setValue(available);
    return subscribeToIPAMCRD(() => setValue(available));
  }, []);
  return value;
}
