/**
 * Deployment strategy utilities for the Install Wizard and Marketplace.
 * Generates manifests or CRs for each deployment method, with apply and download modes.
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import yaml from 'js-yaml';

export type DeploymentMethod = 'helm-template' | 'helm-install' | 'argocd' | 'flux' | 'rancher';

export type DeploymentMode = 'apply' | 'download';

export interface ChartReference {
  /** Chart repository URL (e.g., oci://ghcr.io/naval-group/helm-kubevirt or https://...) */
  repoUrl: string;
  /** Chart name */
  chartName: string;
  /** Chart version */
  chartVersion: string;
}

export interface DeploymentConfig {
  method: DeploymentMethod;
  mode: DeploymentMode;
  chart: ChartReference;
  releaseName: string;
  namespace: string;
  values: Record<string, unknown>;
}

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
    name: 'Helm Release',
    description:
      'Install as a Helm release with full lifecycle management. Requires Helm or a Helm controller (Flux, Rancher).',
    icon: 'mdi:package-variant-closed',
    requiresController: false,
  },
  {
    id: 'argocd',
    name: 'ArgoCD Application',
    description:
      'Create an ArgoCD Application that manages the Helm chart. Requires ArgoCD installed in the cluster.',
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
      'Create a Flux HelmRelease CR. Requires Flux Helm Controller installed in the cluster.',
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
      'Create a Rancher HelmChart CR. Available on RKE2 and K3s clusters with the Helm controller.',
    icon: 'simple-icons:rancher',
    requiresController: true,
    controllerDetection: {
      apiGroup: 'helm.cattle.io',
      resource: 'helmcharts',
    },
  },
];

// ── Controller detection ────────────────────────────────────────────

/** Check if a GitOps controller is available in the cluster */
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

// ── CR Generators ───────────────────────────────────────────────────

function generateArgoCDApplication(config: DeploymentConfig): Record<string, unknown> {
  const isOCI = config.chart.repoUrl.startsWith('oci://');
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: {
      name: config.releaseName,
      namespace: 'argocd',
    },
    spec: {
      project: 'default',
      source: {
        ...(isOCI
          ? { chart: config.chart.chartName, repoURL: config.chart.repoUrl }
          : {
              repoURL: config.chart.repoUrl,
              chart: config.chart.chartName,
            }),
        targetRevision: config.chart.chartVersion,
        helm: {
          releaseName: config.releaseName,
          values: yaml.dump(config.values, { lineWidth: -1, noRefs: true }),
        },
      },
      destination: {
        server: 'https://kubernetes.default.svc',
        namespace: config.namespace,
      },
      syncPolicy: {
        automated: {
          prune: true,
          selfHeal: true,
        },
        syncOptions: ['CreateNamespace=true'],
      },
    },
  };
}

function generateFluxHelmRelease(config: DeploymentConfig): Record<string, unknown>[] {
  const isOCI = config.chart.repoUrl.startsWith('oci://');
  const repoName = `${config.releaseName}-repo`;

  const helmRepo = {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'HelmRepository',
    metadata: {
      name: repoName,
      namespace: config.namespace,
    },
    spec: {
      type: isOCI ? 'oci' : 'default',
      url: config.chart.repoUrl,
      interval: '1h',
    },
  };

  const helmRelease = {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: {
      name: config.releaseName,
      namespace: config.namespace,
    },
    spec: {
      interval: '1h',
      chart: {
        spec: {
          chart: config.chart.chartName,
          version: config.chart.chartVersion,
          sourceRef: {
            kind: 'HelmRepository',
            name: repoName,
          },
        },
      },
      values: config.values,
    },
  };

  return [helmRepo, helmRelease];
}

function generateRancherHelmChart(config: DeploymentConfig): Record<string, unknown> {
  return {
    apiVersion: 'helm.cattle.io/v1',
    kind: 'HelmChart',
    metadata: {
      name: config.releaseName,
      namespace: 'kube-system',
    },
    spec: {
      repo: config.chart.repoUrl,
      chart: config.chart.chartName,
      version: config.chart.chartVersion,
      targetNamespace: config.namespace,
      createNamespace: true,
      valuesContent: yaml.dump(config.values, { lineWidth: -1, noRefs: true }),
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
}

/** Generate the deployment output for a given configuration */
export function generateDeploymentOutput(config: DeploymentConfig): GeneratedOutput {
  let resources: Record<string, unknown>[];
  let filename: string;
  let description: string;

  switch (config.method) {
    case 'helm-template':
      // For helm-template, manifests come from the pre-rendered templates
      // This is handled separately by manifestGenerator.ts
      resources = [];
      filename = `${config.releaseName}-manifests.yaml`;
      description = 'Rendered Helm templates as raw Kubernetes manifests';
      break;

    case 'helm-install':
      // For helm-install download, output values.yaml
      resources = [config.values];
      filename = `${config.releaseName}-values.yaml`;
      description = `Helm values for: helm install ${config.releaseName} ${config.chart.repoUrl}/${config.chart.chartName} --version ${config.chart.chartVersion} -f values.yaml`;
      return {
        yaml: yaml.dump(config.values, { lineWidth: -1, noRefs: true }),
        resources,
        filename,
        description,
      };

    case 'argocd':
      resources = [generateArgoCDApplication(config)];
      filename = `${config.releaseName}-argocd-application.yaml`;
      description = 'ArgoCD Application pointing to the KubeVirt Helm chart';
      break;

    case 'flux':
      resources = generateFluxHelmRelease(config);
      filename = `${config.releaseName}-flux-helmrelease.yaml`;
      description = 'Flux HelmRepository + HelmRelease for the KubeVirt Helm chart';
      break;

    case 'rancher':
      resources = [generateRancherHelmChart(config)];
      filename = `${config.releaseName}-rancher-helmchart.yaml`;
      description = 'Rancher HelmChart CR for the KubeVirt Helm chart';
      break;
  }

  const yamlStr = resources.map(r => yaml.dump(r, { lineWidth: -1, noRefs: true })).join('---\n');

  return { yaml: yamlStr, resources, filename, description };
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
    // KubeVirt ecosystem
    KubeVirt: 'kubevirts',
    CDI: 'cdis',
    AAQ: 'aaqs',
    HostPathProvisioner: 'hostpathprovisioners',
  };

  if (known[kind]) return known[kind];

  // Fallback: lowercase + 's'
  return kind.toLowerCase() + 's';
}
