import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useRef, useState } from 'react';
import ResourceEditorDialog from '../components/ResourceEditorDialog';
import { LiveUpdateConfig, MigrationConfig, NetworkConfig, PermittedHostDevices } from '../types';
import {
  addLabelColumn,
  getLabelColumns,
  LabelColumn,
  removeLabelColumn,
} from '../utils/pluginSettings';
import CDI from './CDI';
import KubeVirt from './KubeVirt';

// ValidatingAdmissionPolicy for VM Delete Protection
const VM_DELETE_PROTECTION_POLICY = {
  apiVersion: 'admissionregistration.k8s.io/v1',
  kind: 'ValidatingAdmissionPolicy',
  metadata: {
    name: 'vm-delete-protection',
  },
  spec: {
    failurePolicy: 'Fail',
    matchConstraints: {
      resourceRules: [
        {
          apiGroups: ['kubevirt.io'],
          apiVersions: ['*'],
          operations: ['DELETE'],
          resources: ['virtualmachines'],
        },
      ],
    },
    validations: [
      {
        expression: `!has(oldObject.metadata.labels) || !('kubevirt.io/vm-delete-protection' in oldObject.metadata.labels) || oldObject.metadata.labels['kubevirt.io/vm-delete-protection'] != 'True'`,
        message:
          "Cannot delete VM: delete protection is enabled. Remove the label 'kubevirt.io/vm-delete-protection' first.",
      },
    ],
  },
};

const VM_DELETE_PROTECTION_BINDING = {
  apiVersion: 'admissionregistration.k8s.io/v1',
  kind: 'ValidatingAdmissionPolicyBinding',
  metadata: {
    name: 'vm-delete-protection-binding',
  },
  spec: {
    policyName: 'vm-delete-protection',
    validationActions: ['Deny'],
  },
};

// Feature gate state types
type FeatureGateState = 'GA' | 'Beta' | 'Alpha';

interface FeatureGateInfo {
  name: string;
  description: string;
  hasConfig?: boolean;
  // Version history: { version: state } - gates introduced in version with that state
  // Special values: 'removed' for deprecated/removed gates
  versionHistory: Record<string, FeatureGateState | 'removed'>;
}

// Get feature gate state for a specific version
function getGateStateForVersion(
  gate: FeatureGateInfo,
  version: string
): FeatureGateState | 'removed' | null {
  const versionParts = version.split('.').map(Number);
  const major = versionParts[0] || 1;
  const minor = versionParts[1] || 0;

  let currentState: FeatureGateState | 'removed' | null = null;

  // Sort versions and find the applicable state
  const sortedVersions = Object.keys(gate.versionHistory).sort((a, b) => {
    const [aMaj, aMin] = a.split('.').map(Number);
    const [bMaj, bMin] = b.split('.').map(Number);
    return aMaj - bMaj || aMin - bMin;
  });

  for (const v of sortedVersions) {
    const [vMaj, vMin] = v.split('.').map(Number);
    if (major > vMaj || (major === vMaj && minor >= vMin)) {
      currentState = gate.versionHistory[v];
    }
  }

  return currentState;
}

// Check if gate is available in version
function isGateAvailableInVersion(gate: FeatureGateInfo, version: string): boolean {
  const state = getGateStateForVersion(gate, version);
  return state !== null && state !== 'removed';
}

// State sort order for sorting gates
const STATE_ORDER: Record<FeatureGateState, number> = { GA: 0, Beta: 1, Alpha: 2 };

// Grouped feature gates by category with version history
const FEATURE_GATE_CATEGORIES: Record<
  string,
  { icon: string; color: string; gates: FeatureGateInfo[] }
> = {
  Storage: {
    icon: 'mdi:harddisk',
    color: '#ff9800',
    gates: [
      {
        name: 'Snapshot',
        description: 'VM snapshot and restore support',
        versionHistory: { '0.30': 'Alpha', '1.3': 'Beta' },
      },
      {
        name: 'VMExport',
        description: 'Export VMs to external storage',
        versionHistory: { '0.55': 'Alpha', '1.3': 'Beta' },
      },
      {
        name: 'HotplugVolumes',
        description: 'Hot-plug storage disks to running VMs',
        versionHistory: { '0.39': 'Alpha' },
      },
      {
        name: 'DeclarativeHotplugVolumes',
        description: 'Declarative volume hotplug via spec editing',
        versionHistory: { '1.6': 'Alpha' },
      },
      {
        name: 'ExpandDisks',
        description: 'Auto-expand VM disks when PVC is resized',
        versionHistory: { '0.51': 'Alpha' },
      },
      {
        name: 'IncrementalBackup',
        description: 'Incremental VM backups using libvirt',
        versionHistory: { '1.6': 'Alpha' },
      },
      {
        name: 'HostDisk',
        description: 'Use host disk as VM storage',
        versionHistory: { '0.9': 'Alpha' },
      },
      {
        name: 'EnableVirtioFsConfigVolumes',
        description: 'Mount ConfigMaps/Secrets via VirtioFS',
        versionHistory: { '1.3': 'Alpha' },
      },
      {
        name: 'EnableVirtioFsStorageVolumes',
        description: 'Mount PVCs via VirtioFS',
        versionHistory: { '1.3': 'Alpha' },
      },
      {
        name: 'DataVolumes',
        description: 'Enable DataVolume support for storage',
        versionHistory: { '0.17': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'VolumeMigration',
        description: 'Storage migration support',
        versionHistory: { '1.3': 'Alpha', '1.7': 'GA' },
      },
      {
        name: 'VolumesUpdateStrategy',
        description: 'Volume update strategies',
        versionHistory: { '1.3': 'Alpha', '1.7': 'GA' },
      },
      {
        name: 'UtilityVolumes',
        description: 'Hot-plug utility volumes to virt-launcher',
        versionHistory: { '1.7': 'Alpha' },
      },
    ],
  },
  Network: {
    icon: 'mdi:lan',
    color: '#2196f3',
    gates: [
      {
        name: 'LiveMigration',
        description: 'Live migration of VMs between nodes',
        hasConfig: true,
        versionHistory: { '0.3': 'Alpha', '0.42': 'Beta', '1.0': 'GA' },
      },
      {
        name: 'SRIOVLiveMigration',
        description: 'SR-IOV device migration support',
        versionHistory: { '0.42': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'HotplugNICs',
        description: 'Hot-plug network interfaces to running VMs',
        versionHistory: { '1.1': 'Alpha', '1.3': 'Beta', '1.4': 'GA' },
      },
      {
        name: 'NetworkBindingPlugins',
        description: 'Custom network binding plugins',
        versionHistory: { '1.1': 'Alpha', '1.4': 'Beta', '1.5': 'GA' },
      },
      {
        name: 'DynamicPodInterfaceNaming',
        description: 'Dynamic primary pod interface detection',
        versionHistory: { '1.4': 'Beta', '1.5': 'GA' },
      },
      {
        name: 'PasstIPStackMigration',
        description: 'Seamless migration with passt network binding',
        versionHistory: { '1.6': 'Alpha' },
      },
    ],
  },
  Compute: {
    icon: 'mdi:cpu-64-bit',
    color: '#9c27b0',
    gates: [
      {
        name: 'NUMA',
        description: 'NUMA topology awareness for multi-socket servers',
        versionHistory: { '0.44': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'CPUManager',
        description: 'CPU pinning and dedicated CPU allocation',
        versionHistory: { '0.35': 'Alpha' },
      },
      {
        name: 'CPUNodeDiscovery',
        description: 'Automatic CPU feature discovery',
        versionHistory: { '0.37': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'VMLiveUpdateFeatures',
        description: 'Hot-plug CPU sockets to running VMs',
        versionHistory: { '1.0': 'Alpha', '1.5': 'GA' },
      },
      {
        name: 'AlignCPUs',
        description: 'Align CPUs for emulator thread even parity',
        versionHistory: { '1.2': 'Alpha' },
      },
      {
        name: 'DownwardMetrics',
        description: 'Expose host metrics inside guest',
        versionHistory: { '0.42': 'Alpha' },
      },
      {
        name: 'AutoResourceLimitsGate',
        description: 'Auto-set VMI limits from namespace ResourceQuota',
        versionHistory: { '1.1': 'Alpha', '1.5': 'GA' },
      },
    ],
  },
  Devices: {
    icon: 'mdi:expansion-card',
    color: '#4caf50',
    gates: [
      {
        name: 'HostDevices',
        description: 'PCI/USB passthrough to VMs',
        hasConfig: true,
        versionHistory: { '0.31': 'Alpha' },
      },
      {
        name: 'GPU',
        description: 'GPU passthrough support',
        versionHistory: { '0.24': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'VSOCK',
        description: 'VM sockets for host-guest communication',
        versionHistory: { '1.0': 'Alpha' },
      },
      {
        name: 'GPUsWithDRA',
        description: 'DRA-provisioned GPU allocation',
        versionHistory: { '1.6': 'Alpha' },
      },
      {
        name: 'HostDevicesWithDRA',
        description: 'DRA-provisioned host device allocation',
        versionHistory: { '1.6': 'Alpha' },
      },
      {
        name: 'DisableMDEVConfiguration',
        description: 'Disable mediated device handling',
        versionHistory: { '1.0': 'Alpha' },
      },
      {
        name: 'PanicDevices',
        description: 'Panic device support for crash signaling',
        versionHistory: { '1.6': 'Alpha', '1.7': 'Beta' },
      },
    ],
  },
  Security: {
    icon: 'mdi:shield-lock',
    color: '#f44336',
    gates: [
      {
        name: 'KubevirtSeccompProfile',
        description: 'Custom seccomp profile for virt-launcher',
        versionHistory: { '0.54': 'Alpha', '1.7': 'Beta' },
      },
      {
        name: 'WorkloadEncryptionSEV',
        description: 'AMD SEV memory encryption',
        versionHistory: { '0.48': 'Alpha' },
      },
      {
        name: 'WorkloadEncryptionTDX',
        description: 'Intel TDX memory encryption',
        versionHistory: { '1.3': 'Alpha' },
      },
      {
        name: 'Root',
        description: 'Run virt-launcher as root',
        versionHistory: { '0.45': 'Alpha' },
      },
      {
        name: 'NonRoot',
        description: 'Run virt-launcher as non-root (security)',
        versionHistory: { '0.25': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'PSA',
        description: 'Pod Security Admission compliance',
        versionHistory: { '0.58': 'Alpha', '1.0': 'GA' },
      },
      {
        name: 'SecureExecution',
        description: 'IBM Z secure execution',
        versionHistory: { '1.6': 'Alpha', '1.7': 'Beta' },
      },
      {
        name: 'DisableCustomSELinuxPolicy',
        description: 'Disable custom SELinux policy for virt-launcher',
        versionHistory: { '1.0': 'Alpha', '1.7': 'GA' },
      },
    ],
  },
  Migration: {
    icon: 'mdi:airplane',
    color: '#00bcd4',
    gates: [
      {
        name: 'DecentralizedLiveMigration',
        description: 'Cross-cluster live migration',
        versionHistory: { '1.5': 'Alpha' },
      },
      {
        name: 'MigrationPriorityQueue',
        description: 'Prioritize system migrations over user migrations',
        versionHistory: { '1.7': 'Alpha' },
      },
      {
        name: 'VMPersistentState',
        description: 'Persist VM state (vTPM) across migrations',
        versionHistory: { '1.1': 'Alpha', '1.7': 'GA' },
      },
      {
        name: 'NodeRestriction',
        description: 'Node restriction for virt-handler (like Kubelet)',
        versionHistory: { '1.3': 'Alpha', '1.7': 'Beta' },
      },
    ],
  },
  Display: {
    icon: 'mdi:monitor',
    color: '#607d8b',
    gates: [
      {
        name: 'VideoConfig',
        description: 'Custom video device types (virtio, vga, bochs)',
        versionHistory: { '1.6': 'Alpha', '1.7': 'Beta' },
      },
      {
        name: 'BochsDisplayForEFIGuests',
        description: 'Bochs display for EFI guests instead of VGA',
        versionHistory: { '0.58': 'Alpha', '1.4': 'GA' },
      },
    ],
  },
  Other: {
    icon: 'mdi:cog',
    color: '#795548',
    gates: [
      {
        name: 'Sidecar',
        description: 'Sidecar container hook support',
        versionHistory: { '0.23': 'Alpha' },
      },
      {
        name: 'ImageVolume',
        description: 'Kubernetes native ImageVolume for containerDisks',
        versionHistory: { '1.6': 'Alpha', '1.7': 'Beta' },
      },
      {
        name: 'ExperimentalIgnitionSupport',
        description: 'Ignition cloud-init alternative',
        versionHistory: { '0.14': 'Alpha' },
      },
      {
        name: 'HypervStrictCheck',
        description: 'Strict Hyper-V feature checking',
        versionHistory: { '0.40': 'Alpha' },
      },
      {
        name: 'PersistentReservation',
        description: 'SCSI persistent reservation (pr-helper)',
        versionHistory: { '1.0': 'Alpha' },
      },
      {
        name: 'ObjectGraph',
        description: 'VM/VMI object dependency graph subresource',
        versionHistory: { '1.6': 'Alpha' },
      },
      {
        name: 'CommonInstancetypesDeploymentGate',
        description: 'Deploy common instance types',
        versionHistory: { '1.1': 'Alpha', '1.2': 'Beta', '1.4': 'GA' },
      },
      {
        name: 'InstancetypeReferencePolicy',
        description: 'Instance type reference control',
        versionHistory: { '1.4': 'Alpha', '1.5': 'Beta', '1.6': 'GA' },
      },
      {
        name: 'ClusterProfiler',
        description: 'Cluster profiling tools',
        versionHistory: { '1.0': 'Alpha', '1.7': 'GA' },
      },
      {
        name: 'MultiArchitecture',
        description: 'Multi-architecture VM scheduling support',
        versionHistory: { '1.0': 'Alpha' },
      },
    ],
  },
};

// Get all known feature gate names for filtering
const ALL_KNOWN_GATES = Object.values(FEATURE_GATE_CATEGORIES).flatMap(category =>
  category.gates.map(g => g.name)
);

export default function KubeVirtSettings() {
  const { enqueueSnackbar } = useSnackbar();
  const [updating, setUpdating] = useState(false);
  const [migrationConfigExpanded, setMigrationConfigExpanded] = useState(false);
  const [pluginFeaturesExpanded, setPluginFeaturesExpanded] = useState(false);
  const [deleteProtectionModalOpen, setDeleteProtectionModalOpen] = useState(false);
  const [deleteProtectionDeployed, setDeleteProtectionDeployed] = useState<boolean | null>(null);
  const [deleteProtectionLoading, setDeleteProtectionLoading] = useState(false);
  const [sidebarReloadWarnings, setSidebarReloadWarnings] = useState<string[]>([]);
  const [labelColumns, setLabelColumns] = useState<LabelColumn[]>([]);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelKey, setNewLabelKey] = useState('');
  const [labelColumnsExpanded, setLabelColumnsExpanded] = useState(false);

  // Load label columns from localStorage
  useEffect(() => {
    setLabelColumns(getLabelColumns());
  }, []);

  // Check if VM Delete Protection VAP is deployed
  useEffect(() => {
    const checkDeleteProtection = async () => {
      try {
        await ApiProxy.request(
          '/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies/vm-delete-protection'
        );
        setDeleteProtectionDeployed(true);
      } catch (error: unknown) {
        if ((error as { status?: number }).status === 404) {
          setDeleteProtectionDeployed(false);
        } else {
          console.error('Error checking delete protection status:', error);
          setDeleteProtectionDeployed(false);
        }
      }
    };
    checkDeleteProtection();
  }, []);

  const handleDeployDeleteProtection = async () => {
    setDeleteProtectionLoading(true);
    try {
      // Create the ValidatingAdmissionPolicy
      await ApiProxy.request('/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies', {
        method: 'POST',
        body: JSON.stringify(VM_DELETE_PROTECTION_POLICY),
        headers: { 'Content-Type': 'application/json' },
      });

      // Create the ValidatingAdmissionPolicyBinding
      await ApiProxy.request(
        '/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings',
        {
          method: 'POST',
          body: JSON.stringify(VM_DELETE_PROTECTION_BINDING),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      setDeleteProtectionDeployed(true);
      enqueueSnackbar('VM Delete Protection deployed successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to deploy delete protection:', error);
      enqueueSnackbar(`Failed to deploy delete protection: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setDeleteProtectionLoading(false);
      setDeleteProtectionModalOpen(false);
    }
  };

  const handleUndeployDeleteProtection = async () => {
    setDeleteProtectionLoading(true);
    try {
      // Delete the binding first
      await ApiProxy.request(
        '/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings/vm-delete-protection-binding',
        { method: 'DELETE' }
      );

      // Delete the policy
      await ApiProxy.request(
        '/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies/vm-delete-protection',
        { method: 'DELETE' }
      );

      setDeleteProtectionDeployed(false);
      enqueueSnackbar('VM Delete Protection removed successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to remove delete protection:', error);
      enqueueSnackbar(`Failed to remove delete protection: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setDeleteProtectionLoading(false);
      setDeleteProtectionModalOpen(false);
    }
  };
  const [generalConfigExpanded, setGeneralConfigExpanded] = useState(false);
  const [liveUpdateConfigExpanded, setLiveUpdateConfigExpanded] = useState(false);
  const [networkConfigExpanded, setNetworkConfigExpanded] = useState(false);
  const [hostDevicesConfigExpanded, setHostDevicesConfigExpanded] = useState(false);
  const [kubeVirtEditorOpen, setKubeVirtEditorOpen] = useState(false);
  const [cdiEditorOpen, setCdiEditorOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Fetch KubeVirt CR - typically in kubevirt namespace
  let kubeVirtItems: InstanceType<typeof KubeVirt>[] = [];
  let kvError: unknown = null;
  try {
    const result = KubeVirt.useList({ namespace: 'kubevirt' });
    kubeVirtItems = result.items || [];
    kvError = result.error;
  } catch (error) {
    console.error('Error fetching KubeVirt:', error);
    kvError = error;
  }
  const kubeVirt = kubeVirtItems && kubeVirtItems.length > 0 ? kubeVirtItems[0] : null;

  // Fetch CDI CR - typically cluster-scoped or in cdi namespace
  let cdiItems: InstanceType<typeof CDI>[] = [];
  try {
    const result = CDI.useList();
    cdiItems = result.items || [];
    if (result.error) {
      // CDI may not be installed
    }
  } catch (error) {
    console.error('Error fetching CDI:', error);
  }
  const cdi = cdiItems && cdiItems.length > 0 ? cdiItems[0] : null;

  // Get all configs safely (before any conditional returns to satisfy React hooks rules)
  const migrationConfig = kubeVirt?.getMigrationConfig() || {};
  const liveUpdateConfig = kubeVirt?.getLiveUpdateConfig() || {};
  const networkConfig = kubeVirt?.getNetworkConfig() || {};
  const commonInstancetypesEnabled = kubeVirt?.getCommonInstancetypesEnabled() || false;
  const memoryOvercommit = kubeVirt?.getMemoryOvercommit() || 100;
  const evictionStrategy = kubeVirt?.getEvictionStrategy() || '';

  // Local state for migration config form - MUST be declared before any conditional returns
  const [localMigrationConfig, setLocalMigrationConfig] = useState({
    parallelMigrationsPerCluster: migrationConfig.parallelMigrationsPerCluster || '',
    parallelOutboundMigrationsPerNode: migrationConfig.parallelOutboundMigrationsPerNode || '',
    bandwidthPerMigration: migrationConfig.bandwidthPerMigration || '',
    network: migrationConfig.network || '',
    progressTimeout: migrationConfig.progressTimeout || '',
    completionTimeoutPerGiB: migrationConfig.completionTimeoutPerGiB || '',
    allowAutoConverge: migrationConfig.allowAutoConverge || false,
    allowPostCopy: migrationConfig.allowPostCopy || false,
  });

  // State for general configuration
  const [localCommonInstancetypes, setLocalCommonInstancetypes] = useState(
    commonInstancetypesEnabled
  );
  const [localMemoryOvercommit, setLocalMemoryOvercommit] = useState(memoryOvercommit);
  const [localEvictionStrategy, setLocalEvictionStrategy] = useState(evictionStrategy);

  // State for Prometheus monitoring configuration
  const [localMonitorNamespace, setLocalMonitorNamespace] = useState(
    kubeVirt?.getMonitorNamespace() || ''
  );
  const [localMonitorAccount, setLocalMonitorAccount] = useState(
    kubeVirt?.getMonitorAccount() || ''
  );
  const [localHelmRelease, setLocalHelmRelease] = useState('');
  const [monitoringNamespaces, setMonitoringNamespaces] = useState<string[]>([]);
  const [monitoringServiceAccounts, setMonitoringServiceAccounts] = useState<string[]>([]);

  // State for live update configuration
  const [localLiveUpdateConfig, setLocalLiveUpdateConfig] = useState({
    maxCpuSockets: liveUpdateConfig.maxCpuSockets || '',
    maxHotplugRatio: liveUpdateConfig.maxHotplugRatio || '',
  });

  // State for network configuration
  const [localNetworkConfig, setLocalNetworkConfig] = useState({
    defaultNetworkInterface: networkConfig.defaultNetworkInterface || '',
    permitBridgeInterfaceOnPodNetwork: networkConfig.permitBridgeInterfaceOnPodNetwork || false,
    permitSlirpInterface: networkConfig.permitSlirpInterface || false,
  });

  // State for host devices configuration
  const [localPciDevices, setLocalPciDevices] = useState<
    Array<{ pciVendorSelector: string; resourceName: string; externalResourceProvider?: boolean }>
  >(kubeVirt?.getPciHostDevices() || []);
  const [localMediatedDevices, setLocalMediatedDevices] = useState<
    Array<{ mdevNameSelector: string; resourceName: string; externalResourceProvider?: boolean }>
  >(kubeVirt?.getMediatedDevices() || []);
  const [newPciDevice, setNewPciDevice] = useState({ pciVendorSelector: '', resourceName: '' });
  const [newMediatedDevice, setNewMediatedDevice] = useState({
    mdevNameSelector: '',
    resourceName: '',
  });

  // Track if initial data has been loaded to update local state
  const initialLoadRef = useRef(false);

  // Update local state when KubeVirt data loads
  useEffect(() => {
    if (kubeVirt && !initialLoadRef.current) {
      initialLoadRef.current = true;
      setLocalCommonInstancetypes(kubeVirt.getCommonInstancetypesEnabled());
      setLocalMemoryOvercommit(kubeVirt.getMemoryOvercommit());
      setLocalEvictionStrategy(kubeVirt.getEvictionStrategy());

      const migConfig = kubeVirt.getMigrationConfig();
      setLocalMigrationConfig({
        parallelMigrationsPerCluster: migConfig.parallelMigrationsPerCluster || '',
        parallelOutboundMigrationsPerNode: migConfig.parallelOutboundMigrationsPerNode || '',
        bandwidthPerMigration: migConfig.bandwidthPerMigration || '',
        network: migConfig.network || '',
        progressTimeout: migConfig.progressTimeout || '',
        completionTimeoutPerGiB: migConfig.completionTimeoutPerGiB || '',
        allowAutoConverge: migConfig.allowAutoConverge || false,
        allowPostCopy: migConfig.allowPostCopy || false,
      });

      const liveConfig = kubeVirt.getLiveUpdateConfig();
      setLocalLiveUpdateConfig({
        maxCpuSockets: liveConfig.maxCpuSockets || '',
        maxHotplugRatio: liveConfig.maxHotplugRatio || '',
      });

      const netConfig = kubeVirt.getNetworkConfig();
      setLocalNetworkConfig({
        defaultNetworkInterface: netConfig.defaultNetworkInterface || '',
        permitBridgeInterfaceOnPodNetwork: netConfig.permitBridgeInterfaceOnPodNetwork || false,
        permitSlirpInterface: netConfig.permitSlirpInterface || false,
      });

      setLocalPciDevices(kubeVirt.getPciHostDevices());
      setLocalMediatedDevices(kubeVirt.getMediatedDevices());

      setLocalMonitorNamespace(kubeVirt.getMonitorNamespace());
      setLocalMonitorAccount(kubeVirt.getMonitorAccount());

      // Try to read the existing release label from the auto-created ServiceMonitor
      if (kubeVirt.getMonitorNamespace()) {
        ApiProxy.request(
          `/apis/monitoring.coreos.com/v1/namespaces/${kubeVirt.getMonitorNamespace()}/servicemonitors`
        )
          .then(
            (resp: {
              items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
            }) => {
              const sm = resp?.items?.find(s => s.metadata.name.includes('kubevirt'));
              if (sm?.metadata?.labels?.release) {
                setLocalHelmRelease(sm.metadata.labels.release);
              }
            }
          )
          .catch(() => {});
      }
    }
  }, [kubeVirt]);

  // Fetch namespaces and service accounts for monitoring config
  useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
        setMonitoringNamespaces(resp?.items?.map(ns => ns.metadata.name) || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!localMonitorNamespace) {
      setMonitoringServiceAccounts([]);
      return;
    }
    ApiProxy.request(`/api/v1/namespaces/${localMonitorNamespace}/serviceaccounts`)
      .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
        setMonitoringServiceAccounts(
          resp?.items?.map(sa => sa.metadata.name).filter(n => n.includes('prometheus')) || []
        );
      })
      .catch(() => setMonitoringServiceAccounts([]));
  }, [localMonitorNamespace]);

  // Now we can safely return early if there are errors
  if (kvError) {
    return (
      <Box p={3}>
        <Alert severity="error">
          Failed to load KubeVirt configuration:{' '}
          {(kvError as Error)?.message || String(kvError) || 'Unknown error'}
        </Alert>
        <Typography variant="body2" color="text.secondary" mt={2}>
          Make sure KubeVirt is installed in the 'kubevirt' namespace.
        </Typography>
      </Box>
    );
  }

  if (!kubeVirt) {
    return (
      <Box p={3}>
        <Alert severity="warning">
          KubeVirt CR not found in 'kubevirt' namespace. Make sure KubeVirt is properly installed.
        </Alert>
      </Box>
    );
  }

  const enabledFeatureGates = kubeVirt.getFeatureGates();

  const handleFeatureGateToggle = async (featureGate: string, enabled: boolean) => {
    setUpdating(true);
    try {
      let newFeatureGates: string[];
      if (enabled) {
        newFeatureGates = [...enabledFeatureGates, featureGate];
      } else {
        newFeatureGates = enabledFeatureGates.filter(fg => fg !== featureGate);
      }

      await kubeVirt.updateFeatureGates(newFeatureGates);

      // Add inline warning for features that affect sidebar
      const sidebarFeatures = ['Snapshot', 'VMExport', 'DataVolumes', 'LiveMigration'];
      if (sidebarFeatures.includes(featureGate) && !sidebarReloadWarnings.includes(featureGate)) {
        setSidebarReloadWarnings([...sidebarReloadWarnings, featureGate]);
      }
    } catch (error: unknown) {
      console.error('Failed to update feature gates', error);
      enqueueSnackbar(`Failed to update feature gate: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleMigrationConfigUpdate = async () => {
    setUpdating(true);
    try {
      // Build the migration config object, excluding empty values
      const newMigrationConfig: MigrationConfig = {};
      if (localMigrationConfig.parallelMigrationsPerCluster)
        newMigrationConfig.parallelMigrationsPerCluster = parseInt(
          localMigrationConfig.parallelMigrationsPerCluster as string
        );
      if (localMigrationConfig.parallelOutboundMigrationsPerNode)
        newMigrationConfig.parallelOutboundMigrationsPerNode = parseInt(
          localMigrationConfig.parallelOutboundMigrationsPerNode as string
        );
      if (localMigrationConfig.bandwidthPerMigration)
        newMigrationConfig.bandwidthPerMigration = localMigrationConfig.bandwidthPerMigration;
      if (localMigrationConfig.network) newMigrationConfig.network = localMigrationConfig.network;
      if (localMigrationConfig.progressTimeout)
        newMigrationConfig.progressTimeout = parseInt(
          localMigrationConfig.progressTimeout as string
        );
      if (localMigrationConfig.completionTimeoutPerGiB)
        newMigrationConfig.completionTimeoutPerGiB = parseInt(
          localMigrationConfig.completionTimeoutPerGiB as string
        );
      newMigrationConfig.allowAutoConverge = localMigrationConfig.allowAutoConverge;
      newMigrationConfig.allowPostCopy = localMigrationConfig.allowPostCopy;

      await kubeVirt.updateMigrationConfig(newMigrationConfig);
      enqueueSnackbar('Migration configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update migration configuration', error);
      enqueueSnackbar(`Failed to update migration configuration: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleCommonInstancetypesToggle = async (enabled: boolean) => {
    setUpdating(true);
    try {
      await kubeVirt.updateCommonInstancetypes(enabled);
      setLocalCommonInstancetypes(enabled);
      enqueueSnackbar(`Common instance types ${enabled ? 'enabled' : 'disabled'} successfully`, {
        variant: 'success',
      });
    } catch (error: unknown) {
      console.error('Failed to update common instance types', error);
      enqueueSnackbar(`Failed to update common instance types: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleMemoryOvercommitUpdate = async () => {
    setUpdating(true);
    try {
      await kubeVirt.updateMemoryOvercommit(localMemoryOvercommit);
      enqueueSnackbar('Memory overcommit updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update memory overcommit', error);
      enqueueSnackbar(`Failed to update memory overcommit: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleEvictionStrategyUpdate = async () => {
    setUpdating(true);
    try {
      await kubeVirt.updateEvictionStrategy(localEvictionStrategy);
      enqueueSnackbar('Eviction strategy updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update eviction strategy', error);
      enqueueSnackbar(`Failed to update eviction strategy: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleMonitoringConfigUpdate = async () => {
    setUpdating(true);
    try {
      await kubeVirt.updateMonitoringConfig(localMonitorNamespace, localMonitorAccount);

      // If a Helm release name is provided, patch the ServiceMonitor with the release label
      // after a short delay to let the KubeVirt operator create it
      if (localHelmRelease && localMonitorNamespace) {
        setTimeout(async () => {
          try {
            const smResp = (await ApiProxy.request(
              `/apis/monitoring.coreos.com/v1/namespaces/${localMonitorNamespace}/servicemonitors`
            )) as { items?: Array<{ metadata: { name: string; namespace: string } }> };
            const sm = smResp?.items?.find(s => s.metadata.name.includes('kubevirt'));
            if (sm) {
              await ApiProxy.request(
                `/apis/monitoring.coreos.com/v1/namespaces/${sm.metadata.namespace}/servicemonitors/${sm.metadata.name}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/merge-patch+json' },
                  body: JSON.stringify({
                    metadata: { labels: { release: localHelmRelease } },
                  }),
                }
              );
              enqueueSnackbar(
                `ServiceMonitor labeled with release="${localHelmRelease}" for Prometheus discovery.`,
                { variant: 'info' }
              );
            }
          } catch (labelError) {
            console.warn('Could not label ServiceMonitor:', labelError);
            enqueueSnackbar(
              'Monitoring configured, but could not label the ServiceMonitor. You may need to add the release label manually.',
              { variant: 'warning' }
            );
          }
        }, 3000);
      }

      enqueueSnackbar(
        'Prometheus monitoring configuration updated. KubeVirt will create the ServiceMonitor automatically.',
        {
          variant: 'success',
        }
      );
    } catch (error: unknown) {
      console.error('Failed to update monitoring config', error);
      enqueueSnackbar(`Failed to update monitoring config: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleLiveUpdateConfigUpdate = async () => {
    setUpdating(true);
    try {
      const newLiveUpdateConfig: LiveUpdateConfig = {};
      if (localLiveUpdateConfig.maxCpuSockets)
        newLiveUpdateConfig.maxCpuSockets = parseInt(localLiveUpdateConfig.maxCpuSockets as string);
      if (localLiveUpdateConfig.maxHotplugRatio)
        newLiveUpdateConfig.maxHotplugRatio = parseInt(
          localLiveUpdateConfig.maxHotplugRatio as string
        );

      await kubeVirt.updateLiveUpdateConfig(newLiveUpdateConfig);
      enqueueSnackbar('Live update configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update live update configuration', error);
      enqueueSnackbar(`Failed to update live update configuration: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleNetworkConfigUpdate = async () => {
    setUpdating(true);
    try {
      const newNetworkConfig: NetworkConfig = {};
      if (localNetworkConfig.defaultNetworkInterface)
        newNetworkConfig.defaultNetworkInterface = localNetworkConfig.defaultNetworkInterface;
      newNetworkConfig.permitBridgeInterfaceOnPodNetwork =
        localNetworkConfig.permitBridgeInterfaceOnPodNetwork;
      newNetworkConfig.permitSlirpInterface = localNetworkConfig.permitSlirpInterface;

      await kubeVirt.updateNetworkConfig(newNetworkConfig);
      enqueueSnackbar('Network configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update network configuration', error);
      enqueueSnackbar(`Failed to update network configuration: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleHostDevicesConfigUpdate = async () => {
    setUpdating(true);
    try {
      const permittedHostDevices: PermittedHostDevices = {};
      if (localPciDevices.length > 0) {
        permittedHostDevices.pciHostDevices = localPciDevices;
      }
      if (localMediatedDevices.length > 0) {
        permittedHostDevices.mediatedDevices = localMediatedDevices;
      }

      await kubeVirt.updatePermittedHostDevices(
        Object.keys(permittedHostDevices).length > 0 ? permittedHostDevices : undefined
      );
      enqueueSnackbar('Host devices configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update host devices configuration', error);
      enqueueSnackbar(`Failed to update host devices configuration: ${(error as Error).message}`, {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const addPciDevice = () => {
    if (newPciDevice.pciVendorSelector && newPciDevice.resourceName) {
      setLocalPciDevices([...localPciDevices, { ...newPciDevice }]);
      setNewPciDevice({ pciVendorSelector: '', resourceName: '' });
    }
  };

  const removePciDevice = (index: number) => {
    setLocalPciDevices(localPciDevices.filter((_, i) => i !== index));
  };

  const addMediatedDevice = () => {
    if (newMediatedDevice.mdevNameSelector && newMediatedDevice.resourceName) {
      setLocalMediatedDevices([...localMediatedDevices, { ...newMediatedDevice }]);
      setNewMediatedDevice({ mdevNameSelector: '', resourceName: '' });
    }
  };

  const removeMediatedDevice = (index: number) => {
    setLocalMediatedDevices(localMediatedDevices.filter((_, i) => i !== index));
  };

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        KubeVirt Configuration
      </Typography>

      {/* Version Information */}
      <SectionBox title="Version Information">
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
          <Card variant="outlined">
            <CardContent>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Icon icon="mdi:kubernetes" width={32} height={32} color="#326CE5" />
                <Typography variant="h6" sx={{ flexGrow: 1 }}>
                  KubeVirt
                </Typography>
                <Tooltip title="Edit KubeVirt CR">
                  <IconButton
                    size="small"
                    onClick={() => setKubeVirtEditorOpen(true)}
                    sx={{ ml: 'auto' }}
                  >
                    <Icon icon="mdi:pencil" width={18} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Version
                </Typography>
                <Chip label={kubeVirt.getVersion()} color="primary" size="small" />
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Status
                </Typography>
                <Chip
                  label={kubeVirt.getPhase()}
                  color={kubeVirt.getPhase() === 'Ready' ? 'success' : 'warning'}
                  size="small"
                />
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Namespace
                </Typography>
                <Chip label={kubeVirt.getNamespace()} size="small" variant="outlined" />
              </Box>
            </CardContent>
          </Card>

          {cdi && (
            <Card variant="outlined">
              <CardContent>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Icon icon="mdi:harddisk" width={32} height={32} color="#FF6F00" />
                  <Typography variant="h6" sx={{ flexGrow: 1 }}>
                    CDI (Containerized Data Importer)
                  </Typography>
                  <Tooltip title="Edit CDI CR">
                    <IconButton
                      size="small"
                      onClick={() => setCdiEditorOpen(true)}
                      sx={{ ml: 'auto' }}
                    >
                      <Icon icon="mdi:pencil" width={18} />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="body2" color="text.secondary">
                    Version
                  </Typography>
                  <Chip label={cdi.getVersion()} color="primary" size="small" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="body2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    label={cdi.getPhase()}
                    color={cdi.getPhase() === 'Deployed' ? 'success' : 'warning'}
                    size="small"
                  />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    Feature Gates
                  </Typography>
                  <Chip label={cdi.getFeatureGates().length} size="small" variant="outlined" />
                </Box>
              </CardContent>
            </Card>
          )}
        </Box>
      </SectionBox>

      {/* Plugin Features */}
      <Box
        mt={3}
        sx={{
          backgroundColor: 'rgba(156, 39, 176, 0.05)',
          borderRadius: '4px',
          border: '1px solid rgba(156, 39, 176, 0.2)',
        }}
      >
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          p={2}
          sx={{
            cursor: 'pointer',
          }}
          onClick={() => setPluginFeaturesExpanded(!pluginFeaturesExpanded)}
        >
          <Icon
            icon="mdi:puzzle"
            width={28}
            height={28}
            style={{ color: pluginFeaturesExpanded ? '#9c27b0' : '#9e9e9e' }}
          />
          <Typography variant="h6" flex={1}>
            Plugin Features
          </Typography>
          <Chip
            label="Headlamp Plugin"
            size="small"
            sx={{
              backgroundColor: 'rgba(156, 39, 176, 0.2)',
              color: '#ce93d8',
              borderColor: '#9c27b0',
            }}
            variant="outlined"
          />
          <Icon
            icon={pluginFeaturesExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
            width={24}
            height={24}
          />
        </Box>

        <Collapse in={pluginFeaturesExpanded}>
          <Box p={2} pt={0}>
            <Alert severity="info" sx={{ mb: 2 }}>
              These features are provided by the Headlamp KubeVirt plugin and deploy additional
              Kubernetes resources to enable functionality.
            </Alert>

            {/* VM Delete Protection */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Box flex={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body1" fontWeight={500}>
                        VM Delete Protection
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteProtectionModalOpen(true);
                        }}
                      >
                        <Icon icon="mdi:information-outline" width={20} height={20} />
                      </IconButton>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Prevent accidental deletion of VMs using ValidatingAdmissionPolicy
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    {deleteProtectionDeployed === null ? (
                      <Typography variant="body2" color="text.secondary">
                        Checking...
                      </Typography>
                    ) : (
                      <>
                        <Chip
                          label={deleteProtectionDeployed ? 'Deployed' : 'Not Deployed'}
                          color={deleteProtectionDeployed ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                        <Button
                          variant={deleteProtectionDeployed ? 'outlined' : 'contained'}
                          size="small"
                          color={deleteProtectionDeployed ? 'error' : 'primary'}
                          onClick={() => setDeleteProtectionModalOpen(true)}
                          disabled={deleteProtectionLoading}
                        >
                          {deleteProtectionDeployed ? 'Remove' : 'Deploy'}
                        </Button>
                      </>
                    )}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </Collapse>
      </Box>

      {/* Custom Label Columns */}
      <Box
        mt={3}
        sx={{
          backgroundColor: 'rgba(76, 175, 80, 0.05)',
          borderRadius: '4px',
          border: '1px solid rgba(76, 175, 80, 0.2)',
          p: 2,
        }}
      >
        <Box
          display="flex"
          alignItems="center"
          gap={2}
          sx={{
            cursor: 'pointer',
          }}
          onClick={() => setLabelColumnsExpanded(!labelColumnsExpanded)}
        >
          <Icon
            icon="mdi:table-column-plus-after"
            width={28}
            height={28}
            style={{ color: labelColumnsExpanded ? '#4caf50' : '#9e9e9e' }}
          />
          <Typography variant="h6" flex={1}>
            VM List Custom Columns
          </Typography>
          <Chip
            label="Plugin Setting"
            size="small"
            sx={{
              backgroundColor: 'rgba(76, 175, 80, 0.1)',
              color: '#4caf50',
              fontWeight: 500,
            }}
          />
          <Icon
            icon={labelColumnsExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
            width={24}
            height={24}
          />
        </Box>

        <Collapse in={labelColumnsExpanded}>
          <Box p={2} pt={2}>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Add custom columns to the VM list based on Kubernetes labels. These columns will show
              the value of the specified label for each VM.
            </Typography>

            {/* Add new column form */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={500} mb={2}>
                  Add New Column
                </Typography>
                <Grid container spacing={2} alignItems="flex-end">
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Column Name"
                      placeholder="e.g., App"
                      value={newLabelName}
                      onChange={e => setNewLabelName(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={5}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Label Key"
                      placeholder="e.g., app.kubernetes.io/name"
                      value={newLabelKey}
                      onChange={e => setNewLabelKey(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <Button
                      fullWidth
                      variant="contained"
                      size="small"
                      disabled={!newLabelName || !newLabelKey}
                      onClick={() => {
                        addLabelColumn({ label: newLabelName, labelKey: newLabelKey });
                        setLabelColumns(getLabelColumns());
                        setNewLabelName('');
                        setNewLabelKey('');
                      }}
                      startIcon={<Icon icon="mdi:plus" />}
                    >
                      Add
                    </Button>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Current columns list */}
            {labelColumns.length > 0 ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={500} mb={2}>
                    Current Custom Columns
                  </Typography>
                  <Box display="flex" flexDirection="column" gap={1}>
                    {labelColumns.map(col => (
                      <Box
                        key={col.labelKey}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        p={1}
                        sx={{
                          backgroundColor: 'rgba(0, 0, 0, 0.02)',
                          borderRadius: '4px',
                        }}
                      >
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {col.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {col.labelKey}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            removeLabelColumn(col.labelKey);
                            setLabelColumns(getLabelColumns());
                          }}
                        >
                          <Icon icon="mdi:delete" width={20} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            ) : (
              <Alert severity="info" icon={<Icon icon="mdi:information" width={22} />}>
                No custom columns configured. Add a column above to display label values in the VM
                list.
              </Alert>
            )}
          </Box>
        </Collapse>
      </Box>

      {/* General Configuration */}
      <Box
        mt={3}
        sx={{
          backgroundColor: 'rgba(33, 150, 243, 0.05)',
          borderRadius: '4px',
          border: '1px solid rgba(33, 150, 243, 0.2)',
        }}
      >
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          p={2}
          sx={{
            cursor: 'pointer',
          }}
          onClick={() => setGeneralConfigExpanded(!generalConfigExpanded)}
        >
          <Icon
            icon="mdi:cog"
            width={28}
            height={28}
            style={{ color: generalConfigExpanded ? '#2196f3' : '#9e9e9e' }}
          />
          <Typography variant="h6" flex={1}>
            General Configuration
          </Typography>
          <Icon
            icon={generalConfigExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
            width={24}
            height={24}
          />
        </Box>

        <Collapse in={generalConfigExpanded}>
          <Box p={2} pt={0}>
            {/* Prometheus Monitoring */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Icon icon="mdi:chart-line" width={22} height={22} style={{ color: '#ff9800' }} />
                  <Typography variant="body1" fontWeight={500}>
                    Prometheus Monitoring
                  </Typography>
                  {kubeVirt?.getMonitorNamespace() ? (
                    <Chip
                      icon={<Icon icon="mdi:check-circle" width={16} height={16} />}
                      label="Configured"
                      size="small"
                      color="success"
                    />
                  ) : (
                    <Chip label="Not Configured" size="small" color="warning" variant="outlined" />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Configure KubeVirt to automatically create a ServiceMonitor for Prometheus. This
                  enables VM metrics (CPU, Memory, Network, Storage) in the Overview and VM Details
                  pages.
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={monitoringNamespaces}
                      value={localMonitorNamespace || null}
                      onChange={(_, newValue) => {
                        setLocalMonitorNamespace(newValue || '');
                        setLocalMonitorAccount('');
                      }}
                      renderInput={params => (
                        <TextField
                          {...params}
                          label="Monitor Namespace"
                          helperText="Namespace where Prometheus is deployed"
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={monitoringServiceAccounts}
                      value={localMonitorAccount || null}
                      freeSolo
                      onChange={(_, newValue) => setLocalMonitorAccount(newValue || '')}
                      onInputChange={(_, newValue) => setLocalMonitorAccount(newValue || '')}
                      renderInput={params => (
                        <TextField
                          {...params}
                          label="Monitor Service Account"
                          helperText="Prometheus service account name"
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Prometheus Helm Release Name (optional)"
                      value={localHelmRelease}
                      onChange={e => setLocalHelmRelease(e.target.value)}
                      helperText="If using kube-prometheus-stack via Helm, the ServiceMonitor needs a 'release' label matching your Helm release name for Prometheus to discover it."
                    />
                  </Grid>
                </Grid>
                <Box display="flex" justifyContent="flex-end" gap={1} mt={2}>
                  {kubeVirt?.getMonitorNamespace() && (
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      onClick={async () => {
                        setUpdating(true);
                        try {
                          await kubeVirt.updateMonitoringConfig('', '');
                          setLocalMonitorNamespace('');
                          setLocalMonitorAccount('');
                          enqueueSnackbar('Prometheus monitoring configuration removed.', {
                            variant: 'success',
                          });
                        } catch (error: unknown) {
                          enqueueSnackbar(
                            `Failed to remove monitoring config: ${(error as Error).message}`,
                            { variant: 'error' }
                          );
                        } finally {
                          setUpdating(false);
                        }
                      }}
                      disabled={updating}
                    >
                      Remove
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleMonitoringConfigUpdate}
                    disabled={updating || (!localMonitorNamespace && !localMonitorAccount)}
                    sx={{
                      backgroundColor: '#4caf50',
                      '&:hover': { backgroundColor: '#45a049' },
                    }}
                  >
                    Apply
                  </Button>
                </Box>
              </CardContent>
            </Card>

            {/* Common Instance Types */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Box flex={1}>
                    <Typography variant="body1" fontWeight={500}>
                      Common Instance Types Deployment
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Deploy predefined VM instance types (u1.small, u1.medium, etc.)
                    </Typography>
                  </Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={localCommonInstancetypes}
                        onChange={e => handleCommonInstancetypesToggle(e.target.checked)}
                        disabled={updating}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: '#4caf50',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: '#4caf50',
                          },
                          '& .MuiSwitch-track': {
                            backgroundColor: localCommonInstancetypes ? '#4caf50' : '#9e9e9e',
                          },
                        }}
                      />
                    }
                    label={
                      <Typography
                        variant="body2"
                        sx={{
                          color: localCommonInstancetypes ? '#4caf50' : '#f44336',
                          fontWeight: localCommonInstancetypes ? 600 : 400,
                          minWidth: 85,
                        }}
                      >
                        {localCommonInstancetypes ? 'Enabled' : 'Disabled'}
                      </Typography>
                    }
                  />
                </Box>
              </CardContent>
            </Card>

            {/* Memory Overcommit */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="body1" fontWeight={500} mb={1}>
                  Memory Overcommit
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Percentage of memory to allocate beyond physical capacity (100% = no overcommit)
                </Typography>
                <Box display="flex" alignItems="flex-start" gap={2}>
                  <TextField
                    fullWidth
                    label="Memory Overcommit %"
                    type="number"
                    size="small"
                    value={localMemoryOvercommit}
                    onChange={e => setLocalMemoryOvercommit(parseInt(e.target.value) || 100)}
                    inputProps={{ min: 100, max: 200, step: 10 }}
                    helperText="100% = no overcommit, 200% = 2x overcommit"
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleMemoryOvercommitUpdate}
                    disabled={updating}
                    sx={{
                      backgroundColor: '#4caf50',
                      '&:hover': {
                        backgroundColor: '#45a049',
                      },
                      mt: 1,
                    }}
                  >
                    Apply
                  </Button>
                </Box>
              </CardContent>
            </Card>

            {/* Eviction Strategy */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="body1" fontWeight={500} mb={1}>
                  Eviction Strategy
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Behavior when a node needs to be drained
                </Typography>
                <Box display="flex" alignItems="center" gap={2}>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>Strategy</InputLabel>
                    <Select
                      value={localEvictionStrategy}
                      label="Strategy"
                      onChange={e => setLocalEvictionStrategy(e.target.value)}
                    >
                      <MenuItem value="">None</MenuItem>
                      <MenuItem value="LiveMigrate">Live Migrate</MenuItem>
                      <MenuItem value="External">External</MenuItem>
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleEvictionStrategyUpdate}
                    disabled={updating}
                    sx={{
                      backgroundColor: '#4caf50',
                      '&:hover': {
                        backgroundColor: '#45a049',
                      },
                    }}
                  >
                    Apply
                  </Button>
                </Box>
              </CardContent>
            </Card>

            {/* Live Update Configuration */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box
                  display="flex"
                  alignItems="center"
                  gap={1}
                  mb={2}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setLiveUpdateConfigExpanded(!liveUpdateConfigExpanded)}
                >
                  <Icon
                    icon="mdi:cog"
                    width={20}
                    height={20}
                    style={{ color: liveUpdateConfigExpanded ? '#2196f3' : '#9e9e9e' }}
                  />
                  <Typography variant="body1" fontWeight={500} flex={1}>
                    Live Update Configuration (CPU/Memory Hotplug)
                  </Typography>
                  <Icon
                    icon={liveUpdateConfigExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                    width={20}
                    height={20}
                  />
                </Box>
                <Collapse in={liveUpdateConfigExpanded}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Max CPU Sockets"
                        type="number"
                        size="small"
                        placeholder="e.g., 8"
                        value={localLiveUpdateConfig.maxCpuSockets}
                        onChange={e =>
                          setLocalLiveUpdateConfig({
                            ...localLiveUpdateConfig,
                            maxCpuSockets: e.target.value,
                          })
                        }
                        helperText="Maximum CPU sockets for live updates"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Max Hotplug Ratio"
                        type="number"
                        size="small"
                        placeholder="e.g., 2"
                        value={localLiveUpdateConfig.maxHotplugRatio}
                        onChange={e =>
                          setLocalLiveUpdateConfig({
                            ...localLiveUpdateConfig,
                            maxHotplugRatio: e.target.value,
                          })
                        }
                        helperText="Max ratio for hotplugging (2 = can double resources)"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Box display="flex" justifyContent="flex-end" gap={1}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setLiveUpdateConfigExpanded(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={handleLiveUpdateConfigUpdate}
                          disabled={updating}
                          sx={{
                            backgroundColor: '#4caf50',
                            '&:hover': {
                              backgroundColor: '#45a049',
                            },
                          }}
                        >
                          Apply
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </Collapse>
              </CardContent>
            </Card>

            {/* Network Configuration */}
            <Card variant="outlined">
              <CardContent>
                <Box
                  display="flex"
                  alignItems="center"
                  gap={1}
                  mb={2}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setNetworkConfigExpanded(!networkConfigExpanded)}
                >
                  <Icon
                    icon="mdi:cog"
                    width={20}
                    height={20}
                    style={{ color: networkConfigExpanded ? '#2196f3' : '#9e9e9e' }}
                  />
                  <Typography variant="body1" fontWeight={500} flex={1}>
                    Network Configuration
                  </Typography>
                  <Icon
                    icon={networkConfigExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                    width={20}
                    height={20}
                  />
                </Box>
                <Collapse in={networkConfigExpanded}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Default Network Interface</InputLabel>
                        <Select
                          value={localNetworkConfig.defaultNetworkInterface}
                          label="Default Network Interface"
                          onChange={e =>
                            setLocalNetworkConfig({
                              ...localNetworkConfig,
                              defaultNetworkInterface: e.target.value,
                            })
                          }
                        >
                          <MenuItem value="">None</MenuItem>
                          <MenuItem value="bridge">Bridge</MenuItem>
                          <MenuItem value="masquerade">Masquerade</MenuItem>
                          <MenuItem value="slirp">SLIRP</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={localNetworkConfig.permitBridgeInterfaceOnPodNetwork}
                            onChange={e =>
                              setLocalNetworkConfig({
                                ...localNetworkConfig,
                                permitBridgeInterfaceOnPodNetwork: e.target.checked,
                              })
                            }
                            color="success"
                          />
                        }
                        label="Permit Bridge Interface on Pod Network"
                      />
                      <Typography variant="caption" display="block" color="text.secondary">
                        Allow bridge networking on the pod network
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={localNetworkConfig.permitSlirpInterface}
                            onChange={e =>
                              setLocalNetworkConfig({
                                ...localNetworkConfig,
                                permitSlirpInterface: e.target.checked,
                              })
                            }
                            color="success"
                          />
                        }
                        label="Permit SLIRP Interface"
                      />
                      <Typography variant="caption" display="block" color="text.secondary">
                        Allow user-mode networking (no special privileges required)
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Box display="flex" justifyContent="flex-end" gap={1}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setNetworkConfigExpanded(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={handleNetworkConfigUpdate}
                          disabled={updating}
                          sx={{
                            backgroundColor: '#4caf50',
                            '&:hover': {
                              backgroundColor: '#45a049',
                            },
                          }}
                        >
                          Apply
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </Collapse>
              </CardContent>
            </Card>
          </Box>
        </Collapse>
      </Box>
      {/* Feature Gates */}
      <Box mt={3}>
        <SectionBox title="Feature Gates">
          <Alert severity="info" sx={{ mb: 2 }}>
            Feature gates enable experimental or optional features. Changes require KubeVirt pods to
            restart.
          </Alert>

          <Box display="flex" gap={3}>
            {/* Floating sidebar navigation */}
            <Box
              sx={{
                position: 'sticky',
                top: 16,
                alignSelf: 'flex-start',
                minWidth: 180,
                display: { xs: 'none', md: 'block' },
              }}
            >
              <Typography variant="subtitle2" color="text.secondary" mb={1} px={1}>
                Categories
              </Typography>
              {Object.entries(FEATURE_GATE_CATEGORIES).map(([category, { icon, color }]) => (
                <Box
                  key={category}
                  onClick={() => {
                    setActiveCategory(activeCategory === category ? null : category);
                    document
                      .getElementById(`fg-category-${category}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 1,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: activeCategory === category ? `${color}15` : 'transparent',
                    borderLeft:
                      activeCategory === category ? `3px solid ${color}` : '3px solid transparent',
                    '&:hover': {
                      backgroundColor: `${color}10`,
                    },
                  }}
                >
                  <Icon icon={icon} width={18} style={{ color }} />
                  <Typography variant="body2" fontWeight={activeCategory === category ? 600 : 400}>
                    {category}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Feature gates content */}
            <Box flex={1}>
              {Object.entries(FEATURE_GATE_CATEGORIES).map(([category, { icon, color, gates }]) => {
                // Get KubeVirt version for filtering
                const kvVersion = kubeVirt?.getVersion() || '1.7.0';

                // Filter gates available in this version and sort by state
                const availableGates = gates
                  .filter(gate => isGateAvailableInVersion(gate, kvVersion))
                  .map(gate => ({
                    ...gate,
                    currentState: getGateStateForVersion(gate, kvVersion) as FeatureGateState,
                  }))
                  .sort((a, b) => STATE_ORDER[a.currentState] - STATE_ORDER[b.currentState]);

                // Skip category if no gates available
                if (availableGates.length === 0) return null;

                return (
                  <Box key={category} id={`fg-category-${category}`} mb={3}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                      <Icon icon={icon} width={24} style={{ color }} />
                      <Typography variant="h6">{category}</Typography>
                    </Box>

                    {availableGates.map(({ name, description, currentState }) => {
                      const isEnabled = enabledFeatureGates.includes(name);
                      const isLiveMigration = name === 'LiveMigration';
                      const isHostDevices = name === 'HostDevices';

                      return (
                        <Box key={name}>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            py={1.5}
                          >
                            <Box flex={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                <Typography variant="body1" fontWeight={500}>
                                  {name}
                                </Typography>
                                <Chip
                                  label={currentState}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    backgroundColor:
                                      currentState === 'GA'
                                        ? '#4caf50'
                                        : currentState === 'Beta'
                                        ? '#2196f3'
                                        : '#ff9800',
                                    color: 'white',
                                  }}
                                />
                              </Box>
                              <Typography variant="body2" color="text.secondary">
                                {description}
                              </Typography>
                            </Box>
                            {isLiveMigration && isEnabled && (
                              <IconButton
                                size="small"
                                onClick={() => setMigrationConfigExpanded(!migrationConfigExpanded)}
                                sx={{ color: migrationConfigExpanded ? '#4caf50' : '#9e9e9e' }}
                              >
                                <Icon icon="mdi:cog" width={24} />
                              </IconButton>
                            )}
                            {isHostDevices && isEnabled && (
                              <IconButton
                                size="small"
                                onClick={() =>
                                  setHostDevicesConfigExpanded(!hostDevicesConfigExpanded)
                                }
                                sx={{ color: hostDevicesConfigExpanded ? '#4caf50' : '#9e9e9e' }}
                              >
                                <Icon icon="mdi:cog" width={24} />
                              </IconButton>
                            )}
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={isEnabled}
                                  onChange={e => handleFeatureGateToggle(name, e.target.checked)}
                                  disabled={updating}
                                  sx={{
                                    '& .MuiSwitch-switchBase.Mui-checked': {
                                      color: '#4caf50',
                                    },
                                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                      backgroundColor: '#4caf50',
                                    },
                                    '& .MuiSwitch-track': {
                                      backgroundColor: isEnabled ? '#4caf50' : '#9e9e9e',
                                    },
                                  }}
                                />
                              }
                              label={
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color: isEnabled ? '#4caf50' : '#f44336',
                                    fontWeight: isEnabled ? 600 : 400,
                                    minWidth: 70,
                                  }}
                                >
                                  {isEnabled ? 'Enabled' : 'Disabled'}
                                </Typography>
                              }
                            />
                          </Box>

                          {/* Inline info for sidebar-affecting features */}
                          {sidebarReloadWarnings.includes(name) && (
                            <Alert
                              severity="info"
                              sx={{ mb: 2, ml: 2 }}
                              icon={<Icon icon="mdi:information" width={22} />}
                            >
                              You will be notified when KubeVirt is updated and console can be
                              reloaded
                            </Alert>
                          )}

                          {/* Migration Configuration - shown when LiveMigration is enabled */}
                          {isLiveMigration && isEnabled && (
                            <Collapse in={migrationConfigExpanded}>
                              <Box
                                sx={{
                                  ml: 4,
                                  mb: 2,
                                  p: 2,
                                  backgroundColor: 'rgba(76, 175, 80, 0.05)',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(76, 175, 80, 0.2)',
                                }}
                              >
                                <Typography variant="subtitle2" fontWeight={600} mb={2}>
                                  Migration Configuration
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Max Migrations per Cluster"
                                      type="number"
                                      size="small"
                                      placeholder="5"
                                      value={localMigrationConfig.parallelMigrationsPerCluster}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          parallelMigrationsPerCluster: e.target.value,
                                        })
                                      }
                                      helperText="Maximum concurrent migrations in cluster (default: 5)"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Max Migrations per Node"
                                      type="number"
                                      size="small"
                                      placeholder="2"
                                      value={localMigrationConfig.parallelOutboundMigrationsPerNode}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          parallelOutboundMigrationsPerNode: e.target.value,
                                        })
                                      }
                                      helperText="Maximum outbound migrations per node (default: 2)"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Bandwidth per Migration"
                                      size="small"
                                      placeholder="0 (unlimited)"
                                      value={localMigrationConfig.bandwidthPerMigration}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          bandwidthPerMigration: e.target.value,
                                        })
                                      }
                                      helperText="e.g., 64Mi, 1Gi (default: 0 = unlimited)"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Migration Network"
                                      size="small"
                                      placeholder="Leave empty for pod network"
                                      value={localMigrationConfig.network}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          network: e.target.value,
                                        })
                                      }
                                      helperText="NetworkAttachmentDefinition name for dedicated migration network"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Progress Timeout (seconds)"
                                      type="number"
                                      size="small"
                                      placeholder="150"
                                      value={localMigrationConfig.progressTimeout}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          progressTimeout: e.target.value,
                                        })
                                      }
                                      helperText="Timeout for stuck migrations (default: 150s)"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField
                                      fullWidth
                                      label="Completion Timeout per GiB (seconds)"
                                      type="number"
                                      size="small"
                                      placeholder="150"
                                      value={localMigrationConfig.completionTimeoutPerGiB}
                                      onChange={e =>
                                        setLocalMigrationConfig({
                                          ...localMigrationConfig,
                                          completionTimeoutPerGiB: e.target.value,
                                        })
                                      }
                                      helperText="Timeout per GiB of memory (default: 150s)"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <FormControlLabel
                                      control={
                                        <Switch
                                          checked={localMigrationConfig.allowAutoConverge}
                                          onChange={e =>
                                            setLocalMigrationConfig({
                                              ...localMigrationConfig,
                                              allowAutoConverge: e.target.checked,
                                            })
                                          }
                                          color="success"
                                        />
                                      }
                                      label="Allow Auto-Converge"
                                    />
                                    <Typography
                                      variant="caption"
                                      display="block"
                                      color="text.secondary"
                                    >
                                      Throttle CPU for stuck migrations
                                    </Typography>
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <FormControlLabel
                                      control={
                                        <Switch
                                          checked={localMigrationConfig.allowPostCopy}
                                          onChange={e =>
                                            setLocalMigrationConfig({
                                              ...localMigrationConfig,
                                              allowPostCopy: e.target.checked,
                                            })
                                          }
                                          color="success"
                                        />
                                      }
                                      label="Allow Post-Copy"
                                    />
                                    <Typography
                                      variant="caption"
                                      display="block"
                                      color="text.secondary"
                                    >
                                      Allow post-copy migration strategy
                                    </Typography>
                                  </Grid>
                                  <Grid item xs={12}>
                                    <Box display="flex" justifyContent="flex-end" mt={1} gap={1}>
                                      <Button
                                        variant="outlined"
                                        size="small"
                                        onClick={() => setMigrationConfigExpanded(false)}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        variant="contained"
                                        size="small"
                                        onClick={handleMigrationConfigUpdate}
                                        disabled={updating}
                                        sx={{
                                          backgroundColor: '#4caf50',
                                          '&:hover': {
                                            backgroundColor: '#45a049',
                                          },
                                        }}
                                      >
                                        Apply Configuration
                                      </Button>
                                    </Box>
                                  </Grid>
                                </Grid>
                              </Box>
                            </Collapse>
                          )}

                          {/* Host Devices Configuration - shown when HostDevices is enabled */}
                          {isHostDevices && isEnabled && (
                            <Collapse in={hostDevicesConfigExpanded}>
                              <Box
                                sx={{
                                  ml: 4,
                                  mb: 2,
                                  p: 2,
                                  backgroundColor: 'rgba(76, 175, 80, 0.05)',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(76, 175, 80, 0.2)',
                                }}
                              >
                                <Typography variant="subtitle2" fontWeight={600} mb={2}>
                                  Permitted Host Devices Configuration
                                </Typography>

                                {/* PCI Host Devices */}
                                <Box mb={3}>
                                  <Typography variant="body2" fontWeight={500} mb={1}>
                                    PCI Host Devices
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    display="block"
                                    mb={2}
                                  >
                                    Configure PCI devices (GPUs, NICs, etc.) that can be passed
                                    through to VMs
                                  </Typography>

                                  {/* Add new PCI device form */}
                                  <Grid container spacing={1} alignItems="flex-end" mb={2}>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        fullWidth
                                        size="small"
                                        label="PCI Vendor Selector"
                                        placeholder="e.g., 10DE:1DB6"
                                        value={newPciDevice.pciVendorSelector}
                                        onChange={e =>
                                          setNewPciDevice({
                                            ...newPciDevice,
                                            pciVendorSelector: e.target.value,
                                          })
                                        }
                                        helperText="Vendor:Device ID"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        fullWidth
                                        size="small"
                                        label="Resource Name"
                                        placeholder="e.g., nvidia.com/GP102GL"
                                        value={newPciDevice.resourceName}
                                        onChange={e =>
                                          setNewPciDevice({
                                            ...newPciDevice,
                                            resourceName: e.target.value,
                                          })
                                        }
                                        helperText="Kubernetes resource name"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={2}>
                                      <Button
                                        fullWidth
                                        variant="outlined"
                                        size="small"
                                        onClick={addPciDevice}
                                        disabled={
                                          !newPciDevice.pciVendorSelector ||
                                          !newPciDevice.resourceName
                                        }
                                        startIcon={<Icon icon="mdi:plus" />}
                                      >
                                        Add
                                      </Button>
                                    </Grid>
                                  </Grid>

                                  {/* List of PCI devices */}
                                  {localPciDevices.length > 0 ? (
                                    <Box display="flex" flexDirection="column" gap={1}>
                                      {localPciDevices.map((device, index) => (
                                        <Box
                                          key={index}
                                          display="flex"
                                          alignItems="center"
                                          justifyContent="space-between"
                                          p={1}
                                          sx={{
                                            backgroundColor: 'rgba(0, 0, 0, 0.02)',
                                            borderRadius: '4px',
                                          }}
                                        >
                                          <Box>
                                            <Typography variant="body2" fontWeight={500}>
                                              {device.pciVendorSelector}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {device.resourceName}
                                            </Typography>
                                          </Box>
                                          <IconButton
                                            size="small"
                                            color="error"
                                            onClick={() => removePciDevice(index)}
                                          >
                                            <Icon icon="mdi:delete" width={18} />
                                          </IconButton>
                                        </Box>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                      fontStyle="italic"
                                    >
                                      No PCI devices configured
                                    </Typography>
                                  )}
                                </Box>

                                <Divider sx={{ my: 2 }} />

                                {/* Mediated Devices */}
                                <Box mb={2}>
                                  <Typography variant="body2" fontWeight={500} mb={1}>
                                    Mediated Devices (vGPU)
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    display="block"
                                    mb={2}
                                  >
                                    Configure mediated devices (vGPUs) that can be assigned to VMs
                                  </Typography>

                                  {/* Add new mediated device form */}
                                  <Grid container spacing={1} alignItems="flex-end" mb={2}>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        fullWidth
                                        size="small"
                                        label="MDEV Name Selector"
                                        placeholder="e.g., GRID T4-1Q"
                                        value={newMediatedDevice.mdevNameSelector}
                                        onChange={e =>
                                          setNewMediatedDevice({
                                            ...newMediatedDevice,
                                            mdevNameSelector: e.target.value,
                                          })
                                        }
                                        helperText="Mediated device type name"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        fullWidth
                                        size="small"
                                        label="Resource Name"
                                        placeholder="e.g., nvidia.com/GRID_T4-1Q"
                                        value={newMediatedDevice.resourceName}
                                        onChange={e =>
                                          setNewMediatedDevice({
                                            ...newMediatedDevice,
                                            resourceName: e.target.value,
                                          })
                                        }
                                        helperText="Kubernetes resource name"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={2}>
                                      <Button
                                        fullWidth
                                        variant="outlined"
                                        size="small"
                                        onClick={addMediatedDevice}
                                        disabled={
                                          !newMediatedDevice.mdevNameSelector ||
                                          !newMediatedDevice.resourceName
                                        }
                                        startIcon={<Icon icon="mdi:plus" />}
                                      >
                                        Add
                                      </Button>
                                    </Grid>
                                  </Grid>

                                  {/* List of mediated devices */}
                                  {localMediatedDevices.length > 0 ? (
                                    <Box display="flex" flexDirection="column" gap={1}>
                                      {localMediatedDevices.map((device, index) => (
                                        <Box
                                          key={index}
                                          display="flex"
                                          alignItems="center"
                                          justifyContent="space-between"
                                          p={1}
                                          sx={{
                                            backgroundColor: 'rgba(0, 0, 0, 0.02)',
                                            borderRadius: '4px',
                                          }}
                                        >
                                          <Box>
                                            <Typography variant="body2" fontWeight={500}>
                                              {device.mdevNameSelector}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {device.resourceName}
                                            </Typography>
                                          </Box>
                                          <IconButton
                                            size="small"
                                            color="error"
                                            onClick={() => removeMediatedDevice(index)}
                                          >
                                            <Icon icon="mdi:delete" width={18} />
                                          </IconButton>
                                        </Box>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                      fontStyle="italic"
                                    >
                                      No mediated devices configured
                                    </Typography>
                                  )}
                                </Box>

                                <Box display="flex" justifyContent="flex-end" mt={2} gap={1}>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => setHostDevicesConfigExpanded(false)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    variant="contained"
                                    size="small"
                                    onClick={handleHostDevicesConfigUpdate}
                                    disabled={updating}
                                    sx={{
                                      backgroundColor: '#4caf50',
                                      '&:hover': {
                                        backgroundColor: '#45a049',
                                      },
                                    }}
                                  >
                                    Apply Configuration
                                  </Button>
                                </Box>
                              </Box>
                            </Collapse>
                          )}

                          <Divider />
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}

              {/* Show any custom feature gates that aren't in the known list */}
              {enabledFeatureGates.filter(fg => !ALL_KNOWN_GATES.includes(fg)).length > 0 && (
                <Box mb={3}>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <Icon icon="mdi:puzzle" width={24} style={{ color: '#9e9e9e' }} />
                    <Typography variant="h6">Custom</Typography>
                  </Box>
                  {enabledFeatureGates
                    .filter(fg => !ALL_KNOWN_GATES.includes(fg))
                    .map(customFG => (
                      <Box key={customFG}>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          py={1.5}
                        >
                          <Box flex={1}>
                            <Typography variant="body1" fontWeight={500}>
                              {customFG}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Custom feature gate
                            </Typography>
                          </Box>
                          <FormControlLabel
                            control={
                              <Switch
                                checked
                                onChange={e => handleFeatureGateToggle(customFG, e.target.checked)}
                                disabled={updating}
                                sx={{
                                  '& .MuiSwitch-switchBase.Mui-checked': {
                                    color: '#4caf50',
                                  },
                                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                    backgroundColor: '#4caf50',
                                  },
                                  '& .MuiSwitch-track': {
                                    backgroundColor: '#4caf50',
                                  },
                                }}
                              />
                            }
                            label={
                              <Typography
                                variant="body2"
                                sx={{
                                  color: '#4caf50',
                                  fontWeight: 600,
                                  minWidth: 70,
                                }}
                              >
                                Enabled
                              </Typography>
                            }
                          />
                        </Box>
                        <Divider />
                      </Box>
                    ))}
                </Box>
              )}
            </Box>
          </Box>
        </SectionBox>
      </Box>

      {/* CDI Feature Gates */}
      {cdi && cdi.getFeatureGates().length > 0 && (
        <Box mt={3}>
          <SectionBox title="CDI Feature Gates (Read-only)">
            <Box display="flex" gap={1} flexWrap="wrap">
              {cdi.getFeatureGates().map(fg => (
                <Chip key={fg} label={fg} variant="outlined" />
              ))}
            </Box>
          </SectionBox>
        </Box>
      )}

      {/* VM Delete Protection Modal */}
      <Dialog
        open={deleteProtectionModalOpen}
        onClose={() => setDeleteProtectionModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <Icon icon="mdi:shield-lock" width={28} height={28} color="#9c27b0" />
            <Typography variant="h6">VM Delete Protection</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" paragraph>
            This feature deploys a <strong>ValidatingAdmissionPolicy</strong> that prevents the
            deletion of VirtualMachines that have delete protection enabled.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={500} gutterBottom>
              How it works:
            </Typography>
            <Typography variant="body2" component="div">
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>The policy watches for DELETE operations on VirtualMachines</li>
                <li>
                  If a VM has the label{' '}
                  <code
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.1)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    kubevirt.io/vm-delete-protection: "True"
                  </code>
                  , deletion is blocked
                </li>
                <li>To delete a protected VM, first remove the label</li>
              </ol>
            </Typography>
          </Alert>

          <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
            To protect a VM:
          </Typography>
          <Box
            component="pre"
            sx={{
              backgroundColor: 'rgba(0,0,0,0.05)',
              p: 2,
              borderRadius: '4px',
              overflow: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {`kubectl patch vm <vm_name> -n <namespace> --type merge \\
  -p '{"metadata":{"labels":{"kubevirt.io/vm-delete-protection":"True"}}}'`}
          </Box>

          <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
            To remove protection:
          </Typography>
          <Box
            component="pre"
            sx={{
              backgroundColor: 'rgba(0,0,0,0.05)',
              p: 2,
              borderRadius: '4px',
              overflow: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {`kubectl patch vm <vm_name> -n <namespace> --type json \\
  -p '[{"op": "remove", "path": "/metadata/labels/kubevirt.io~1vm-delete-protection"}]'`}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" gutterBottom>
            Resources that will be {deleteProtectionDeployed ? 'removed' : 'created'}:
          </Typography>
          <Box display="flex" gap={1} flexWrap="wrap">
            <Chip
              icon={<Icon icon="mdi:shield-check" width={16} />}
              label="ValidatingAdmissionPolicy"
              size="small"
              variant="outlined"
            />
            <Chip
              icon={<Icon icon="mdi:link-variant" width={16} />}
              label="ValidatingAdmissionPolicyBinding"
              size="small"
              variant="outlined"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteProtectionModalOpen(false)}>Cancel</Button>
          {deleteProtectionDeployed ? (
            <Button
              variant="contained"
              color="error"
              onClick={handleUndeployDeleteProtection}
              disabled={deleteProtectionLoading}
              startIcon={
                deleteProtectionLoading ? (
                  <Icon icon="mdi:loading" width={20} className="spin" />
                ) : (
                  <Icon icon="mdi:delete" width={20} />
                )
              }
            >
              {deleteProtectionLoading ? 'Removing...' : 'Remove Protection'}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={handleDeployDeleteProtection}
              disabled={deleteProtectionLoading}
              startIcon={
                deleteProtectionLoading ? (
                  <Icon icon="mdi:loading" width={20} className="spin" />
                ) : (
                  <Icon icon="mdi:shield-plus" width={20} />
                )
              }
            >
              {deleteProtectionLoading ? 'Deploying...' : 'Deploy Protection'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* KubeVirt Editor Dialog */}
      <ResourceEditorDialog
        open={kubeVirtEditorOpen}
        onClose={() => setKubeVirtEditorOpen(false)}
        onSave={async updatedItem => {
          await kubeVirt.update(
            updatedItem as unknown as import('@kinvolk/headlamp-plugin/lib/lib/k8s/cluster').KubeObjectInterface
          );
        }}
        item={kubeVirt?.jsonData}
        title="KubeVirt"
        apiVersion="kubevirt.io/v1"
        kind="KubeVirt"
      />

      {/* CDI Editor Dialog */}
      {cdi && (
        <ResourceEditorDialog
          open={cdiEditorOpen}
          onClose={() => setCdiEditorOpen(false)}
          onSave={async updatedItem => {
            await cdi.update(
              updatedItem as unknown as import('@kinvolk/headlamp-plugin/lib/lib/k8s/cluster').KubeObjectInterface
            );
          }}
          item={cdi?.jsonData}
          title="CDI"
          apiVersion="cdi.kubevirt.io/v1beta1"
          kind="CDI"
        />
      )}
    </Box>
  );
}
