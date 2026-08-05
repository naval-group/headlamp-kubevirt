/**
 * Deployment strategy utilities for the Install Wizard.
 * Generates per-operator Helm commands, ArgoCD Applications, Flux HelmReleases,
 * or Rancher HelmCharts — one per selected operator.
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import yaml from 'js-yaml';
import { getOperatorSchema } from './chartSchemas';
import { OperatorInstall } from './helmValues';
import { OCI_CHART_BASE } from './operatorRegistry';

export type DeploymentMethod = 'helm-template' | 'helm-install' | 'argocd' | 'flux' | 'rancher';

export type DeploymentMode = 'apply' | 'download';

// ── Method metadata ─────────────────────────────────────────────────

export interface MethodInfo {
  id: DeploymentMethod;
  name: string;
  description: string;
  icon: string;
  requiresController: boolean;
  controllerDetection?: {
    apiGroup: string;
    resource: string;
  };
}

export const DEPLOYMENT_METHODS: MethodInfo[] = [
  {
    id: 'helm-template',
    name: 'Manifests (helm template)',
    description:
      'Render Helm templates and apply raw manifests via kubectl. No Helm release tracking. Best for one-off installations.',
    icon: 'mdi:file-document-outline',
    requiresController: false,
  },
  {
    id: 'helm-install',
    name: 'Helm Release (CLI)',
    description:
      'Install each operator as a Helm release via CLI commands. Full lifecycle management.',
    icon: 'mdi:package-variant-closed',
    requiresController: false,
  },
  {
    id: 'argocd',
    name: 'ArgoCD Application',
    description:
      'Create one ArgoCD Application per operator. Requires ArgoCD installed in the cluster.',
    icon: 'simple-icons:argo',
    requiresController: true,
    controllerDetection: {
      apiGroup: 'argoproj.io',
      resource: 'applications',
    },
  },
  {
    id: 'flux',
    name: 'Flux HelmRelease',
    description:
      'Create Flux HelmRelease CRs. Requires Flux Helm Controller installed in the cluster.',
    icon: 'simple-icons:flux',
    requiresController: true,
    controllerDetection: {
      apiGroup: 'helm.toolkit.fluxcd.io',
      resource: 'helmreleases',
    },
  },
  {
    id: 'rancher',
    name: 'Rancher HelmChart',
    description:
      'Create Rancher HelmChart CRs. Available on RKE2 and K3s clusters with the Helm controller.',
    icon: 'simple-icons:rancher',
    requiresController: true,
    controllerDetection: {
      apiGroup: 'helm.cattle.io',
      resource: 'helmcharts',
    },
  },
];

// ── Controller detection ────────────────────────────────────────────

/** Check if a deployment method is available */
export async function detectController(method: DeploymentMethod): Promise<boolean> {
  const info = DEPLOYMENT_METHODS.find(m => m.id === method);
  if (!info?.controllerDetection) return true; // No controller needed

  try {
    await ApiProxy.request(`/apis/${info.controllerDetection.apiGroup}`);
    return true;
  } catch {
    return false;
  }
}

/** Detect all available deployment methods */
export async function detectAvailableMethods(): Promise<Record<DeploymentMethod, boolean>> {
  const results = await Promise.all(
    DEPLOYMENT_METHODS.map(async m => [m.id, await detectController(m.id)] as const)
  );
  return Object.fromEntries(results) as Record<DeploymentMethod, boolean>;
}

/** Check if an install has custom values */
function hasValues(install: OperatorInstall): boolean {
  return Object.keys(install.values).length > 0;
}

// ── Per-operator CR Generators ──────────────────────────────────────

function generateArgoCDApplication(
  install: OperatorInstall,
  namespace: string,
  crNs = 'argocd'
): Record<string, unknown> {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: {
      name: install.chartName,
      namespace: crNs,
    },
    spec: {
      project: 'default',
      source: {
        chart: install.chartName,
        repoURL: OCI_CHART_BASE,
        targetRevision: install.chartVersion,
        helm: {
          releaseName: install.chartName,
          ...(hasValues(install)
            ? { values: yaml.dump(install.values, { lineWidth: -1, noRefs: true }) }
            : {}),
        },
      },
      destination: {
        server: 'https://kubernetes.default.svc',
        namespace,
      },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        syncOptions: ['CreateNamespace=true'],
      },
    },
  };
}

function generateFluxHelmRelease(
  install: OperatorInstall,
  targetNamespace: string,
  crNs = 'flux-system'
): Record<string, unknown>[] {
  const repoName = `${install.chartName}-repo`;
  const fluxNs = crNs;

  const helmRepo = {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'HelmRepository',
    metadata: { name: repoName, namespace: fluxNs },
    spec: {
      type: 'oci',
      url: OCI_CHART_BASE,
      interval: '1h',
    },
  };

  const helmRelease = {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: { name: install.chartName, namespace: fluxNs },
    spec: {
      targetNamespace: targetNamespace,
      interval: '1h',
      install: { createNamespace: true },
      chart: {
        spec: {
          chart: install.chartName,
          version: install.chartVersion,
          sourceRef: { kind: 'HelmRepository', name: repoName },
        },
      },
      ...(hasValues(install) ? { values: install.values } : {}),
    },
  };

  return [helmRepo, helmRelease];
}

function generateRancherHelmChart(
  install: OperatorInstall,
  namespace: string,
  crNs = 'kube-system'
): Record<string, unknown> {
  return {
    apiVersion: 'helm.cattle.io/v1',
    kind: 'HelmChart',
    metadata: { name: install.chartName, namespace: crNs },
    spec: {
      repo: OCI_CHART_BASE,
      chart: install.chartName,
      version: install.chartVersion,
      targetNamespace: namespace,
      createNamespace: true,
      ...(hasValues(install)
        ? { valuesContent: yaml.dump(install.values, { lineWidth: -1, noRefs: true }) }
        : {}),
    },
  };
}

// ── Generate output ─────────────────────────────────────────────────

export interface GeneratedOutput {
  /** YAML string of all resources to apply */
  yaml: string;
  /** Individual resource objects */
  resources: Record<string, unknown>[];
  /** Filename for download */
  filename: string;
  /** Description of what was generated */
  description: string;
  /** Per-operator breakdown (for review) */
  perOperator: Array<{
    displayName: string;
    chartName: string;
    chartVersion: string;
    resources: Record<string, unknown>[];
    helmCommand?: string;
  }>;
}

/** Generate the deployment output for all selected operators */
export function generateDeploymentOutput(
  method: DeploymentMethod,
  installs: OperatorInstall[],
  namespace = 'kubevirt',
  crNamespace?: string
): GeneratedOutput {
  const allResources: Record<string, unknown>[] = [];
  const perOperator: GeneratedOutput['perOperator'] = [];

  for (const install of installs) {
    let resources: Record<string, unknown>[] = [];
    let helmCommand: string | undefined;
    // Use namespace from: 1) operator values, 2) schema default, 3) fallback
    const schemaDefault = getOperatorSchema(install.id)?.properties?.namespace?.default as string | undefined;
    const ns = (install.values.namespace as string) || schemaDefault || namespace;

    switch (method) {
      case 'helm-template':
      case 'helm-install': {
        const hasVals = hasValues(install);
        helmCommand = `helm install ${install.chartName} ${install.chartUrl} --version ${install.chartVersion} --namespace ${ns} --create-namespace${hasVals ? ` \\\n  -f ${install.chartName}-values.yaml` : ''}`;
        break;
      }
      case 'argocd':
        resources = [generateArgoCDApplication(install, ns, crNamespace)];
        break;
      case 'flux':
        resources = generateFluxHelmRelease(install, ns, crNamespace);
        break;
      case 'rancher':
        resources = [generateRancherHelmChart(install, ns, crNamespace)];
        break;
    }

    allResources.push(...resources);
    perOperator.push({
      displayName: install.displayName,
      chartName: install.chartName,
      chartVersion: install.chartVersion,
      resources,
      helmCommand,
    });
  }

  const yamlStr = allResources.length > 0
    ? allResources.map(r => yaml.dump(r, { lineWidth: -1, noRefs: true })).join('---\n')
    : '';

  const methodLabel = DEPLOYMENT_METHODS.find(m => m.id === method)?.name || method;

  return {
    yaml: yamlStr,
    resources: allResources,
    filename: `kubevirt-operators-${method}.yaml`,
    description: `${methodLabel} — ${installs.length} operator(s)`,
    perOperator,
  };
}

// ── Apply / Download ────────────────────────────────────────────────

/** Apply resources to the cluster via ApiProxy */
export async function applyResources(
  resources: Record<string, unknown>[],
  onProgress?: (current: number, total: number, resource: string) => void
): Promise<{ success: boolean; applied: number; error?: string }> {
  let applied = 0;

  for (const resource of resources) {
    const meta = resource.metadata as { name?: string; namespace?: string } | undefined;
    const kind = resource.kind as string;
    const apiVersion = resource.apiVersion as string;
    const name = meta?.name || 'unknown';
    const namespace = meta?.namespace;

    onProgress?.(applied, resources.length, `${kind}/${name}`);

    try {
      const apiPath = buildApiPath(apiVersion, kind, namespace);
      await ApiProxy.request(apiPath, {
        method: 'POST',
        body: JSON.stringify(resource),
        headers: { 'Content-Type': 'application/json' },
      });
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 409 Conflict = already exists, treat as success
      if (msg.includes('409') || msg.includes('already exists')) {
        applied++;
        continue;
      }
      return {
        success: false,
        applied,
        error: `Failed to apply ${kind}/${name}: ${msg}`,
      };
    }
  }

  onProgress?.(applied, resources.length, 'Done');
  return { success: true, applied };
}

/** Trigger a file download in the browser */
export function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/x-yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Build the API path for creating a resource */
function buildApiPath(apiVersion: string, kind: string, namespace?: string): string {
  const isCore = !apiVersion.includes('/');
  const base = isCore ? `/api/${apiVersion}` : `/apis/${apiVersion}`;
  const plural = kindToPlural(kind);

  if (namespace) {
    return `${base}/namespaces/${encodeURIComponent(namespace)}/${plural}`;
  }
  return `${base}/${plural}`;
}

/** Convert Kind to plural resource name (simplified) */
function kindToPlural(kind: string): string {
  const known: Record<string, string> = {
    Namespace: 'namespaces',
    ServiceAccount: 'serviceaccounts',
    ClusterRole: 'clusterroles',
    ClusterRoleBinding: 'clusterrolebindings',
    Role: 'roles',
    RoleBinding: 'rolebindings',
    Deployment: 'deployments',
    DaemonSet: 'daemonsets',
    Service: 'services',
    ConfigMap: 'configmaps',
    Secret: 'secrets',
    PriorityClass: 'priorityclasses',
    ValidatingAdmissionPolicy: 'validatingadmissionpolicies',
    ValidatingAdmissionPolicyBinding: 'validatingadmissionpolicybindings',
    CustomResourceDefinition: 'customresourcedefinitions',
    HelmRepository: 'helmrepositories',
    HelmRelease: 'helmreleases',
    HelmChart: 'helmcharts',
    Application: 'applications',
    KubeVirt: 'kubevirts',
    CDI: 'cdis',
    AAQ: 'aaqs',
    HostPathProvisioner: 'hostpathprovisioners',
  };

  if (known[kind]) return known[kind];
  return kind.toLowerCase() + 's';
}

// ── Fetch existing CR values for diff ───────────────────────────────

/** Fetch existing values from a deployed GitOps CR */
export async function fetchExistingValues(
  chartName: string,
  installMethod: string
): Promise<Record<string, unknown> | null> {
  try {
    switch (installMethod) {
      case 'flux': {
        // Flux HelmRelease values are in spec.values
        const resp = (await ApiProxy.request(
          `/apis/helm.toolkit.fluxcd.io/v2/helmreleases?fieldSelector=metadata.name=${chartName}`
        )) as { items?: Array<{ spec?: { values?: Record<string, unknown> } }> };
        return resp?.items?.[0]?.spec?.values || {};
      }
      case 'argocd': {
        // ArgoCD Application values are in spec.source.helm.values (YAML string)
        const resp = (await ApiProxy.request(
          `/apis/argoproj.io/v1alpha1/applications?fieldSelector=metadata.name=${chartName}`
        )) as { items?: Array<{ spec?: { source?: { helm?: { values?: string } } } }> };
        const valuesYaml = resp?.items?.[0]?.spec?.source?.helm?.values;
        if (!valuesYaml) return {};
        return yaml.load(valuesYaml, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown> || {};
      }
      case 'rancher': {
        // Rancher HelmChart values are in spec.valuesContent (YAML string)
        const resp = (await ApiProxy.request(
          `/apis/helm.cattle.io/v1/helmcharts?fieldSelector=metadata.name=${chartName}`
        )) as { items?: Array<{ spec?: { valuesContent?: string } }> };
        const valuesYaml = resp?.items?.[0]?.spec?.valuesContent;
        if (!valuesYaml) return {};
        return yaml.load(valuesYaml, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown> || {};
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

