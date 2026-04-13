import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useState } from 'react';

const CONFIGMAP_NAME = 'headlamp-kubevirt-config';
const CONFIGMAP_KEY = 'metricsEndpoint';
const CONFIGMAP_ORGID_KEY = 'metricsOrgId';
const LOCALSTORAGE_KEY = 'headlamp-kubevirt-metrics-endpoint';
const LOCALSTORAGE_ORGID_KEY = 'headlamp-kubevirt-metrics-orgid';

// ── Module-level cache ─────────────────────────────────────────────────

let cachedEndpoint: string | null = null;
let cachedOrgId: string | null = null;
let cachedSource: MetricsEndpointState['source'] = 'none';
let cachedCmNamespace: string | null = null;
let cacheResolved = false;
const listeners: Array<() => void> = [];

function notify() {
  listeners.forEach(fn => fn());
}

// ── Public types ───────────────────────────────────────────────────────

interface MetricsEndpointData {
  baseUrl: string;
  orgId: string;
  available: boolean;
  loading: boolean;
  source: 'configmap' | 'localstorage' | 'none';
}

export interface MetricsEndpointState extends MetricsEndpointData {
  /** Make a request to the metrics endpoint with proper headers (org ID). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (path: string) => Promise<any>;
}

export interface TestResult {
  ok: boolean;
  count: number;
  error?: string;
}

// ── Helpers: build request options with optional org ID header ──────────

function metricsRequestOpts(orgId?: string | null): Record<string, unknown> {
  if (orgId) return { headers: { 'X-Scope-OrgID': orgId } };
  return {};
}

/** Make a metrics API request with optional org ID header. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function metricsRequest(url: string, orgId?: string | null): Promise<any> {
  return ApiProxy.request(url, metricsRequestOpts(orgId));
}

// ── Read functions ─────────────────────────────────────────────────────

/** Check known namespaces + KubeVirt namespace for the config ConfigMap. */
async function readFromConfigMap(): Promise<{
  url: string | null;
  orgId: string | null;
  namespace: string | null;
}> {
  const namespacesToCheck = new Set(['kubevirt', 'monitoring', 'default', 'headlamp']);

  // Also check the namespace where KubeVirt is actually installed
  try {
    const kvResp = (await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts')) as {
      items?: Array<{ metadata: { namespace: string } }>;
    };
    const kvNs = kvResp?.items?.[0]?.metadata?.namespace;
    if (kvNs) namespacesToCheck.add(kvNs);
  } catch {
    // KubeVirt API not available, continue with defaults
  }

  for (const ns of namespacesToCheck) {
    try {
      const resp = (await ApiProxy.request(
        `/api/v1/namespaces/${ns}/configmaps/${CONFIGMAP_NAME}`
      )) as { data?: Record<string, string> };
      if (resp?.data?.[CONFIGMAP_KEY]) {
        return {
          url: resp.data[CONFIGMAP_KEY],
          orgId: resp.data[CONFIGMAP_ORGID_KEY] || null,
          namespace: ns,
        };
      }
    } catch {
      // ConfigMap not in this namespace, try next
    }
  }
  return { url: null, orgId: null, namespace: null };
}

function readFromLocalStorage(): { url: string | null; orgId: string | null } {
  try {
    return {
      url: localStorage.getItem(LOCALSTORAGE_KEY) || null,
      orgId: localStorage.getItem(LOCALSTORAGE_ORGID_KEY) || null,
    };
  } catch {
    return { url: null, orgId: null };
  }
}

/** Resolve the endpoint: localStorage (user override) > ConfigMap (cluster default) > none */
async function resolveEndpoint(): Promise<{
  url: string | null;
  orgId: string | null;
  source: MetricsEndpointState['source'];
}> {
  const ls = readFromLocalStorage();
  if (ls.url) return { url: ls.url, orgId: ls.orgId, source: 'localstorage' };

  const cm = await readFromConfigMap();
  if (cm.url) {
    cachedCmNamespace = cm.namespace;
    return { url: cm.url, orgId: cm.orgId, source: 'configmap' };
  }

  return { url: null, orgId: null, source: 'none' };
}

// ── Write functions ────────────────────────────────────────────────────

export async function saveMetricsEndpoint(
  url: string,
  target: 'localstorage' | 'configmap',
  namespace?: string,
  orgId?: string
): Promise<void> {
  if (target === 'localstorage') {
    localStorage.setItem(LOCALSTORAGE_KEY, url);
    if (orgId) localStorage.setItem(LOCALSTORAGE_ORGID_KEY, orgId);
    else localStorage.removeItem(LOCALSTORAGE_ORGID_KEY);
  } else if (target === 'configmap') {
    if (!namespace) throw new Error('Namespace required for ConfigMap save');
    const data: Record<string, string> = { [CONFIGMAP_KEY]: url };
    if (orgId) data[CONFIGMAP_ORGID_KEY] = orgId;

    const existing = await ApiProxy.request(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${CONFIGMAP_NAME}`
    ).catch(() => null);

    if (existing) {
      await ApiProxy.patch(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${CONFIGMAP_NAME}`,
        { data }
      );
    } else {
      await ApiProxy.post(`/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`, {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: CONFIGMAP_NAME, namespace },
        data,
      });
    }
  }

  cachedEndpoint = url;
  cachedOrgId = orgId || null;
  cachedSource = target;
  if (target === 'configmap') cachedCmNamespace = namespace || null;
  cacheResolved = true;
  notify();
}

export async function clearMetricsEndpoint(): Promise<void> {
  localStorage.removeItem(LOCALSTORAGE_KEY);
  localStorage.removeItem(LOCALSTORAGE_ORGID_KEY);

  // Delete ConfigMap if it exists
  if (cachedCmNamespace) {
    try {
      await ApiProxy.request(
        `/api/v1/namespaces/${encodeURIComponent(cachedCmNamespace)}/configmaps/${CONFIGMAP_NAME}`,
        { method: 'DELETE' }
      );
    } catch {
      // ConfigMap may already be gone
    }
  }

  cachedEndpoint = null;
  cachedOrgId = null;
  cachedSource = 'none';
  cachedCmNamespace = null;
  cacheResolved = true;
  notify();
}

// ── Test function ──────────────────────────────────────────────────────

export async function testMetricsEndpoint(url: string, orgId?: string): Promise<TestResult> {
  const opts = metricsRequestOpts(orgId);
  let lastError: string | undefined;

  for (const query of ['up', 'kubevirt_info']) {
    try {
      const resp = (await ApiProxy.request(
        `${url}/api/v1/query?query=${encodeURIComponent(query)}`,
        opts
      )) as Record<string, unknown>;
      if (resp?.status !== 'success') continue;
      const results = ((resp.data as Record<string, unknown>)?.result as unknown[]) || [];
      return { ok: true, count: results.length };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, count: 0, error: lastError || 'Endpoint not reachable' };
}

// ── React hook ─────────────────────────────────────────────────────────

export function useMetricsEndpoint(): MetricsEndpointState {
  const [state, setState] = useState<MetricsEndpointData>({
    baseUrl: cachedEndpoint || '',
    orgId: cachedOrgId || '',
    available: false,
    loading: !cacheResolved || !!cachedEndpoint,
    source: cachedSource,
  });

  useEffect(() => {
    let cancelled = false;

    const syncState = async () => {
      if (!cachedEndpoint) {
        if (!cancelled)
          setState({ baseUrl: '', orgId: '', available: false, loading: false, source: 'none' });
        return;
      }
      const test = await testMetricsEndpoint(cachedEndpoint, cachedOrgId || undefined);
      if (!cancelled) {
        setState({
          baseUrl: cachedEndpoint,
          orgId: cachedOrgId || '',
          available: test.ok,
          loading: false,
          source: cachedSource,
        });
      }
    };

    const resolve = async () => {
      if (!cacheResolved) {
        const { url, orgId, source } = await resolveEndpoint();
        cachedEndpoint = url;
        cachedOrgId = orgId;
        cachedSource = source;
        cacheResolved = true;
      }
      if (cancelled) return;
      await syncState();
    };

    resolve();
    listeners.push(syncState);

    return () => {
      cancelled = true;
      const idx = listeners.indexOf(syncState);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  const request = useCallback(
    (path: string) => metricsRequest(path, state.orgId || undefined),
    [state.orgId]
  );

  return useMemo(() => ({ ...state, request }), [state, request]);
}
