import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeFeatureGateSearch } from '../../utils/sanitize';

// ---------------------------------------------------------------------------
// Feature gate metadata
// ---------------------------------------------------------------------------

type FeatureGateState = 'GA' | 'Beta' | 'Alpha' | 'Deprecated' | 'Discontinued';

interface FeatureGateInfo {
  name: string;
  description: string;
  // Version history: { version: state } — tracks maturity across KubeVirt versions
  versionHistory: Record<string, FeatureGateState>;
}

// Get feature gate state for a specific version
function getGateStateForVersion(gate: FeatureGateInfo, version: string): FeatureGateState | null {
  const versionParts = version.split('.').map(Number);
  const major = versionParts[0] || 1;
  const minor = versionParts[1] || 0;

  let currentState: FeatureGateState | null = null;

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

// Check if gate is available in version (hide Discontinued gates)
function isGateAvailableInVersion(gate: FeatureGateInfo, version: string): boolean {
  const state = getGateStateForVersion(gate, version);
  return state !== null && state !== 'Discontinued';
}

// State sort order for sorting gates
const STATE_ORDER: Record<FeatureGateState, number> = {
  GA: 0,
  Beta: 1,
  Alpha: 2,
  Deprecated: 3,
  Discontinued: 4,
};

// Maturity badge colors
const MATURITY_COLORS: Record<FeatureGateState, string> = {
  GA: '#4caf50',
  Beta: '#2196f3',
  Alpha: '#ff9800',
  Deprecated: '#f44336',
  Discontinued: '#9e9e9e',
};

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
        versionHistory: { '1.5': 'Alpha', '1.6': 'Beta', '1.8': 'GA' },
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
      {
        name: 'ContainerPathVolumes',
        description: 'Expose virt-launcher paths to VM via virtiofs (credential injection)',
        versionHistory: { '1.8': 'Alpha' },
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
        versionHistory: { '1.6': 'Alpha', '1.8': 'Discontinued' },
      },
      {
        name: 'PasstBinding',
        description: 'Passt core network binding (usermode TCP/UDP)',
        versionHistory: { '1.8': 'Beta' },
      },
      {
        name: 'PodSecondaryInterfaceNamingUpgrade',
        description: 'Upgrade mechanism for pod secondary network naming',
        versionHistory: { '1.8': 'Beta' },
      },
      {
        name: 'ExternalNetResourceInjection',
        description: 'Disable NAD queries, use external network resource injection',
        versionHistory: { '1.8': 'Beta' },
      },
      {
        name: 'LiveUpdateNADRef',
        description: 'Dynamic NAD reference updates on running VMs',
        versionHistory: { '1.8': 'Beta' },
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
      {
        name: 'RebootPolicy',
        description: 'Terminate VMI on guest reboot for config refresh',
        versionHistory: { '1.8': 'Alpha' },
      },
      {
        name: 'VmiMemoryOverheadReport',
        description: 'Report memory overhead in VMI status',
        versionHistory: { '1.8': 'Alpha' },
      },
      {
        name: 'ReservedOverheadMemlock',
        description: 'Specify reserved memory overhead and memlock control',
        versionHistory: { '1.8': 'Alpha' },
      },
      {
        name: 'ConfigurableHypervisor',
        description: 'Use non-KVM hypervisors via HypervisorConfigurations',
        versionHistory: { '1.8': 'Alpha' },
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
        versionHistory: { '1.0': 'Alpha', '1.8': 'Deprecated' },
      },
      {
        name: 'PanicDevices',
        description: 'Panic device support for crash signaling (requires pvpanic kernel module)',
        versionHistory: { '1.6': 'Alpha', '1.7': 'Beta', '1.8': 'Beta' },
      },
      {
        name: 'PCINUMAAwareTopology',
        description: 'NUMA-aware PCIe topology for GPU/host device passthrough',
        versionHistory: { '1.6': 'Alpha' },
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
        versionHistory: { '0.54': 'Alpha', '1.7': 'Beta', '1.8': 'Beta' },
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
      {
        name: 'OptOutRoleAggregation',
        description: 'Opt out of RBAC aggregation to default Kubernetes roles',
        versionHistory: { '1.8': 'Alpha' },
      },
    ],
  },
  Migration: {
    icon: 'mdi:airplane',
    color: '#00bcd4',
    gates: [
      {
        name: 'DecentralizedLiveMigration',
        description: 'Cross-cluster and cross-namespace live migration',
        versionHistory: { '1.5': 'Alpha', '1.6': 'Alpha' },
      },
      {
        name: 'MigrationPriorityQueue',
        description: 'Prioritize system migrations over user migrations',
        versionHistory: { '1.7': 'Alpha', '1.8': 'Beta' },
      },
      {
        name: 'VMPersistentState',
        description: 'Persist VM state (vTPM) across migrations',
        versionHistory: { '1.1': 'Alpha', '1.7': 'GA' },
      },
      {
        name: 'NodeRestriction',
        description: 'Node restriction for virt-handler (like Kubelet)',
        versionHistory: { '1.3': 'Alpha', '1.6': 'Beta' },
      },
      {
        name: 'LibvirtHooksServerAndClient',
        description: 'Pre-migration hooks on target virt-launcher for domain XML mutations',
        versionHistory: { '1.8': 'Alpha' },
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
        versionHistory: { '1.0': 'Alpha', '1.8': 'Deprecated' },
      },
      {
        name: 'Template',
        description: 'VirtualMachineTemplate CRD and virt-template components',
        versionHistory: { '1.8': 'Alpha' },
      },
      {
        name: 'DockerSELinuxMCSWorkaround',
        description: 'SELinux MCS workaround for Docker runtime',
        versionHistory: { '0.20': 'Alpha', '1.4': 'Deprecated' },
      },
      {
        name: 'Passt',
        description: 'Legacy passt network binding',
        versionHistory: { '1.0': 'Alpha', '1.3': 'Deprecated', '1.8': 'Discontinued' },
      },
      {
        name: 'Macvtap',
        description: 'Macvtap network binding',
        versionHistory: { '0.41': 'Alpha', '1.7': 'Deprecated', '1.8': 'Discontinued' },
      },
      {
        name: 'ExperimentalVirtiofsSupport',
        description: 'Legacy virtiofs support',
        versionHistory: { '0.49': 'Alpha', '1.6': 'Deprecated', '1.7': 'Discontinued' },
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
  } | null;
  enabledFeatureGates: string[];
  sidebarReloadWarnings: string[];
  updating: boolean;
  onToggleFeatureGate: (gate: string, enabled: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FeatureGatesSection = React.memo(function FeatureGatesSection(
  props: FeatureGatesSectionProps
) {
  const { kubeVirt, enabledFeatureGates, sidebarReloadWarnings, updating, onToggleFeatureGate } =
    props;

  // Compute GA and Deprecated gates dynamically from version
  const kvVersion = kubeVirt?.getVersion() || '1.7.0';
  const { GA_GATES, DEPRECATED_GATES } = useMemo(() => {
    const allGates = Object.values(FEATURE_GATE_CATEGORIES).flatMap(cat => cat.gates);
    return {
      GA_GATES: new Set(
        allGates.filter(g => getGateStateForVersion(g, kvVersion) === 'GA').map(g => g.name)
      ),
      DEPRECATED_GATES: new Set(
        allGates.filter(g => getGateStateForVersion(g, kvVersion) === 'Deprecated').map(g => g.name)
      ),
    };
  }, [kvVersion]);

  // Search & filter state
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [featureGateSearch, setFeatureGateSearch] = useState('');
  const [featureGateSearchOpen, setFeatureGateSearchOpen] = useState(false);
  const [maturityFilter, setMaturityFilter] = useState<Set<FeatureGateState>>(
    new Set(['GA', 'Beta', 'Alpha', 'Deprecated'])
  );
  const [hideAlwaysOn, setHideAlwaysOn] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFocusedRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const searchQuery = featureGateSearch;

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Local handlers
  const handleFeatureGateToggle = (gate: string, enabled: boolean) => {
    onToggleFeatureGate(gate, enabled);
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
              {(['GA', 'Beta', 'Alpha', 'Deprecated'] as FeatureGateState[]).map(level => {
                const chipColor = MATURITY_COLORS[level];
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
              <Chip
                label="Always On"
                size="small"
                onClick={() => setHideAlwaysOn(prev => !prev)}
                sx={{
                  borderColor: '#4caf50',
                  color: !hideAlwaysOn ? '#fff' : '#4caf50',
                  backgroundColor: !hideAlwaysOn ? '#4caf50' : 'transparent',
                  fontWeight: 600,
                  '&:hover': {
                    backgroundColor: !hideAlwaysOn ? '#4caf50' : 'rgba(76, 175, 80, 0.12)',
                    color: !hideAlwaysOn ? '#fff' : '#4caf50',
                  },
                }}
                variant="outlined"
              />
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
              // Filter gates available in this version, apply search, and sort by state
              const searchLower = searchQuery.toLowerCase();
              const availableGates = gates
                .filter(gate => isGateAvailableInVersion(gate, kvVersion))
                .filter(
                  gate =>
                    !searchQuery ||
                    gate.name.toLowerCase().includes(searchLower) ||
                    gate.description.toLowerCase().includes(searchLower)
                )
                .map(gate => ({
                  ...gate,
                  currentState: getGateStateForVersion(gate, kvVersion) as FeatureGateState,
                }))
                .filter(gate => maturityFilter.has(gate.currentState))
                .filter(gate => !hideAlwaysOn || !GA_GATES.has(gate.name))
                .sort((a, b) => STATE_ORDER[a.currentState] - STATE_ORDER[b.currentState]);

              // Skip category if no gates available
              if (availableGates.length === 0) return null;

              return (
                <Box key={category} id={`fg-category-${category}`} mb={3}>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={1}
                    py={1.5}
                    px={1}
                    mb={1}
                    sx={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 5,
                      bgcolor: 'background.paper',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Icon icon={icon} width={24} style={{ color }} />
                    <Typography variant="h6">{category}</Typography>
                  </Box>

                  {availableGates.map(({ name, description, currentState }) => {
                    const isGA = GA_GATES.has(name);
                    const isDeprecated = DEPRECATED_GATES.has(name);
                    const isEnabled = isGA || enabledFeatureGates.includes(name);

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
                                      : currentState === 'Deprecated'
                                      ? '#f44336'
                                      : '#ff9800',
                                  color: 'white',
                                }}
                              />
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                              {description}
                            </Typography>
                          </Box>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={isGA ? true : isEnabled}
                                onChange={
                                  isGA
                                    ? undefined
                                    : e => handleFeatureGateToggle(name, e.target.checked)
                                }
                                disabled={isGA || updating}
                                color={isDeprecated ? 'warning' : undefined}
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
                                  color: isGA ? '#4caf50' : isEnabled ? '#4caf50' : '#f44336',
                                  fontWeight: isGA || isEnabled ? 600 : 400,
                                  minWidth: 70,
                                }}
                              >
                                {isGA ? 'Always On' : isEnabled ? 'Enabled' : 'Disabled'}
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
              .filter(fg => !searchQuery || fg.toLowerCase().includes(searchQuery.toLowerCase()))
              .length > 0 && (
              <Box mb={3}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Icon icon="mdi:puzzle" width={24} style={{ color: '#9e9e9e' }} />
                  <Typography variant="h6">Custom</Typography>
                </Box>
                {enabledFeatureGates
                  .filter(fg => !ALL_KNOWN_GATES.includes(fg))
                  .filter(
                    fg => !searchQuery || fg.toLowerCase().includes(searchQuery.toLowerCase())
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
