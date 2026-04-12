import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import InfoTooltip from '../../components/common/InfoTooltip';
import {
  isValidMdevSelector,
  isValidPciSelector,
  isValidResourceName,
  sanitizeFeatureGateSearch,
} from '../../utils/sanitize';
import { TOOLTIPS } from '../../utils/tooltips';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export interface MigrationConfig {
  parallelMigrationsPerCluster?: number | string;
  parallelOutboundMigrationsPerNode?: number | string;
  bandwidthPerMigration?: string;
  completionTimeoutPerGiB?: number | string;
  progressTimeout?: number | string;
  allowAutoConverge?: boolean;
  allowPostCopy?: boolean;
  network?: string;
  [key: string]: unknown;
}

export interface PciDevice {
  pciVendorSelector: string;
  resourceName: string;
  externalResourceProvider?: boolean;
}

export interface MediatedDevice {
  mdevNameSelector: string;
  resourceName: string;
  externalResourceProvider?: boolean;
}

// ---------------------------------------------------------------------------
// Feature gate metadata
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface FeatureGatesSectionProps {
  kubeVirt: {
    getVersion(): string;
    getMigrationConfig(): MigrationConfig;
    getPciHostDevices(): PciDevice[];
    getMediatedDevices(): MediatedDevice[];
  } | null;
  enabledFeatureGates: string[];
  sidebarReloadWarnings: string[];
  updating: boolean;
  onToggleFeatureGate: (gate: string, enabled: boolean) => Promise<void>;
  onUpdateMigrationConfig: (config: Record<string, unknown>) => Promise<void>;
  onUpdateHostDevices: (pci: PciDevice[], mediated: MediatedDevice[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FeatureGatesSection = React.memo(function FeatureGatesSection(
  props: FeatureGatesSectionProps
) {
  const {
    kubeVirt,
    enabledFeatureGates,
    sidebarReloadWarnings,
    updating,
    onToggleFeatureGate,
    onUpdateMigrationConfig,
    onUpdateHostDevices,
  } = props;

  // Search & filter state
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [featureGateSearch, setFeatureGateSearch] = useState('');
  const [featureGateSearchOpen, setFeatureGateSearchOpen] = useState(false);
  const [maturityFilter, setMaturityFilter] = useState<Set<FeatureGateState>>(
    new Set(['GA', 'Beta', 'Alpha'])
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFocusedRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedSearch = featureGateSearch;

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Migration config state
  const [migrationConfigExpanded, setMigrationConfigExpanded] = useState(false);
  const migrationConfig = kubeVirt?.getMigrationConfig() || {};
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

  // Host devices config state
  const [hostDevicesConfigExpanded, setHostDevicesConfigExpanded] = useState(false);
  const [localPciDevices, setLocalPciDevices] = useState<PciDevice[]>(
    kubeVirt?.getPciHostDevices() || []
  );
  const [localMediatedDevices, setLocalMediatedDevices] = useState<MediatedDevice[]>(
    kubeVirt?.getMediatedDevices() || []
  );
  const [newPciDevice, setNewPciDevice] = useState<PciDevice>({
    pciVendorSelector: '',
    resourceName: '',
    externalResourceProvider: false,
  });
  const [newMediatedDevice, setNewMediatedDevice] = useState<MediatedDevice>({
    mdevNameSelector: '',
    resourceName: '',
    externalResourceProvider: false,
  });

  // Local handlers
  const handleFeatureGateToggle = (gate: string, enabled: boolean) => {
    onToggleFeatureGate(gate, enabled);
  };

  const handleMigrationConfigUpdate = () => {
    const parsed: MigrationConfig = {};
    if (localMigrationConfig.parallelMigrationsPerCluster)
      parsed.parallelMigrationsPerCluster = parseInt(
        String(localMigrationConfig.parallelMigrationsPerCluster)
      );
    if (localMigrationConfig.parallelOutboundMigrationsPerNode)
      parsed.parallelOutboundMigrationsPerNode = parseInt(
        String(localMigrationConfig.parallelOutboundMigrationsPerNode)
      );
    if (localMigrationConfig.bandwidthPerMigration)
      parsed.bandwidthPerMigration = localMigrationConfig.bandwidthPerMigration;
    if (localMigrationConfig.network) parsed.network = localMigrationConfig.network;
    if (localMigrationConfig.progressTimeout)
      parsed.progressTimeout = parseInt(String(localMigrationConfig.progressTimeout));
    if (localMigrationConfig.completionTimeoutPerGiB)
      parsed.completionTimeoutPerGiB = parseInt(
        String(localMigrationConfig.completionTimeoutPerGiB)
      );
    parsed.allowAutoConverge = localMigrationConfig.allowAutoConverge;
    parsed.allowPostCopy = localMigrationConfig.allowPostCopy;
    onUpdateMigrationConfig(parsed);
  };

  const handleHostDevicesConfigUpdate = () => {
    onUpdateHostDevices(localPciDevices, localMediatedDevices);
  };

  const addPciDevice = () => {
    if (newPciDevice.pciVendorSelector && newPciDevice.resourceName) {
      setLocalPciDevices([...localPciDevices, { ...newPciDevice }]);
      setNewPciDevice({ pciVendorSelector: '', resourceName: '', externalResourceProvider: false });
    }
  };

  const removePciDevice = (index: number) => {
    setLocalPciDevices(localPciDevices.filter((_, i) => i !== index));
  };

  const addMediatedDevice = () => {
    if (newMediatedDevice.mdevNameSelector && newMediatedDevice.resourceName) {
      setLocalMediatedDevices([...localMediatedDevices, { ...newMediatedDevice }]);
      setNewMediatedDevice({
        mdevNameSelector: '',
        resourceName: '',
        externalResourceProvider: false,
      });
    }
  };

  const removeMediatedDevice = (index: number) => {
    setLocalMediatedDevices(localMediatedDevices.filter((_, i) => i !== index));
  };

  return (
    <Box mt={3}>
      <SectionBox title="Feature Gates">
        <Alert severity="info" sx={{ mb: 3 }}>
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
                  // Delay scroll until React has re-rendered with the new active category
                  setTimeout(() => {
                    document
                      .getElementById(`fg-category-${category}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 0);
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
            <Box display="flex" alignItems="center" gap={1} mb={2} flexWrap="wrap">
              {(['GA', 'Beta', 'Alpha'] as FeatureGateState[]).map(level => {
                const chipColor =
                  level === 'GA' ? '#4caf50' : level === 'Beta' ? '#2196f3' : '#ff9800';
                const active = maturityFilter.has(level);
                return (
                  <Chip
                    key={level}
                    label={level}
                    size="small"
                    onClick={() => {
                      setMaturityFilter(prev => {
                        const next = new Set(prev);
                        if (next.has(level)) next.delete(level);
                        else next.add(level);
                        return next;
                      });
                    }}
                    sx={{
                      borderColor: chipColor,
                      color: active ? '#fff' : chipColor,
                      backgroundColor: active ? chipColor : 'transparent',
                      fontWeight: 600,
                      '&:hover': {
                        backgroundColor: active ? chipColor : `${chipColor}20`,
                        color: active ? '#fff' : chipColor,
                      },
                    }}
                    variant="outlined"
                  />
                );
              })}
              {featureGateSearchOpen ? (
                <TextField
                  size="small"
                  placeholder="Search feature gates..."
                  defaultValue=""
                  onChange={e => {
                    const sanitized = sanitizeFeatureGateSearch(e.target.value);
                    if (e.target.value !== sanitized) e.target.value = sanitized;
                    clearTimeout(searchTimerRef.current);
                    searchTimerRef.current = setTimeout(() => setFeatureGateSearch(sanitized), 150);
                  }}
                  inputRef={el => {
                    searchInputRef.current = el;
                    if (el && !searchFocusedRef.current) {
                      searchFocusedRef.current = true;
                      el.focus();
                    }
                  }}
                  sx={{ flex: 1, minWidth: 200 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Icon icon="mdi:magnify" width={20} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (searchInputRef.current) searchInputRef.current.value = '';
                            clearTimeout(searchTimerRef.current);
                            searchFocusedRef.current = false;
                            setFeatureGateSearch('');
                            setFeatureGateSearchOpen(false);
                          }}
                        >
                          <Icon icon="mdi:close" width={18} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              ) : (
                <IconButton
                  size="small"
                  onClick={() => {
                    searchFocusedRef.current = false;
                    setFeatureGateSearchOpen(true);
                  }}
                  sx={{ color: 'text.secondary' }}
                >
                  <Icon icon="mdi:magnify" width={22} />
                </IconButton>
              )}
            </Box>
            {Object.entries(FEATURE_GATE_CATEGORIES).map(([category, { icon, color, gates }]) => {
              // Get KubeVirt version for filtering
              const kvVersion = kubeVirt?.getVersion() || '1.7.0';

              // Filter gates available in this version, apply search, and sort by state
              const searchLower = debouncedSearch.toLowerCase();
              const availableGates = gates
                .filter(gate => isGateAvailableInVersion(gate, kvVersion))
                .filter(
                  gate =>
                    !debouncedSearch ||
                    gate.name.toLowerCase().includes(searchLower) ||
                    gate.description.toLowerCase().includes(searchLower)
                )
                .map(gate => ({
                  ...gate,
                  currentState: getGateStateForVersion(gate, kvVersion) as FeatureGateState,
                }))
                .filter(gate => maturityFilter.has(gate.currentState))
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
                                    label={
                                      <>
                                        Allow Auto-Converge{' '}
                                        <InfoTooltip text={TOOLTIPS.autoConverge} />
                                      </>
                                    }
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
                                    label={
                                      <>
                                        Allow Post-Copy <InfoTooltip text={TOOLTIPS.postCopy} />
                                      </>
                                    }
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
                                      error={
                                        !!newPciDevice.pciVendorSelector &&
                                        !isValidPciSelector(newPciDevice.pciVendorSelector)
                                      }
                                      helperText={
                                        newPciDevice.pciVendorSelector &&
                                        !isValidPciSelector(newPciDevice.pciVendorSelector)
                                          ? 'Must be vendor_id:device_id (hex, e.g., 10DE:1DB6)'
                                          : 'Vendor:Device ID'
                                      }
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
                                      error={
                                        !!newPciDevice.resourceName &&
                                        !isValidResourceName(newPciDevice.resourceName)
                                      }
                                      helperText={
                                        newPciDevice.resourceName &&
                                        !isValidResourceName(newPciDevice.resourceName)
                                          ? 'Must be domain/name (e.g., nvidia.com/GP102GL)'
                                          : 'Kubernetes resource name'
                                      }
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={10}>
                                    <FormControlLabel
                                      control={
                                        <Checkbox
                                          size="small"
                                          checked={newPciDevice.externalResourceProvider || false}
                                          onChange={e =>
                                            setNewPciDevice({
                                              ...newPciDevice,
                                              externalResourceProvider: e.target.checked,
                                            })
                                          }
                                        />
                                      }
                                      label={
                                        <Box display="flex" alignItems="center" gap={0.5}>
                                          <Typography variant="body2">
                                            External Resource Provider
                                          </Typography>
                                          <Tooltip title="Enable when a third-party device plugin (e.g., NVIDIA GPU Operator) manages this device. KubeVirt will permit the device but delegate allocation and health monitoring to the external plugin.">
                                            <Icon
                                              icon="mdi:information-outline"
                                              width={16}
                                              style={{ color: '#9e9e9e', cursor: 'help' }}
                                            />
                                          </Tooltip>
                                        </Box>
                                      }
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
                                        !newPciDevice.resourceName ||
                                        !isValidPciSelector(newPciDevice.pciVendorSelector) ||
                                        !isValidResourceName(newPciDevice.resourceName)
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
                                          <Box display="flex" alignItems="center" gap={1}>
                                            <Typography variant="body2" fontWeight={500}>
                                              {device.pciVendorSelector}
                                            </Typography>
                                            {device.externalResourceProvider && (
                                              <Chip
                                                label="External"
                                                size="small"
                                                sx={{ height: 18, fontSize: '0.65rem' }}
                                              />
                                            )}
                                          </Box>
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
                                      error={
                                        !!newMediatedDevice.mdevNameSelector &&
                                        !isValidMdevSelector(newMediatedDevice.mdevNameSelector)
                                      }
                                      helperText={
                                        newMediatedDevice.mdevNameSelector &&
                                        !isValidMdevSelector(newMediatedDevice.mdevNameSelector)
                                          ? 'Must be alphanumeric with spaces/dashes (e.g., GRID T4-1Q)'
                                          : 'Mediated device type name'
                                      }
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
                                      error={
                                        !!newMediatedDevice.resourceName &&
                                        !isValidResourceName(newMediatedDevice.resourceName)
                                      }
                                      helperText={
                                        newMediatedDevice.resourceName &&
                                        !isValidResourceName(newMediatedDevice.resourceName)
                                          ? 'Must be domain/name (e.g., nvidia.com/GRID_T4-1Q)'
                                          : 'Kubernetes resource name'
                                      }
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={10}>
                                    <FormControlLabel
                                      control={
                                        <Checkbox
                                          size="small"
                                          checked={
                                            newMediatedDevice.externalResourceProvider || false
                                          }
                                          onChange={e =>
                                            setNewMediatedDevice({
                                              ...newMediatedDevice,
                                              externalResourceProvider: e.target.checked,
                                            })
                                          }
                                        />
                                      }
                                      label={
                                        <Box display="flex" alignItems="center" gap={0.5}>
                                          <Typography variant="body2">
                                            External Resource Provider
                                          </Typography>
                                          <Tooltip title="Enable when a third-party device plugin (e.g., NVIDIA GPU Operator) manages this device. KubeVirt will permit the device but delegate allocation and health monitoring to the external plugin.">
                                            <Icon
                                              icon="mdi:information-outline"
                                              width={16}
                                              style={{ color: '#9e9e9e', cursor: 'help' }}
                                            />
                                          </Tooltip>
                                        </Box>
                                      }
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
                                        !newMediatedDevice.resourceName ||
                                        !isValidMdevSelector(newMediatedDevice.mdevNameSelector) ||
                                        !isValidResourceName(newMediatedDevice.resourceName)
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
                                          <Box display="flex" alignItems="center" gap={1}>
                                            <Typography variant="body2" fontWeight={500}>
                                              {device.mdevNameSelector}
                                            </Typography>
                                            {device.externalResourceProvider && (
                                              <Chip
                                                label="External"
                                                size="small"
                                                sx={{ height: 18, fontSize: '0.65rem' }}
                                              />
                                            )}
                                          </Box>
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
            {enabledFeatureGates
              .filter(fg => !ALL_KNOWN_GATES.includes(fg))
              .filter(
                fg => !debouncedSearch || fg.toLowerCase().includes(debouncedSearch.toLowerCase())
              ).length > 0 && (
              <Box mb={3}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Icon icon="mdi:puzzle" width={24} style={{ color: '#9e9e9e' }} />
                  <Typography variant="h6">Custom</Typography>
                </Box>
                {enabledFeatureGates
                  .filter(fg => !ALL_KNOWN_GATES.includes(fg))
                  .filter(
                    fg =>
                      !debouncedSearch || fg.toLowerCase().includes(debouncedSearch.toLowerCase())
                  )
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
  );
});

export default FeatureGatesSection;
