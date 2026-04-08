import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

/** Ports commonly used by Prometheus-compatible services */
const PROMETHEUS_PORTS = [9090, 9091];

/** Service name patterns for Prometheus-compatible APIs */
const PROMETHEUS_NAME_PATTERNS = ['prometheus', 'thanos-querier'];

interface PromService {
  metadata: { name: string; namespace: string };
  spec: { ports: Array<{ port: number }> };
}

export interface PrometheusDiscoveryResult {
  installed: boolean;
  available: boolean;
  baseUrl: string;
}

/**
 * Discovers and verifies a Prometheus-compatible service in the cluster.
 *
 * Searches all namespaces for services matching known Prometheus name patterns
 * (prometheus, thanos-querier) on standard ports (9090, 9091).
 * Supports both standard Prometheus and OpenShift monitoring (Thanos Querier).
 */
export async function discoverPrometheus(): Promise<PrometheusDiscoveryResult> {
  const notFound: PrometheusDiscoveryResult = {
    installed: false,
    available: false,
    baseUrl: '',
  };

  const svcResp = await ApiProxy.request('/api/v1/services').catch(() => null);
  const svcItems = ((svcResp as Record<string, unknown>)?.items || []) as PromService[];

  let matchedPort = 0;
  const promSvc = svcItems.find(svc => {
    const name = svc.metadata?.name || '';
    const ports = svc.spec?.ports || [];
    const nameMatch = PROMETHEUS_NAME_PATTERNS.some(pattern => name.includes(pattern));
    if (!nameMatch) return false;
    const portMatch = ports.find(p => PROMETHEUS_PORTS.includes(p.port));
    if (portMatch) {
      matchedPort = portMatch.port;
      return true;
    }
    return false;
  });

  if (!promSvc) return notFound;

  const baseUrl = `/api/v1/namespaces/${promSvc.metadata.namespace}/services/${promSvc.metadata.name}:${matchedPort}/proxy`;

  // Verify Prometheus is actually reachable
  const healthCheck = await ApiProxy.request(`${baseUrl}/api/v1/query?query=up`).catch(() => null);
  if (!(healthCheck as Record<string, unknown>)?.data) {
    return { installed: true, available: false, baseUrl: '' };
  }

  return { installed: true, available: true, baseUrl };
}
