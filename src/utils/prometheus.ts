import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

/**
 * Prometheus-compatible service patterns.
 * Each entry pairs name patterns with valid ports to avoid false positives
 * (e.g., kube-state-metrics has "prometheus" in its name but isn't a query API).
 */
const PROMETHEUS_SERVICES = [
  { names: ['prometheus'], ports: [9090, 9091] },
  { names: ['thanos-querier'], ports: [9090, 9091] },
  { names: ['mimir-gateway'], ports: [80, 8080] },
  { names: ['mimir-querier', 'mimir-query-frontend'], ports: [8080] },
];

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
 * (prometheus, thanos-querier, mimir-querier) on standard ports (9090, 9091, 8080).
 * Supports standard Prometheus, OpenShift monitoring (Thanos Querier), and Grafana Mimir.
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
    for (const pattern of PROMETHEUS_SERVICES) {
      const nameMatch = pattern.names.some(p => name.includes(p));
      if (!nameMatch) continue;
      const portMatch = ports.find(p => pattern.ports.includes(p.port));
      if (portMatch) {
        matchedPort = portMatch.port;
        return true;
      }
    }
    return false;
  });

  if (!promSvc) return notFound;

  const proxyBase = `/api/v1/namespaces/${promSvc.metadata.namespace}/services/${promSvc.metadata.name}:${matchedPort}/proxy`;

  // Try standard Prometheus path, then Mimir's /prometheus prefix
  for (const prefix of ['', '/prometheus']) {
    const baseUrl = `${proxyBase}${prefix}`;
    const healthCheck = await ApiProxy.request(`${baseUrl}/api/v1/query?query=up`).catch(
      () => null
    );
    if ((healthCheck as Record<string, unknown>)?.data) {
      return { installed: true, available: true, baseUrl };
    }
  }

  return { installed: true, available: false, baseUrl: '' };
}
