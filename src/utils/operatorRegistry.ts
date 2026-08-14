/**
 * Static registry of KubeVirt ecosystem operators.
 * Powers both the Install Wizard and the Settings Marketplace.
 *
 * Each operator maps to an individual Helm chart published at:
 *   oci://ghcr.io/naval-group/kubevirt-stack-charts/<chartName>
 */

export const OCI_CHART_BASE = 'oci://ghcr.io/naval-group/kubevirt-stack-charts';

export type OperatorCategory = 'core' | 'networking' | 'storage' | 'migration' | 'extras';

export interface OperatorInfo {
  /** Unique ID (camelCase) */
  id: string;
  /** Chart name in the OCI registry (kebab-case). Defaults to id if not set. */
  chartName?: string;
  /** Chart version in the OCI registry */
  chartVersion: string;
  /** ArtifactHub repository name (for Apps catalog link). Defaults to chartName. */
  artifactHubRepo?: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Longer explanation shown in wizard */
  details: string;
  /** App version (upstream project version) */
  version: string;
  /** MDI icon name */
  icon: string;
  /** Category for grouping in the UI */
  category: OperatorCategory;
  /** Operator IDs that must be installed first */
  dependencies: string[];
  /** Selected by default in the wizard */
  defaultEnabled: boolean;
  /** @deprecated Use chartName instead */
  helmKey?: string;
  /** How to detect if already installed */
  detection: OperatorDetection;
  /** Resources to count before allowing uninstall */
  uninstallProtection?: UninstallCheck[];
}

export interface OperatorDetection {
  /** CRD name to check (primary signal) */
  crd?: string;
  /** Namespace to check */
  namespace?: string;
  /** Deployment name + namespace to check */
  deployment?: { name: string; namespace: string };
  /** DaemonSet name + namespace to check */
  daemonSet?: { name: string; namespace: string };
  /** Alternative DaemonSet names (e.g. RKE2 variants) */
  altDaemonSets?: Array<{ name: string; namespace: string }>;
  /** Alternative CRD names */
  altCrds?: string[];
  /** Specific resource to check via API path (e.g. a named ValidatingAdmissionPolicy) */
  apiPath?: string;
}

export interface UninstallCheck {
  /** Display name for the resource type */
  label: string;
  /** API path to list resources (count items) */
  apiPath: string;
}

export const OPERATOR_CATEGORIES: Record<OperatorCategory, string> = {
  core: 'Core',
  networking: 'Networking',
  storage: 'Storage',
  migration: 'Migration',
  extras: 'Extras',
};

// Colors match the FeatureGatesSection category convention in Settings
export const CATEGORY_COLORS: Record<OperatorCategory, string> = {
  core: '#9c27b0',
  networking: '#2196f3',
  storage: '#ff9800',
  migration: '#00bcd4',
  extras: '#4caf50',
};

const OPERATORS: OperatorInfo[] = [
  // ── Core ───────────────────────────────────────────────────────────
  {
    id: 'kubevirt',
    chartVersion: '0.2.0',
    name: 'KubeVirt',
    description: 'Virtual machine management for Kubernetes',
    details:
      'The core KubeVirt operator. Deploys virt-operator, virt-controller, virt-handler, and virt-api. Required for all other KubeVirt features.',
    version: 'v1.8.1',
    icon: 'mdi:server',
    category: 'core',
    dependencies: [],
    defaultEnabled: true,
    detection: {
      crd: 'kubevirts.kubevirt.io',
    },
    uninstallProtection: [
      {
        label: 'VirtualMachines',
        apiPath: '/apis/kubevirt.io/v1/virtualmachines',
      },
      {
        label: 'VirtualMachineInstances',
        apiPath: '/apis/kubevirt.io/v1/virtualmachineinstances',
      },
    ],
  },
  {
    id: 'cdi',
    chartVersion: '0.2.0',
    name: 'CDI',
    description: 'Containerized Data Importer for disk images',
    details:
      'Manages disk image imports from HTTP, S3, Registry, and PVC sources. Enables DataVolumes, DataSources, and DataImportCrons for automated OS image provisioning.',
    version: 'v1.65.0',
    icon: 'mdi:harddisk',
    category: 'core',
    dependencies: ['kubevirt'],
    defaultEnabled: true,
    detection: {
      crd: 'cdis.cdi.kubevirt.io',
    },
    uninstallProtection: [
      {
        label: 'DataVolumes',
        apiPath: '/apis/cdi.kubevirt.io/v1beta1/datavolumes',
      },
      {
        label: 'DataSources',
        apiPath: '/apis/cdi.kubevirt.io/v1beta1/datasources',
      },
      {
        label: 'DataImportCrons',
        apiPath: '/apis/cdi.kubevirt.io/v1beta1/dataimportcrons',
      },
    ],
  },

  // ── Networking ─────────────────────────────────────────────────────
  {
    id: 'multus',
    chartVersion: '0.2.0',
    name: 'Multus CNI',
    description: 'Multi-network support for pods and VMs',
    details:
      'Enables attaching multiple network interfaces to VMs using NetworkAttachmentDefinitions. Supports Bridge, Macvlan, IPvlan, SR-IOV, and more. Includes Dynamic Networks Controller for hot-plugging interfaces.',
    version: 'v4.1.4',
    icon: 'mdi:lan',
    category: 'networking',
    dependencies: [],
    defaultEnabled: true,
    detection: {
      daemonSet: { name: 'kube-multus-ds', namespace: 'kube-system' },
      altDaemonSets: [{ name: 'rke2-multus', namespace: 'kube-system' }],
    },
    uninstallProtection: [
      {
        label: 'NetworkAttachmentDefinitions',
        apiPath: '/apis/k8s.cni.cncf.io/v1/net-attach-defs',
      },
    ],
  },
  {
    id: 'kubemacpool',
    chartVersion: '0.2.0',
    name: 'KubeMacPool',
    description: 'MAC address management for VMs',
    details:
      'Allocates unique MAC addresses from a configurable range to VM network interfaces. Prevents MAC conflicts across the cluster.',
    version: 'v0.45.0',
    icon: 'mdi:ethernet',
    category: 'networking',
    dependencies: ['multus'],
    defaultEnabled: true,
    detection: {
      apiPath:
        '/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations/kubemacpool-mutator',
    },
  },

  // ── Storage ────────────────────────────────────────────────────────
  {
    id: 'hostpathProvisioner',
    chartVersion: '0.2.0',
    helmKey: 'hostpath-provisioner',
    name: 'HostPath Provisioner',
    description: 'Local storage for development and testing',
    details:
      'Provides local storage using host paths. Suitable for dev/test environments. Requires cert-manager. Not recommended for production.',
    version: 'v0.25.0',
    icon: 'mdi:folder-open',
    category: 'storage',
    dependencies: [],
    defaultEnabled: false,
    detection: {
      crd: 'hostpathprovisioners.hostpathprovisioner.kubevirt.io',
    },
  },

  // ── Migration ──────────────────────────────────────────────────────
  {
    id: 'forklift',
    chartVersion: '0.2.0',
    artifactHubRepo: 'kubevirt-forklift',
    name: 'Forklift',
    description: 'Migrate VMs from VMware, oVirt, and OpenStack',
    details:
      'Orchestrates VM migrations from external hypervisors to KubeVirt. Supports VMware vSphere, Red Hat Virtualization (oVirt), and OpenStack as source providers.',
    version: 'v2.11.3',
    icon: 'mdi:truck-delivery',
    category: 'migration',
    dependencies: ['kubevirt', 'cdi'],
    defaultEnabled: false,
    detection: {
      crd: 'providers.forklift.konveyor.io',
    },
  },

  // ── Extras ─────────────────────────────────────────────────────────
  {
    id: 'aaq',
    chartVersion: '0.2.0',
    name: 'AAQ',
    description: 'Application-aware resource quotas',
    details:
      'Extends Kubernetes ResourceQuotas with application-level awareness. Allows VMs to temporarily exceed quota during migrations and live updates.',
    version: 'v1.7.0',
    icon: 'mdi:scale-balance',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: false,
    detection: {
      crd: 'aaqs.aaq.kubevirt.io',
    },
  },
  {
    id: 'butaneOperator',
    chartVersion: '0.2.0',
    helmKey: 'butane-operator',
    name: 'Butane Operator',
    description: 'Butane to Ignition conversion for CoreOS and Flatcar VMs',
    details:
      'Converts ButaneConfig custom resources into Ignition JSON Secrets. Simplifies Fedora CoreOS, RHCOS, and Flatcar Container Linux VM provisioning with human-readable Butane YAML.',
    version: 'v0.1.1-rc2',
    icon: 'mdi:fire',
    category: 'extras',
    dependencies: [],
    defaultEnabled: true,
    detection: {
      crd: 'butaneconfigs.butane.unstable.cloud',
      altCrds: ['butaneconfigs.butane.operators.naval-group.com'],
    },
  },
  {
    id: 'vmConsoleProxy',
    chartVersion: '0.2.0',
    helmKey: 'vm-console-proxy',
    name: 'VM Console Proxy',
    description: 'Token-based console access for VMs',
    details:
      'Provides authenticated access to VM consoles via tokens. Enables external tools and scripts to connect to VM serial/VNC consoles without direct API access.',
    version: 'v0.8.0',
    icon: 'mdi:console',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: true,
    detection: {
      apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterroles/vm-console-proxy',
    },
  },
  {
    id: 'cloudProvider',
    chartVersion: '0.2.0',
    helmKey: 'cloud-provider-kubevirt',
    name: 'Cloud Provider KubeVirt',
    description: 'Kubernetes cloud provider for KubeVirt',
    details:
      'Implements the Kubernetes cloud provider interface for KubeVirt. Enables LoadBalancer services and node management for tenant clusters running on KubeVirt VMs.',
    version: 'v0.6.0',
    icon: 'mdi:cloud',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: false,
    detection: {
      deployment: { name: 'cloud-provider-kubevirt', namespace: 'kube-system' },
    },
  },
  {
    id: 'ipamController',
    chartVersion: '0.2.0',
    chartName: 'kubevirt-ipam-controller',
    helmKey: 'ipam-controller',
    name: 'IPAM Controller',
    description: 'Persistent IP addresses for VMs',
    details:
      'Manages IPAMClaim resources to provide persistent IP addresses for KubeVirt VMs across reboots and migrations. Requires cert-manager for webhook TLS.',
    version: 'v0.6.1',
    icon: 'mdi:ip-network',
    category: 'networking',
    dependencies: ['kubevirt'],
    defaultEnabled: true,
    detection: {
      crd: 'ipamclaims.k8s.cni.cncf.io',
    },
  },
  {
    id: 'monitoring',
    chartVersion: '0.2.0',
    chartName: 'kubevirt-monitoring',
    name: 'KubeVirt Monitoring',
    description: 'ServiceMonitors and PrometheusRules for KubeVirt',
    details:
      'Deploys ServiceMonitor resources to scrape KubeVirt component metrics and PrometheusRules for alerting. Requires kube-prometheus-stack or a compatible Prometheus Operator.',
    version: 'v1.8.1',
    icon: 'mdi:chart-line',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: false,
    detection: {
      crd: 'servicemonitors.monitoring.coreos.com',
      apiPath:
        '/apis/monitoring.coreos.com/v1/servicemonitors?labelSelector=kubevirt.io%2Fcomponent',
    },
  },
  {
    id: 'deleteProtection',
    chartVersion: '0.2.0',
    chartName: 'kubevirt-delete-protection',
    helmKey: 'delete-protection',
    name: 'Delete Protection',
    description: 'ValidatingAdmissionPolicy to prevent accidental VM deletion',
    details:
      'Installs a ValidatingAdmissionPolicy that blocks deletion of VirtualMachines annotated with kubevirt.io/delete-protection=true. Requires Kubernetes 1.30+.',
    version: 'v1.8.1',
    icon: 'mdi:shield-lock',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: true,
    detection: {
      apiPath:
        '/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies/kubevirt-vm-delete-protection',
    },
  },
  {
    id: 'vmTemplates',
    chartVersion: '0.2.0',
    chartName: 'kubevirt-vm-templates',
    helmKey: 'vm-templates',
    name: 'VM Templates',
    description: 'Pre-configured VirtualMachineTemplate resources',
    details:
      'Deploys a set of ready-to-use VirtualMachineTemplate resources for common OS types (Fedora, Ubuntu, Windows). Uses native KubeVirt 1.8+ template CRDs.',
    version: 'v1.8.1',
    icon: 'mdi:text-box-multiple',
    category: 'extras',
    dependencies: ['kubevirt'],
    defaultEnabled: false,
    detection: {
      crd: 'virtualmachinetemplates.kubevirt.io',
    },
  },
];

export default OPERATORS;

/** Lookup map for O(1) access by ID */
const OPERATOR_MAP = new Map(OPERATORS.map(op => [op.id, op]));

/** Get operator by ID */
export function getOperator(id: string): OperatorInfo | undefined {
  return OPERATOR_MAP.get(id);
}

/** Get the chart name in the OCI registry (kebab-case) */
export function getChartName(id: string): string {
  const op = OPERATOR_MAP.get(id);
  return op?.chartName || op?.helmKey || id;
}

/** Get the full OCI chart URL for an operator */
export function getChartUrl(id: string): string {
  return `${OCI_CHART_BASE}/${getChartName(id)}`;
}

/** Get the ArtifactHub repo name for an operator */
export function getArtifactHubRepo(id: string): string {
  const op = OPERATOR_MAP.get(id);
  return op?.artifactHubRepo || getChartName(id);
}

/** Get the Headlamp Apps URL for an operator's chart page */
export function getAppsChartUrl(id: string): string {
  // Extract cluster name from current URL hash: #/c/<cluster>/...
  const match = window.location.hash.match(/#\/c\/([^/]+)/);
  const cluster = match?.[1] || 'default';
  return `#/c/${cluster}/helm/${getArtifactHubRepo(id)}/charts/${getChartName(id)}`;
}

/** Get the chart version for an operator */
export function getChartVersion(id: string): string {
  const op = OPERATOR_MAP.get(id);
  return op?.chartVersion || '0.2.0';
}

/** Get operators grouped by category */
export function getOperatorsByCategory(): Record<OperatorCategory, OperatorInfo[]> {
  const grouped: Record<OperatorCategory, OperatorInfo[]> = {
    core: [],
    networking: [],
    storage: [],
    migration: [],
    extras: [],
  };
  for (const op of OPERATORS) {
    grouped[op.category].push(op);
  }
  return grouped;
}
