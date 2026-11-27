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

/**
 * Set when a detection request failed in a way that may go away by itself: no answer, 401 or
 * 5xx. Right after login, Headlamp can send requests before the user's token is in place and
 * they fail with 502; a feature must not be reported as missing because of that.
 * 403 and 404 are real answers (not allowed / not served).
 */
let transientFailure = false;

async function request(path: string): Promise<unknown> {
  try {
    return await ApiProxy.request(path);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === undefined || status === 401 || status >= 500) transientFailure = true;
    throw err;
  }
}

function parseSemver(v: string): KubeVirtCapabilities['semver'] {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

/** Check if an API group exists. */
async function probeApiGroup(group: string): Promise<boolean> {
  try {
    await request(`/apis/${group}`);
    return true;
  } catch {
    return false;
  }
}

// ── Detection ─────────────────────────────────────────────────────────

async function detectVersion(): Promise<string> {
  try {
    const resp = (await request('/apis/kubevirt.io/v1/kubevirts')) as {
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

type Schema = Record<string, unknown>;

/**
 * Schema of `kind` in the preferred version of `group`, from the cluster's OpenAPI v3
 * document. Discovery and /openapi/v3 are readable by every authenticated user, so this
 * works for namespace-scoped users who may not read CRDs.
 *
 * Returns null when the group or kind is not served (no further probing needed), and
 * undefined when the OpenAPI document could not be read (caller falls back to the CRD).
 */
async function fetchOpenApiSchema(group: string, kind: string): Promise<Schema | null | undefined> {
  let version: string | undefined;
  try {
    const discovery = (await request(`/apis/${group}`)) as {
      preferredVersion?: { version?: string };
    };
    version = discovery?.preferredVersion?.version;
  } catch {
    return null;
  }
  if (!version) return null;
  try {
    const doc = (await request(`/openapi/v3/apis/${group}/${version}`)) as {
      components?: { schemas?: Record<string, Schema> };
    };
    const schemas = doc?.components?.schemas;
    if (!schemas) return undefined;
    // Schema keys are '<reversed group>.<version>.<Kind>', e.g. io.kubevirt.v1.VirtualMachine
    const key = Object.keys(schemas).find(k => k.endsWith(`.${version}.${kind}`));
    return key ? schemas[key] : null;
  } catch {
    return undefined;
  }
}

/** Fetch the OpenAPI schema from the CRD itself (needs read access to CRDs). */
async function probeCrdField(crdName: string, fieldPath: string[]): Promise<boolean> {
  try {
    const resp = (await request(
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

/**
 * Probes for fields in a resource's schema. OpenAPI v3 first; the CRD only when the OpenAPI
 * document is unavailable. Schemas are fetched once per group/kind for all probes.
 */
function makeSchemaProbe() {
  const schemas = new Map<string, Promise<Schema | null | undefined>>();
  return async (crdName: string, kind: string, fieldPath: string[]): Promise<boolean> => {
    const group = crdName.slice(crdName.indexOf('.') + 1);
    const key = `${group}/${kind}`;
    if (!schemas.has(key)) schemas.set(key, fetchOpenApiSchema(group, kind));
    const schema = await schemas.get(key);
    if (schema === null) return false;
    if (schema === undefined) return probeCrdField(crdName, fieldPath);
    return hasNestedKey(schema, fieldPath);
  };
}

async function detectFeatures(): Promise<KubeVirtCapabilities['features']> {
  // Probe schemas and API groups in parallel — no noisy dry-run POSTs
  const probeSchemaField = makeSchemaProbe();
  const [containerPath, rebootPolicy, passtBinding, vmBackup, vmPool, snapshotSourceIndications] =
    await Promise.all([
      // containerPath in VM volume spec (1.8+ marker)
      probeSchemaField('virtualmachines.kubevirt.io', 'VirtualMachine', [
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
      probeSchemaField('virtualmachines.kubevirt.io', 'VirtualMachine', [
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
      probeSchemaField('virtualmachines.kubevirt.io', 'VirtualMachine', [
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
      probeSchemaField('virtualmachinesnapshots.snapshot.kubevirt.io', 'VirtualMachineSnapshot', [
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

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 12;

export async function detectKubeVirtCapabilities(attempt = 0): Promise<KubeVirtCapabilities> {
  transientFailure = false;
  const [version, features] = await Promise.all([detectVersion(), detectFeatures()]);
  if (transientFailure && attempt < MAX_RETRIES) {
    console.debug(
      `[kubevirt] Cluster API not answering yet (attempt ${attempt + 1}/${MAX_RETRIES}), ` +
        `detecting capabilities again in 5s`
    );
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return detectKubeVirtCapabilities(attempt + 1);
  }

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
