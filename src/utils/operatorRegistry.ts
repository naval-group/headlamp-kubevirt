/**
 * Static registry of KubeVirt ecosystem operators.
 * Powers both the Install Wizard and the Settings Marketplace.
 */

export type OperatorCategory = 'core' | 'networking' | 'storage' | 'migration' | 'extras';

export interface OperatorInfo {
  /** Unique ID matching the Helm subchart name */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Longer explanation shown in wizard */
  details: string;
  /** Default version from the umbrella chart */
  version: string;
  /** MDI icon name */
  icon: string;
  /** Category for grouping in the UI */
  category: OperatorCategory;
  /** Operator IDs that must be installed first */
  dependencies: string[];
  /** Enabled by default in the umbrella chart */
  defaultEnabled: boolean;
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

const OPERATORS: OperatorInfo[] = [
  // ── Core ───────────────────────────────────────────────────────────
  {
    id: 'kubevirt',
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
      namespace: 'kubevirt',
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
      namespace: 'cdi',
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
      namespace: 'kubemacpool-system',
    },
  },

  // ── Storage ────────────────────────────────────────────────────────
  {
    id: 'hostpathProvisioner',
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
      namespace: 'hostpath-provisioner',
    },
  },

  // ── Migration ──────────────────────────────────────────────────────
  {
    id: 'forklift',
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
      namespace: 'konveyor-forklift',
    },
  },

  // ── Extras ─────────────────────────────────────────────────────────
  {
    id: 'aaq',
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
      namespace: 'aaq',
    },
  },
  {
    id: 'butaneOperator',
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
    },
  },
  {
    id: 'vmConsoleProxy',
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
      deployment: { name: 'vm-console-proxy', namespace: 'kubevirt' },
    },
  },
  {
    id: 'cloudProvider',
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
];

export default OPERATORS;

/** Get operator by ID */
export function getOperator(id: string): OperatorInfo | undefined {
  return OPERATORS.find(op => op.id === id);
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

/** Topological sort respecting dependencies. Returns IDs in apply order. */
export function topologicalSort(selectedIds: Set<string>): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string) {
    if (visited.has(id) || !selectedIds.has(id)) return;
    visited.add(id);
    const op = getOperator(id);
    if (op) {
      for (const dep of op.dependencies) {
        visit(dep);
      }
    }
    result.push(id);
  }

  for (const id of selectedIds) {
    visit(id);
  }
  return result;
}

/** Get all transitive dependencies for a set of operators */
export function resolveDependencies(selectedIds: Set<string>): Set<string> {
  const resolved = new Set(selectedIds);

  function addDeps(id: string) {
    const op = getOperator(id);
    if (!op) return;
    for (const dep of op.dependencies) {
      if (!resolved.has(dep)) {
        resolved.add(dep);
        addDeps(dep);
      }
    }
  }

  for (const id of selectedIds) {
    addDeps(id);
  }
  return resolved;
}
