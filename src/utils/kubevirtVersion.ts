import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

// ── Types ─────────────────────────────────────────────────────────────

export interface KubeVirtCapabilities {
  /** Version string from status.observedKubeVirtVersion (may be SHA on OpenShift) */
  version: string;
  /** Parsed semver if version is semver, null otherwise */
  semver: { major: number; minor: number; patch: number } | null;
  /** Detected capability level based on CRD field probing */
  level: '1.8+' | '1.7' | 'unknown';
  /** Individual feature probes */
  features: {
    containerPath: boolean;
    rebootPolicy: boolean;
    passtBinding: boolean;
    vmBackup: boolean;
    vmPool: boolean;
    snapshotSourceIndications: boolean;
  };
  /** Whether detection has completed */
  resolved: boolean;
}

// ── Module-level cache ────────────────────────────────────────────────

let cached: KubeVirtCapabilities = {
  version: '',
  semver: null,
  level: 'unknown',
  features: {
    containerPath: false,
    rebootPolicy: false,
    passtBinding: false,
    vmBackup: false,
    vmPool: false,
    snapshotSourceIndications: false,
  },
  resolved: false,
};

const listeners: Array<() => void> = [];

function notify() {
  listeners.forEach(fn => fn());
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseSemver(v: string): KubeVirtCapabilities['semver'] {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

/** Check if an API group exists. */
async function probeApiGroup(group: string): Promise<boolean> {
  try {
    await ApiProxy.request(`/apis/${group}`);
    return true;
  } catch {
    return false;
  }
}

// ── Detection ─────────────────────────────────────────────────────────

async function detectVersion(): Promise<string> {
  try {
    const resp = (await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts')) as {
      items?: Array<{ status?: { observedKubeVirtVersion?: string } }>;
    };
    return resp?.items?.[0]?.status?.observedKubeVirtVersion || '';
  } catch {
    return '';
  }
}

/** Walk a nested object by dot-separated path. */
function hasNestedKey(obj: unknown, path: string[]): boolean {
  let current = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return false;
    }
  }
  return true;
}

/** Fetch the OpenAPI schema for a CRD and check if a field path exists. */
async function probeCrdField(crdName: string, fieldPath: string[]): Promise<boolean> {
  try {
    const resp = (await ApiProxy.request(
      `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crdName}`
    )) as {
      spec?: {
        versions?: Array<{
          name: string;
          schema?: { openAPIV3Schema?: Record<string, unknown> };
        }>;
      };
    };
    // Check the served version (v1 preferred, fall back to first)
    const versions = resp?.spec?.versions || [];
    const v1Version = versions.find(v => v.name === 'v1') || versions[0];
    const schema = v1Version?.schema?.openAPIV3Schema;
    if (!schema) return false;
    return hasNestedKey(schema, fieldPath);
  } catch {
    return false;
  }
}

async function detectFeatures(): Promise<KubeVirtCapabilities['features']> {
  // Probe CRD schemas and API groups in parallel — no noisy dry-run POSTs
  const [containerPath, rebootPolicy, passtBinding, vmBackup, vmPool, snapshotSourceIndications] =
    await Promise.all([
      // containerPath in VM volume spec (1.8+ marker)
      probeCrdField('virtualmachines.kubevirt.io', [
        'properties',
        'spec',
        'properties',
        'template',
        'properties',
        'spec',
        'properties',
        'volumes',
        'items',
        'properties',
        'containerPath',
      ]),

      // rebootPolicy in VMI domain spec
      probeCrdField('virtualmachines.kubevirt.io', [
        'properties',
        'spec',
        'properties',
        'template',
        'properties',
        'spec',
        'properties',
        'domain',
        'properties',
        'rebootPolicy',
      ]),

      // passtBinding in VMI interface spec
      probeCrdField('virtualmachines.kubevirt.io', [
        'properties',
        'spec',
        'properties',
        'template',
        'properties',
        'spec',
        'properties',
        'domain',
        'properties',
        'devices',
        'properties',
        'interfaces',
        'items',
        'properties',
        'passtBinding',
      ]),

      // API group probes
      probeApiGroup('backup.kubevirt.io'),
      probeApiGroup('pool.kubevirt.io'),

      // Snapshot source indications in VirtualMachineSnapshot CRD schema
      probeCrdField('virtualmachinesnapshots.snapshot.kubevirt.io', [
        'properties',
        'status',
        'properties',
        'sourceIndications',
      ]),
    ]);

  return {
    containerPath,
    rebootPolicy,
    passtBinding,
    vmBackup,
    vmPool,
    snapshotSourceIndications,
  };
}

// ── Public API ────────────────────────────────────────────────────────

export async function detectKubeVirtCapabilities(): Promise<KubeVirtCapabilities> {
  const [version, features] = await Promise.all([detectVersion(), detectFeatures()]);

  const semver = parseSemver(version);

  // Determine level: if containerPath field exists, it's 1.8+
  // Otherwise use semver if available
  let level: KubeVirtCapabilities['level'] = 'unknown';
  if (features.containerPath) {
    level = '1.8+';
  } else if (semver) {
    if (semver.major >= 1 && semver.minor >= 8) {
      level = '1.8+';
    } else if (semver.major >= 1 && semver.minor === 7) {
      level = '1.7';
    }
  }

  cached = { version, semver, level, features, resolved: true };
  console.debug('[kubevirt] Detected capabilities:', {
    version,
    level,
    features,
  });
  notify();
  return cached;
}

/** Get cached capabilities (may not be resolved yet). */
export function getKubeVirtCapabilities(): KubeVirtCapabilities {
  return cached;
}

/** Check if capabilities have been resolved. */
export function areCapabilitiesResolved(): boolean {
  return cached.resolved;
}

/** Subscribe to capability changes. Returns unsubscribe function. */
export function subscribeToCapabilities(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Convenience: is the cluster running KubeVirt 1.8+? */
export function isKubeVirt18OrNewer(): boolean {
  return cached.level === '1.8+';
}

/** Convenience: check a specific feature. */
export function hasFeature(feature: keyof KubeVirtCapabilities['features']): boolean {
  return cached.features[feature];
}
