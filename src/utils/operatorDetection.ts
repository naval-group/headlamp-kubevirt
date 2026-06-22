/**
 * Detect installed KubeVirt ecosystem operators via API probes.
 * Follows the same cache + subscriber pattern as kubevirtVersion.ts.
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import yaml from 'js-yaml';
import { useEffect, useState } from 'react';
import OPERATORS, { OperatorInfo } from './operatorRegistry';

export type OperatorStatus = 'installed' | 'available' | 'requires-deps' | 'checking';

export interface OperatorState {
  status: OperatorStatus;
  version?: string;
  namespace?: string;
}

export interface OperatorDetectionResult {
  operators: Record<string, OperatorState>;
  resolved: boolean;
  loading: boolean;
}

type Listener = (result: OperatorDetectionResult) => void;

// ── Module-level cache ──────────────────────────────────────────────

let cached: OperatorDetectionResult = {
  operators: {},
  resolved: false,
  loading: false,
};

const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) {
    fn(cached);
  }
}

// ── API probe helpers ───────────────────────────────────────────────

async function crdExists(name: string): Promise<boolean> {
  try {
    await ApiProxy.request(
      `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${encodeURIComponent(name)}`
    );
    return true;
  } catch {
    return false;
  }
}

async function namespaceExists(name: string): Promise<boolean> {
  try {
    await ApiProxy.request(`/api/v1/namespaces/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

async function deploymentExists(name: string, namespace: string): Promise<boolean> {
  try {
    await ApiProxy.request(
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(
        name
      )}`
    );
    return true;
  } catch {
    return false;
  }
}

async function daemonSetExists(name: string, namespace: string): Promise<boolean> {
  try {
    await ApiProxy.request(
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/daemonsets/${encodeURIComponent(
        name
      )}`
    );
    return true;
  } catch {
    return false;
  }
}

async function apiPathExists(path: string): Promise<boolean> {
  try {
    await ApiProxy.request(path);
    return true;
  } catch {
    return false;
  }
}

/** Probe a single operator using its detection strategy */
async function probeOperator(op: OperatorInfo): Promise<boolean> {
  const d = op.detection;
  const checks: Promise<boolean>[] = [];

  if (d.crd) checks.push(crdExists(d.crd));
  if (d.altCrds) d.altCrds.forEach(c => checks.push(crdExists(c)));
  if (d.namespace) checks.push(namespaceExists(d.namespace));
  if (d.deployment) checks.push(deploymentExists(d.deployment.name, d.deployment.namespace));
  if (d.daemonSet) checks.push(daemonSetExists(d.daemonSet.name, d.daemonSet.namespace));
  if (d.altDaemonSets)
    d.altDaemonSets.forEach(ds => checks.push(daemonSetExists(ds.name, ds.namespace)));
  if (d.apiPath) checks.push(apiPathExists(d.apiPath));

  if (checks.length === 0) return false;

  // Operator is considered installed if ANY check passes
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

// ── Uninstall protection ────────────────────────────────────────────

export interface ProtectionCheckResult {
  label: string;
  count: number;
}

/** Count active resources that would block uninstall */
export async function checkUninstallProtection(
  operatorId: string
): Promise<ProtectionCheckResult[]> {
  const op = OPERATORS.find(o => o.id === operatorId);
  if (!op?.uninstallProtection) return [];

  const results: ProtectionCheckResult[] = [];

  for (const check of op.uninstallProtection) {
    try {
      const resp = (await ApiProxy.request(check.apiPath)) as { items?: unknown[] };
      const count = resp?.items?.length ?? 0;
      if (count > 0) {
        results.push({ label: check.label, count });
      }
    } catch {
      // API not available = no resources = safe to uninstall
    }
  }

  return results;
}

/** Check if an operator can be safely uninstalled */
export async function canUninstall(
  operatorId: string
): Promise<{ allowed: boolean; blockers: ProtectionCheckResult[] }> {
  // Check if other installed operators depend on this one
  const dependents = OPERATORS.filter(
    op => op.dependencies.includes(operatorId) && cached.operators[op.id]?.status === 'installed'
  );

  if (dependents.length > 0) {
    return {
      allowed: false,
      blockers: dependents.map(d => ({ label: `${d.name} (depends on this)`, count: 1 })),
    };
  }

  const resourceBlockers = await checkUninstallProtection(operatorId);
  return {
    allowed: resourceBlockers.length === 0,
    blockers: resourceBlockers,
  };
}

// ── Public API ──────────────────────────────────────────────────────

/** Run detection for all operators. Results are cached and subscribers notified. */
export async function detectInstalledOperators(): Promise<OperatorDetectionResult> {
  cached = { ...cached, loading: true };
  notify();

  const operators: Record<string, OperatorState> = {};

  // Probe all operators in parallel
  const probes = OPERATORS.map(async op => {
    const installed = await probeOperator(op);
    operators[op.id] = {
      status: installed ? 'installed' : 'available',
      namespace: op.detection.namespace,
    };
  });

  await Promise.all(probes);

  // Mark operators whose dependencies aren't installed as 'requires-deps'
  for (const op of OPERATORS) {
    if (operators[op.id].status === 'available' && op.dependencies.length > 0) {
      const missingDeps = op.dependencies.some(dep => operators[dep]?.status !== 'installed');
      if (missingDeps) {
        operators[op.id].status = 'requires-deps';
      }
    }
  }

  cached = { operators, resolved: true, loading: false };
  notify();
  return cached;
}

/** Get cached detection result */
export function getOperatorDetectionResult(): OperatorDetectionResult {
  return cached;
}

/** Get status of a single operator */
export function getOperatorStatus(id: string): OperatorState {
  return cached.operators[id] ?? { status: 'checking' };
}

/** Check if KubeVirt is installed (convenience) */
export function isKubeVirtInstalled(): boolean {
  return cached.operators['kubevirt']?.status === 'installed';
}

/** Subscribe to detection changes */
export function subscribeToOperatorDetection(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook for operator detection state — subscribes to changes and triggers detection if needed */
export function useOperatorDetection(): OperatorDetectionResult {
  const [state, setState] = useState<OperatorDetectionResult>(cached);

  useEffect(() => {
    // Subscribe to detection changes
    const unsubscribe = subscribeToOperatorDetection(setState);

    // Trigger detection if not already resolved
    if (!cached.resolved && !cached.loading) {
      detectInstalledOperators();
    } else {
      // Sync with latest cache in case detection completed before mount
      setState(cached);
    }

    return unsubscribe;
  }, []);

  return state;
}

// ── Stack info detection ──────────────────────────────────────────

export interface StackInfo {
  /** Whether the kubevirt-stack chart was detected */
  managed: boolean;
  /** Chart version */
  chartVersion?: string;
  /** KubeVirt app version */
  appVersion?: string;
  /** Namespace where the stack info was found */
  namespace?: string;
  /** Operator enabled states from the chart */
  operators?: Record<string, boolean>;
}

export interface StackValues {
  /** Raw values.yaml content from the Secret */
  raw?: string;
  /** Parsed values object */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed?: Record<string, any>;
}

let cachedStackInfo: StackInfo = { managed: false };
let cachedStackValues: StackValues = {};

/** Detect if kubevirt-stack chart is installed by looking for the info ConfigMap */
export async function detectStackInfo(): Promise<StackInfo> {
  try {
    // Search all namespaces for the ConfigMap with our label
    const resp = (await ApiProxy.request(
      '/api/v1/configmaps?labelSelector=kubevirt-stack/info=true'
    )) as {
      items?: Array<{
        metadata: { namespace: string; annotations?: Record<string, string> };
        data?: Record<string, string>;
      }>;
    };

    const cm = resp?.items?.[0];
    if (!cm) {
      cachedStackInfo = { managed: false };
      return cachedStackInfo;
    }

    // Parse the operators field (simple key: value YAML)
    const operators: Record<string, boolean> = {};
    const opLines = (cm.data?.operators || '').split('\n');
    for (const line of opLines) {
      const match = line.match(/^\s*([^:]+):\s*(true|false)\s*$/);
      if (match) operators[match[1].trim()] = match[2] === 'true';
    }

    cachedStackInfo = {
      managed: true,
      chartVersion: cm.data?.chartVersion,
      appVersion: cm.data?.appVersion,
      namespace: cm.metadata.namespace,
      operators,
    };
    return cachedStackInfo;
  } catch {
    cachedStackInfo = { managed: false };
    return cachedStackInfo;
  }
}

/** Read the last-applied values from the Secret */
export async function readStackValues(): Promise<StackValues> {
  if (!cachedStackInfo.managed || !cachedStackInfo.namespace) {
    cachedStackValues = {};
    return cachedStackValues;
  }

  try {
    const resp = (await ApiProxy.request(
      `/api/v1/namespaces/${cachedStackInfo.namespace}/secrets/kubevirt-stack-values`
    )) as { data?: Record<string, string> };

    const raw = resp?.data?.['values.yaml'];
    if (!raw) {
      cachedStackValues = {};
      return cachedStackValues;
    }

    // Secret data is base64-encoded — decode with proper UTF-8 support
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0)));
    try {
      cachedStackValues = {
        raw: decoded,
        parsed: yaml.load(decoded) as Record<string, unknown>,
      };
    } catch {
      cachedStackValues = { raw: decoded };
    }
    return cachedStackValues;
  } catch {
    cachedStackValues = {};
    return cachedStackValues;
  }
}

/** Get cached stack info */
export function getStackInfo(): StackInfo {
  return cachedStackInfo;
}

/** Get cached stack values */
export function getStackValues(): StackValues {
  return cachedStackValues;
}
