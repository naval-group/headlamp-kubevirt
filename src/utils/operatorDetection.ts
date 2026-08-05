/**
 * Detect installed KubeVirt ecosystem operators via API probes.
 * Follows the same cache + subscriber pattern as kubevirtVersion.ts.
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import yaml from 'js-yaml';
import { useEffect, useState } from 'react';
import OPERATORS, { getChartName, OperatorInfo } from './operatorRegistry';

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
//
// Each chart creates:
//   ConfigMap: kubevirt-stack-info-<chartName>  (label: kubevirt-stack/info=true)
//   Secret:   kubevirt-stack-values-<chartName>
//
// Discovery: labelSelector=kubevirt-stack/info=true on ConfigMaps

export type InstallMethod = 'flux' | 'argocd' | 'rancher' | 'helm-cli' | 'unknown';

export interface ChartInfo {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  namespace: string;
  installMethod?: InstallMethod;
}

export interface StackInfo {
  /** Whether any kubevirt-stack chart was detected */
  managed: boolean;
  /** Namespace where the charts are installed */
  namespace?: string;
  /** Per-chart info from ConfigMaps */
  charts: Record<string, ChartInfo>;
  /** Legacy: operator enabled states (derived from charts presence) */
  operators?: Record<string, boolean>;
  /** Legacy compat */
  chartVersion?: string;
  appVersion?: string;
}

export interface StackValues {
  /** Per-operator parsed values */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  perOperator: Record<string, Record<string, any>>;
}

let cachedStackInfo: StackInfo = { managed: false, charts: {} };
let cachedStackValues: StackValues = { perOperator: {} };

/** Detect installed charts by looking for kubevirt-stack-info-* ConfigMaps or Helm release secrets */
export async function detectStackInfo(): Promise<StackInfo> {
  try {
    const charts: Record<string, ChartInfo> = {};
    const operators: Record<string, boolean> = {};
    let namespace = '';

    // Strategy 1: Look for our info ConfigMaps (charts >= 0.2.0)
    const cmResp = (await ApiProxy.request(
      '/api/v1/configmaps?labelSelector=kubevirt-stack%2Finfo=true'
    )) as {
      items?: Array<{
        metadata: { name: string; namespace: string };
        data?: Record<string, string>;
      }>;
    };

    for (const cm of cmResp?.items || []) {
      const chartName = cm.data?.chartName || cm.metadata.name.replace('kubevirt-stack-info-', '');
      charts[chartName] = {
        chartName,
        chartVersion: cm.data?.chartVersion || '?',
        appVersion: cm.data?.appVersion || '?',
        namespace: cm.metadata.namespace,
      };
      operators[chartName] = true;
      if (!namespace) namespace = cm.metadata.namespace;
    }

    // Strategy 2: Fallback — check Helm release secrets for our chart names
    // Works for all install methods (helm CLI, Headlamp, Flux, Rancher)
    if (Object.keys(charts).length === 0) {
      const knownCharts = OPERATORS.map(o => getChartName(o.id));
      // Narrow query: only fetch Helm secrets whose release name matches our charts
      const nameFilter = knownCharts.join(',');
      const secretResp = (await ApiProxy.request(
        `/api/v1/secrets?labelSelector=${encodeURIComponent(`owner=helm,name in (${nameFilter})`)}`
      )) as {
        items?: Array<{
          metadata: { name: string; namespace: string; labels?: Record<string, string> };
        }>;
      };

      for (const secret of secretResp?.items || []) {
        const releaseName = secret.metadata.labels?.name;
        if (releaseName && knownCharts.includes(releaseName)) {
          charts[releaseName] = {
            chartName: releaseName,
            chartVersion: secret.metadata.labels?.version || '?',
            appVersion: '?',
            namespace: secret.metadata.namespace,
          };
          operators[releaseName] = true;
          if (!namespace) namespace = secret.metadata.namespace;
        }
      }
    }

    const hasCharts = Object.keys(charts).length > 0;
    cachedStackInfo = {
      managed: hasCharts,
      namespace,
      charts,
      operators,
      // Legacy compat: use kubevirt chart version if present
      chartVersion: charts.kubevirt?.chartVersion,
      appVersion: charts.kubevirt?.appVersion,
    };
    return cachedStackInfo;
  } catch {
    cachedStackInfo = { managed: false, charts: {} };
    return cachedStackInfo;
  }
}

/** Read the last-applied values from per-chart Secrets */
export async function readStackValues(): Promise<StackValues> {
  if (!cachedStackInfo.managed || !cachedStackInfo.namespace) {
    cachedStackValues = { perOperator: {} };
    return cachedStackValues;
  }

  const perOperator: StackValues['perOperator'] = {};

  // Fetch all secrets with our label in one call
  try {
    const resp = (await ApiProxy.request(
      `/api/v1/namespaces/${cachedStackInfo.namespace}/secrets?labelSelector=kubevirt-stack%2Finfo=true`
    )) as {
      items?: Array<{
        metadata: { name: string };
        data?: Record<string, string>;
      }>;
    };

    for (const secret of resp?.items || []) {
      const chartName = secret.metadata.name.replace('kubevirt-stack-values-', '');
      const raw = secret.data?.['values.yaml'];
      if (!raw) continue;

      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(raw), c => c.charCodeAt(0))
        );
        const parsed = yaml.load(decoded, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>;
        if (parsed) perOperator[chartName] = parsed;
      } catch (e) {
        console.warn(`[kubevirt] Failed to parse values for chart ${chartName}:`, e);
      }
    }
  } catch (e) {
    console.warn('[kubevirt] Failed to fetch stack values secrets:', e);
  }

  cachedStackValues = { perOperator };
  return cachedStackValues;
}

/** Detect how each managed chart was installed (Flux, ArgoCD, Rancher, or Helm CLI) */
export async function detectInstallMethods(): Promise<void> {
  if (!cachedStackInfo.managed) return;

  const chartNames = Object.keys(cachedStackInfo.charts);
  if (chartNames.length === 0) return;

  // Check for Flux HelmReleases
  try {
    const resp = (await ApiProxy.request(
      '/apis/helm.toolkit.fluxcd.io/v2/helmreleases'
    )) as { items?: Array<{ metadata: { name: string; namespace: string } }> };
    for (const hr of resp?.items || []) {
      if (cachedStackInfo.charts[hr.metadata.name]) {
        cachedStackInfo.charts[hr.metadata.name].installMethod = 'flux';
      }
    }
  } catch {
    // Flux not installed or no access
  }

  // Check for ArgoCD Applications
  try {
    const resp = (await ApiProxy.request(
      '/apis/argoproj.io/v1alpha1/applications'
    )) as { items?: Array<{ metadata: { name: string; namespace: string } }> };
    for (const app of resp?.items || []) {
      if (cachedStackInfo.charts[app.metadata.name] && !cachedStackInfo.charts[app.metadata.name].installMethod) {
        cachedStackInfo.charts[app.metadata.name].installMethod = 'argocd';
      }
    }
  } catch {
    // ArgoCD not installed or no access
  }

  // Check for Rancher HelmCharts
  try {
    const resp = (await ApiProxy.request(
      '/apis/helm.cattle.io/v1/helmcharts'
    )) as { items?: Array<{ metadata: { name: string; namespace: string } }> };
    for (const hc of resp?.items || []) {
      if (cachedStackInfo.charts[hc.metadata.name] && !cachedStackInfo.charts[hc.metadata.name].installMethod) {
        cachedStackInfo.charts[hc.metadata.name].installMethod = 'rancher';
      }
    }
  } catch {
    // Rancher not installed or no access
  }

  // Anything still without a method was installed via Helm CLI
  for (const chart of Object.values(cachedStackInfo.charts)) {
    if (!chart.installMethod) {
      chart.installMethod = 'helm-cli';
    }
  }
}

/** Get cached stack info */
export function getStackInfo(): StackInfo {
  return cachedStackInfo;
}


