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
import { INSPECTOR_IMAGE } from '../components/VMDoctor/constants';
import { LiveUpdateConfig, MigrationConfig, NetworkConfig, PermittedHostDevices } from '../types';
import { updateFeatureGates } from '../utils/featureGates';
import {
  addLabelColumn,
  defaultForensicSettings,
  defaultGuestfsSettings,
  ForensicSettings,
  getForensicSettings,
  getGuestfsSettings,
  getLabelColumns,
  GuestfsSettings,
  isValidImageRef,
  isValidRegistry,
  isValidRepo,
  LabelColumn,
  removeLabelColumn,
  saveForensicSettings,
  saveGuestfsSettings,
} from '../utils/pluginSettings';
import {
  isValidColumnName,
  isValidK8sLabelKey,
  isValidK8sLabelValue,
  isValidK8sName,
  safeError,
} from '../utils/sanitize';
import CDI from './CDI';
import KubeVirt from './KubeVirt';
import type { MediatedDevice, PciDevice } from './Settings/FeatureGatesSection';
import FeatureGatesSection from './Settings/FeatureGatesSection';
import SystemHealthSection from './Settings/SystemHealthSection';

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

export default function KubeVirtSettings() {
  const { enqueueSnackbar } = useSnackbar();
  const [updating, setUpdating] = useState(false);
  const [pluginFeaturesExpanded, setPluginFeaturesExpanded] = useState(false);
  const [deleteProtectionModalOpen, setDeleteProtectionModalOpen] = useState(false);
  const [deleteProtectionDeployed, setDeleteProtectionDeployed] = useState<boolean | null>(null);
  const [deleteProtectionLoading, setDeleteProtectionLoading] = useState(false);
  const [sidebarReloadWarnings, setSidebarReloadWarnings] = useState<string[]>([]);
  const [labelColumns, setLabelColumns] = useState<LabelColumn[]>([]);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelKey, setNewLabelKey] = useState('');
  const [labelColumnsExpanded, setLabelColumnsExpanded] = useState(false);
  const [forensicSettings, setForensicSettings] =
    useState<ForensicSettings>(defaultForensicSettings);
  const [forensicEditing, setForensicEditing] = useState(false);
  const [localForensic, setLocalForensic] = useState<ForensicSettings>(defaultForensicSettings);
  const [guestfsSettings, setGuestfsSettings] = useState<GuestfsSettings>(defaultGuestfsSettings);
  const [guestfsEditing, setGuestfsEditing] = useState(false);
  const [localGuestfs, setLocalGuestfs] = useState<GuestfsSettings>(defaultGuestfsSettings);

  // Load label columns, forensic, and guestfs settings from localStorage
  useEffect(() => {
    setLabelColumns(getLabelColumns());
    const fs = getForensicSettings();
    setForensicSettings(fs);
    setLocalForensic(fs);
    const gs = getGuestfsSettings();
    setGuestfsSettings(gs);
    setLocalGuestfs(gs);
  }, []);

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      if (monitorTimerRef.current) clearTimeout(monitorTimerRef.current);
    };
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
      enqueueSnackbar('Failed to deploy delete protection.', {
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
      enqueueSnackbar('Failed to remove delete protection.', {
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
  const [kubeVirtEditorOpen, setKubeVirtEditorOpen] = useState(false);
  const [cdiEditorOpen, setCdiEditorOpen] = useState(false);

  // Fetch KubeVirt CR (cluster-wide discovery)
  let kubeVirtItems: InstanceType<typeof KubeVirt>[] | null = null;
  let kvError: unknown = null;
  try {
    const result = KubeVirt.useList();
    kubeVirtItems = result.items;
    kvError = result.error;
  } catch (error) {
    console.error('Error fetching KubeVirt:', error);
    kvError = error;
  }
  const kvLoading = kubeVirtItems === null && !kvError;
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
  const liveUpdateConfig = kubeVirt?.getLiveUpdateConfig() || {};
  const networkConfig = kubeVirt?.getNetworkConfig() || {};
  const commonInstancetypesEnabled = kubeVirt?.getCommonInstancetypesEnabled() || false;
  const memoryOvercommit = kubeVirt?.getMemoryOvercommit() || 100;
  const evictionStrategy = kubeVirt?.getEvictionStrategy() || '';

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

  // Track if initial data has been loaded to update local state
  const initialLoadRef = useRef(false);
  const monitorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Update local state when KubeVirt data loads
  useEffect(() => {
    if (kubeVirt && !initialLoadRef.current) {
      initialLoadRef.current = true;
      setLocalCommonInstancetypes(kubeVirt.getCommonInstancetypesEnabled());
      setLocalMemoryOvercommit(kubeVirt.getMemoryOvercommit());
      setLocalEvictionStrategy(kubeVirt.getEvictionStrategy());

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
    if (!localMonitorNamespace || !isValidK8sName(localMonitorNamespace)) {
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

  // Fetch system health chart data from Prometheus

  // Now we can safely return early if there are errors
  if (kvError) {
    return (
      <Box p={3}>
        <Alert severity="error">
          Failed to load KubeVirt configuration: {safeError(kvError, 'kubevirt-load')}
        </Alert>
        <Typography variant="body2" color="text.secondary" mt={2}>
          Make sure KubeVirt is installed and accessible.
        </Typography>
      </Box>
    );
  }

  if (kvLoading) {
    return (
      <Box p={3} display="flex" justifyContent="center" alignItems="center" minHeight={200}>
        <Typography variant="body2" color="text.secondary">
          Loading KubeVirt configuration...
        </Typography>
      </Box>
    );
  }

  if (!kubeVirt) {
    return (
      <Box p={3}>
        <Alert severity="warning">
          KubeVirt CR not found. Make sure KubeVirt is properly installed.
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
      updateFeatureGates(newFeatureGates);

      // Add inline warning for features that affect sidebar
      const sidebarFeatures = ['Snapshot', 'VMExport', 'DataVolumes', 'LiveMigration'];
      if (sidebarFeatures.includes(featureGate) && !sidebarReloadWarnings.includes(featureGate)) {
        setSidebarReloadWarnings([...sidebarReloadWarnings, featureGate]);
      }
    } catch (error: unknown) {
      console.error('Failed to update feature gates', error);
      enqueueSnackbar('Failed to update feature gate.', {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleMigrationConfigUpdate = async (config: Record<string, unknown>) => {
    setUpdating(true);
    try {
      await kubeVirt.updateMigrationConfig(config as MigrationConfig);
      enqueueSnackbar('Migration configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update migration configuration', error);
      enqueueSnackbar('Failed to update migration configuration.', {
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
      enqueueSnackbar('Failed to update common instance types.', {
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
      enqueueSnackbar('Failed to update memory overcommit.', {
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
      enqueueSnackbar('Failed to update eviction strategy.', {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleMonitoringConfigUpdate = async () => {
    if (localMonitorNamespace && !isValidK8sName(localMonitorNamespace)) {
      enqueueSnackbar('Invalid namespace name.', { variant: 'error' });
      return;
    }
    if (localMonitorAccount && !isValidK8sName(localMonitorAccount)) {
      enqueueSnackbar('Invalid service account name.', { variant: 'error' });
      return;
    }
    if (localHelmRelease && !isValidK8sLabelValue(localHelmRelease)) {
      enqueueSnackbar('Invalid Helm release label (must be ≤63 chars, alphanumeric start/end).', {
        variant: 'error',
      });
      return;
    }
    setUpdating(true);
    try {
      await kubeVirt.updateMonitoringConfig(localMonitorNamespace, localMonitorAccount);

      // If a Helm release name is provided, patch the ServiceMonitor with the release label
      // after a short delay to let the KubeVirt operator create it
      if (localHelmRelease && localMonitorNamespace) {
        monitorTimerRef.current = setTimeout(async () => {
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
      enqueueSnackbar('Failed to update monitoring config.', {
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
      enqueueSnackbar('Failed to update live update configuration.', {
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
      enqueueSnackbar('Failed to update network configuration.', {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleHostDevicesConfigUpdate = async (pci: PciDevice[], mediated: MediatedDevice[]) => {
    setUpdating(true);
    try {
      const permittedHostDevices: PermittedHostDevices = {};
      if (pci.length > 0) {
        permittedHostDevices.pciHostDevices = pci;
      }
      if (mediated.length > 0) {
        permittedHostDevices.mediatedDevices = mediated;
      }

      await kubeVirt.updatePermittedHostDevices(
        Object.keys(permittedHostDevices).length > 0 ? permittedHostDevices : undefined
      );
      enqueueSnackbar('Host devices configuration updated successfully', { variant: 'success' });
    } catch (error: unknown) {
      console.error('Failed to update host devices configuration', error);
      enqueueSnackbar('Failed to update host devices configuration.', {
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
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

      <SystemHealthSection kubevirtNamespace={kubeVirt.getNamespace()} />
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

            {/* Forensic Toolbox */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Box flex={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Icon icon="mdi:magnify-scan" width={20} height={20} />
                      <Typography variant="body1" fontWeight={500}>
                        Forensic Toolbox
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Container images used for VM memory forensic analysis (vol-qemu / Volatility3)
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    {!forensicEditing && (
                      <Chip
                        label="Configured"
                        size="small"
                        color={forensicSettings.toolboxImage ? 'success' : 'default'}
                        variant="outlined"
                      />
                    )}
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        if (forensicEditing) {
                          setLocalForensic(forensicSettings);
                        }
                        setForensicEditing(!forensicEditing);
                      }}
                    >
                      {forensicEditing ? 'Cancel' : 'Edit'}
                    </Button>
                  </Box>
                </Box>

                {forensicEditing ? (
                  (() => {
                    const toolboxErr =
                      localForensic.toolboxImage && !isValidImageRef(localForensic.toolboxImage)
                        ? 'Invalid image ref. Expected: registry/repo:tag or user/image:tag'
                        : '';
                    const registryErr =
                      localForensic.isfRegistry && !isValidRegistry(localForensic.isfRegistry)
                        ? 'Invalid registry. Expected: hostname[:port] (e.g., localhost:5000)'
                        : '';
                    const repoErr =
                      localForensic.isfRepo && !isValidRepo(localForensic.isfRepo)
                        ? 'Invalid repo name. Use alphanumeric, dots, dashes, slashes.'
                        : '';
                    const hasErrors =
                      !!toolboxErr ||
                      !!registryErr ||
                      !!repoErr ||
                      !localForensic.toolboxImage ||
                      !localForensic.isfRegistry ||
                      !localForensic.isfRepo;
                    return (
                      <Box mt={2}>
                        <TextField
                          label="Toolbox Image"
                          value={localForensic.toolboxImage}
                          onChange={e =>
                            setLocalForensic({ ...localForensic, toolboxImage: e.target.value })
                          }
                          fullWidth
                          size="small"
                          error={!!toolboxErr}
                          helperText={
                            toolboxErr ||
                            'Container image with vol-qemu and Volatility3 for memory forensic analysis'
                          }
                          sx={{ mb: 2 }}
                        />
                        <Typography
                          variant="caption"
                          fontWeight={600}
                          color="text.secondary"
                          sx={{ display: 'block', mb: 1 }}
                        >
                          ISF (Intermediate Symbol Format) Image
                        </Typography>
                        <Box display="flex" gap={1} sx={{ mb: 2 }}>
                          <TextField
                            label="ISF Registry"
                            value={localForensic.isfRegistry}
                            onChange={e =>
                              setLocalForensic({ ...localForensic, isfRegistry: e.target.value })
                            }
                            size="small"
                            sx={{ flex: 1 }}
                            error={!!registryErr}
                            helperText={
                              registryErr || 'Registry hosting ISF images (e.g., localhost:5000)'
                            }
                          />
                          <TextField
                            label="ISF Repo"
                            value={localForensic.isfRepo}
                            onChange={e =>
                              setLocalForensic({ ...localForensic, isfRepo: e.target.value })
                            }
                            size="small"
                            sx={{ flex: 1 }}
                            error={!!repoErr}
                            helperText={
                              repoErr || 'Repository name (e.g., isf). Tag = kernel version'
                            }
                          />
                        </Box>
                        <Box display="flex" gap={1} justifyContent="flex-end">
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => {
                              setLocalForensic(defaultForensicSettings);
                            }}
                          >
                            Reset Defaults
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            disabled={hasErrors}
                            onClick={() => {
                              saveForensicSettings(localForensic);
                              setForensicSettings(localForensic);
                              setForensicEditing(false);
                              enqueueSnackbar('Forensic toolbox settings saved', {
                                variant: 'success',
                              });
                            }}
                          >
                            Save
                          </Button>
                        </Box>
                      </Box>
                    );
                  })()
                ) : (
                  <Box mt={1} display="flex" flexDirection="column" gap={0.5}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >
                      Toolbox: {forensicSettings.toolboxImage || '(not set)'}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >
                      ISF: {forensicSettings.isfRegistry || '(not set)'}/
                      {forensicSettings.isfRepo || '(not set)'}:&lt;kernel&gt;
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Disk Inspector */}
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Box flex={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Icon icon="mdi:harddisk" width={20} height={20} />
                      <Typography variant="body1" fontWeight={500}>
                        Disk Inspector
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      ContainerDisk image used for VM disk inspection in VM Doctor
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    {!guestfsEditing && (
                      <Chip
                        label={guestfsSettings.image ? 'Configured' : 'Default'}
                        size="small"
                        color={guestfsSettings.image ? 'success' : 'default'}
                        variant="outlined"
                      />
                    )}
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        if (guestfsEditing) {
                          setLocalGuestfs(guestfsSettings);
                        }
                        setGuestfsEditing(!guestfsEditing);
                      }}
                    >
                      {guestfsEditing ? 'Cancel' : 'Edit'}
                    </Button>
                  </Box>
                </Box>

                {guestfsEditing ? (
                  (() => {
                    const imgErr =
                      localGuestfs.image && !isValidImageRef(localGuestfs.image)
                        ? 'Invalid image reference'
                        : '';
                    return (
                      <>
                        <TextField
                          label="Inspector Image"
                          value={localGuestfs.image}
                          onChange={e =>
                            setLocalGuestfs({ ...localGuestfs, image: e.target.value })
                          }
                          fullWidth
                          size="small"
                          error={!!imgErr}
                          helperText={
                            imgErr ||
                            'Leave empty to use the default image. Override for custom or airgapped deployments.'
                          }
                          placeholder={INSPECTOR_IMAGE}
                          sx={{ mb: 2 }}
                        />
                        <Box display="flex" gap={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            onClick={() => {
                              setLocalGuestfs(defaultGuestfsSettings);
                            }}
                          >
                            Reset to default
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            disabled={!!imgErr}
                            onClick={() => {
                              saveGuestfsSettings(localGuestfs);
                              setGuestfsSettings(localGuestfs);
                              setGuestfsEditing(false);
                              enqueueSnackbar('Disk Inspector settings saved', {
                                variant: 'success',
                              });
                            }}
                          >
                            Save
                          </Button>
                        </Box>
                      </>
                    );
                  })()
                ) : (
                  <Box mt={0.5}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >
                      Image: {guestfsSettings.image || INSPECTOR_IMAGE}
                    </Typography>
                  </Box>
                )}
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
                      disabled={
                        !newLabelName ||
                        !newLabelKey ||
                        !isValidColumnName(newLabelName) ||
                        !isValidK8sLabelKey(newLabelKey)
                      }
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
                            `Failed to remove monitoring config: ${safeError(
                              error,
                              'monitoring-remove'
                            )}`,
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
      <FeatureGatesSection
        kubeVirt={kubeVirt}
        enabledFeatureGates={enabledFeatureGates}
        sidebarReloadWarnings={sidebarReloadWarnings}
        updating={updating}
        onToggleFeatureGate={handleFeatureGateToggle}
        onUpdateMigrationConfig={handleMigrationConfigUpdate}
        onUpdateHostDevices={handleHostDevicesConfigUpdate}
      />

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
