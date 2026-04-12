/**
 * VMFormFull - Full-featured VM creation form
 * Converted from CreateVM.tsx to work with CreateResourceDialog
 * Preserves all sections: Network, Advanced, Cloud-Init, SSH, etc.
 */

import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import KubeVirt from '../../kubevirt/KubeVirt';
import { DVTStorageSpec } from '../../types';
import { TOOLTIPS } from '../../utils/tooltips';
import DataSource from '../BootableVolumes/DataSource';
import CopyCodeBlock from '../common/CopyCodeBlock';
import InfoTooltip from '../common/InfoTooltip';
import MandatoryTextField, { mandatoryFieldSx } from '../common/MandatoryTextField';
import CatalogButton from '../DataImportCrons/CatalogButton';
import ImageCatalogPicker, { CatalogSelection } from '../DataImportCrons/ImageCatalogPicker';
import VirtualMachineClusterInstanceType from '../InstanceTypes/VirtualMachineClusterInstanceType';
import NetworkAttachmentDefinition from '../NetworkAttachmentDefinitions/NetworkAttachmentDefinition';

/** Parse a Kubernetes size string (e.g. "30Gi", "500Mi") to bytes for comparison */
function parseSizeToBytes(size: string): number {
  const match = size?.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2] || '';
  const multipliers: Record<string, number> = {
    '': 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  return value * (multipliers[unit] || 1);
}

interface MetadataEntry {
  key: string;
  value: string;
}

interface NetworkInterface {
  name: string;
  type: 'pod' | 'nad';
  nadName?: string;
  model?: 'e1000e' | 'virtio';
  macAddress?: string;
  showAdvanced?: boolean;
}

interface AdditionalDisk {
  name: string;
  sourceType:
    | 'empty'
    | 'blank'
    | 'containerDisk'
    | 'persistentVolumeClaim'
    | 'snapshot'
    | 'clone'
    | 'dataVolume'
    | 'dataVolumeExisting'
    | 'ephemeral'
    | 'hostDisk'
    | 'configMap'
    | 'secret'
    | 'serviceAccount';
  sourceDetail?: string;
  sourceNamespace?: string;
  bus: 'virtio' | 'sata' | 'scsi';
  size?: string;
  storageClass?: string;
  accessMode?: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany';
  volumeMode?: 'Filesystem' | 'Block';
  bootOrder?: number;
  serial?: string;
  isBootable?: boolean;
  preallocation?: boolean;
  // For DataVolume import
  dataVolumeSourceType?: 'http' | 'registry' | 'blank' | 'upload';
  dataVolumeUrl?: string;
}

interface NodeSelectorEntry {
  key: string;
  value: string;
}

interface Toleration {
  key: string;
  value: string;
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
  operator?: 'Equal' | 'Exists';
}

interface AffinityRule {
  type: 'nodeAffinity' | 'podAffinity' | 'podAntiAffinity';
  condition: 'required' | 'preferred';
  weight?: number;
  nodeLabels?: Array<{ key: string; operator: string; values: string[] }>;
  nodeFields?: Array<{ key: string; operator: string; values: string[] }>;
  topologyKey?: string;
  podLabels?: Array<{ key: string; operator: string; values: string[] }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Permissive record type for building Kubernetes resource objects with deep nesting */
type KubeResourceBuilder = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface VMFormFullProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function VMFormFull({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: VMFormFullProps) {
  const { enqueueSnackbar } = useSnackbar();

  // Fetch available resources
  const { items: dataSources } = DataSource.useList();
  const { items: instanceTypes } = VirtualMachineClusterInstanceType.useList();

  // Filter cluster-provided instance types
  const clusterInstanceTypes = instanceTypes?.filter(it => it.isClusterProvided()) || [];

  // Parse current values from resource
  const name = resource.metadata?.name || '';
  const namespace = resource.metadata?.namespace || 'default';

  // Labels and Annotations
  // Use local state for UI arrays (labels, annotations, etc.) to support empty entries
  const [labels, setLabels] = React.useState<Array<{ key: string; value: string }>>([]);
  const [annotations, setAnnotations] = React.useState<Array<{ key: string; value: string }>>([]);

  // Initialize from resource when it changes
  React.useEffect(() => {
    const labelObj = resource.metadata?.labels || {};
    const labelEntries = Object.entries(labelObj).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    setLabels(labelEntries.length > 0 ? labelEntries : []);
  }, [resource.metadata?.labels]);

  React.useEffect(() => {
    const annotationObj = resource.metadata?.annotations || {};
    const annotationEntries = Object.entries(annotationObj).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    setAnnotations(annotationEntries.length > 0 ? annotationEntries : []);
  }, [resource.metadata?.annotations]);

  // Keep boot volume entries in sync with dataVolumeTemplates and VM name.
  // This useEffect ensures that whenever a boot source is selected or the VM
  // name changes, the matching volume and disk entries are always present and
  // correctly named — regardless of the order the user fills in the form.
  React.useEffect(() => {
    const dvts = resource.spec?.dataVolumeTemplates;
    if (!dvts?.length) return;

    // Only act on the boot source DVT (identified by sourceRef or name ending in -boot-volume).
    // User-added DataVolume disks use `source` and should not be touched.
    const bootDvtIndex = dvts.findIndex(
      (d: KubeResourceBuilder) => d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
    );
    if (bootDvtIndex === -1) return;

    const vmName = resource.metadata?.name || '';
    const expectedBootName = `${vmName}-boot-volume`;
    const currentDvtName = dvts[bootDvtIndex].metadata?.name;
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];

    const dvtNeedsRename = currentDvtName !== expectedBootName;
    const hasCorrectVolume = volumes.some(
      (v: KubeResourceBuilder) => v.dataVolume?.name === expectedBootName
    );
    const hasCorrectDisk = disks.some((d: KubeResourceBuilder) => d.name === expectedBootName);

    if (!dvtNeedsRename && hasCorrectVolume && hasCorrectDisk) return;

    // Remove any stale boot-volume entries
    const filteredVolumes = volumes.filter(
      (v: KubeResourceBuilder) => !v.dataVolume || !v.dataVolume.name?.endsWith('-boot-volume')
    );
    const filteredDisks = disks.filter(
      (d: KubeResourceBuilder) => !d.name?.endsWith('-boot-volume')
    );

    // Update only the boot DVT in the array, preserving other DVTs
    const newDvts = [...dvts];
    if (dvtNeedsRename) {
      newDvts[bootDvtIndex] = {
        ...dvts[bootDvtIndex],
        metadata: { ...dvts[bootDvtIndex].metadata, name: expectedBootName },
      };
    }

    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        dataVolumeTemplates: newDvts,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                disks: [{ name: expectedBootName, disk: { bus: 'virtio' } }, ...filteredDisks],
              },
            },
            volumes: [
              { name: expectedBootName, dataVolume: { name: expectedBootName } },
              ...filteredVolumes,
            ],
          },
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.metadata?.name, resource.spec?.dataVolumeTemplates]);

  // Parse more state from resource
  const bootSourceId = resource.spec?.dataVolumeTemplates?.[0]?.spec?.sourceRef?.name || '';

  // Detect boot source type from existing DVT
  const bootDvt = resource.spec?.dataVolumeTemplates?.find(
    (d: KubeResourceBuilder) => d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
  );
  const derivedBootSourceType: string = bootDvt
    ? bootDvt.spec?.sourceRef
      ? 'dataSource'
      : bootDvt.spec?.source?.registry
      ? 'registry'
      : bootDvt.spec?.source?.http
      ? 'http'
      : bootDvt.spec?.source?.pvc
      ? 'pvc'
      : bootDvt.spec?.source?.upload
      ? 'upload'
      : bootDvt.spec?.source?.blank
      ? 'blank'
      : ''
    : '';
  // Local state to track boot source type selection (needed for dataSource
  // where the DVT doesn't exist until a DataSource is actually picked)
  const [bootSourceTypeOverride, setBootSourceTypeOverride] = React.useState('');
  const bootSourceType = bootSourceTypeOverride || derivedBootSourceType;
  const [bootCatalogOpen, setBootCatalogOpen] = useState(false);

  const handleBootCatalogSelect = (selection: CatalogSelection) => {
    setBootSourceTypeOverride('registry');
    handleBootDvtUpdate(
      { source: { registry: { url: selection.registryUrl } } },
      selection.storageSize
    );
  };

  const resourceMode = resource.spec?.instancetype ? 'instanceType' : 'custom';
  const selectedInstanceTypeName = resource.spec?.instancetype?.name || '';
  const selectedInstanceType =
    clusterInstanceTypes.find(it => it.getName() === selectedInstanceTypeName) || null;

  // SSH Key from resource
  // eslint-disable-next-line no-unused-vars
  const sshKey =
    resource.spec?.template?.spec?.accessCredentials?.[0]?.sshPublicKey?.source?.secret
      ?.secretName || '';

  // Run strategy
  // eslint-disable-next-line no-unused-vars
  const runStrategyValue = resource.spec?.runStrategy || 'Always';

  // Custom CPU/Memory
  const customCpu = resource.spec?.template?.spec?.domain?.cpu?.cores?.toString() || '2';
  const customMemoryValue =
    resource.spec?.template?.spec?.domain?.resources?.requests?.memory || '4Gi';
  const customMemoryMatch = customMemoryValue.match(/^(\d+)(Mi|Gi)$/);
  const customMemory = customMemoryMatch ? customMemoryMatch[1] : '4';
  const customMemoryUnit = (customMemoryMatch ? customMemoryMatch[2] : 'Gi') as 'Mi' | 'Gi';

  // Advanced CPU topology
  const cpuTopology = resource.spec?.template?.spec?.domain?.cpu;
  const useAdvancedTopology = !!(cpuTopology?.sockets || cpuTopology?.threads);
  const cpuCores = cpuTopology?.cores?.toString() || '1';
  const cpuSockets = cpuTopology?.sockets?.toString() || '1';
  const cpuThreads = cpuTopology?.threads?.toString() || '1';

  // Network interfaces from resource
  const currentNetworkInterfaces: NetworkInterface[] = React.useMemo(() => {
    const interfaces = resource.spec?.template?.spec?.domain?.devices?.interfaces || [];
    const networks = resource.spec?.template?.spec?.networks || [];

    return interfaces.map((iface: KubeResourceBuilder, idx: number) => {
      const network = networks[idx];
      const isPod = !!network?.pod;
      const nadName = network?.multus?.networkName;

      return {
        name: iface.name || `net-${idx}`,
        type: isPod ? ('pod' as const) : ('nad' as const),
        nadName,
        model: iface.model as 'e1000e' | 'virtio',
        macAddress: iface.macAddress,
        showAdvanced: false,
      };
    });
  }, [resource.spec?.template?.spec]);

  // Run strategy
  const runStrategy = resource.spec?.runStrategy || 'Always';

  // Parse additional disks from resource (excluding special boot volumes like cloudinitdisk and rootdisk)
  const currentAdditionalDisks: AdditionalDisk[] = React.useMemo(() => {
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];

    // Parse volumes, excluding cloudinitdisk and rootdisk
    const additionalVolumes = volumes.filter(
      (v: KubeResourceBuilder) =>
        v.name !== 'cloudinitdisk' && !v.name?.includes('root') && !v.name?.includes('boot')
    );

    return additionalVolumes.map((vol: KubeResourceBuilder) => {
      const diskDevice = disks.find((d: KubeResourceBuilder) => d.name === vol.name);
      const bus = diskDevice?.disk?.bus || 'virtio';

      // Determine source type from volume structure
      let sourceType: AdditionalDisk['sourceType'] = 'empty';
      let sourceDetail: string | undefined;
      let sourceNamespace: string | undefined;
      let dataVolumeSourceType: AdditionalDisk['dataVolumeSourceType'];
      let dataVolumeUrl: string | undefined;
      let dvtSize: string | undefined;
      let dvtStorageClass: string | undefined;
      let dvtAccessMode: AdditionalDisk['accessMode'];

      if (vol.configMap) {
        sourceType = 'configMap';
        sourceDetail = vol.configMap.name;
      } else if (vol.secret) {
        sourceType = 'secret';
        sourceDetail = vol.secret.secretName;
      } else if (vol.serviceAccount) {
        sourceType = 'serviceAccount';
        sourceDetail = vol.serviceAccount.serviceAccountName;
      } else if (vol.containerDisk) {
        sourceType = 'containerDisk';
        sourceDetail = vol.containerDisk.image;
      } else if (vol.persistentVolumeClaim) {
        sourceType = 'persistentVolumeClaim';
        sourceDetail = vol.persistentVolumeClaim.claimName;
      } else if (vol.dataVolume) {
        sourceType = 'dataVolume';
        sourceDetail = vol.dataVolume.name;
        // Look up DVT to get import details for rehydration
        const dvt = (resource.spec?.dataVolumeTemplates || []).find(
          (d: KubeResourceBuilder) => d.metadata?.name === vol.dataVolume.name
        );
        if (dvt?.spec?.source) {
          // This is an imported DataVolume, not a boot source (which uses sourceRef)
          if (dvt.spec.source.http) {
            dataVolumeSourceType = 'http';
            dataVolumeUrl = dvt.spec.source.http.url;
          } else if (dvt.spec.source.registry) {
            dataVolumeSourceType = 'registry';
            dataVolumeUrl = dvt.spec.source.registry.url;
          } else if (dvt.spec.source.blank) {
            dataVolumeSourceType = 'blank';
          }
          // Get storage details from DVT
          dvtSize = dvt.spec.storage?.resources?.requests?.storage;
          dvtStorageClass = dvt.spec.storage?.storageClassName;
          dvtAccessMode = dvt.spec.storage?.accessModes?.[0];
        }
      } else if (vol.ephemeral) {
        sourceType = 'ephemeral';
        sourceDetail = vol.ephemeral.persistentVolumeClaim?.claimName;
      } else if (vol.hostDisk) {
        sourceType = 'hostDisk';
        sourceDetail = vol.hostDisk.path;
      } else if (vol.emptyDisk) {
        sourceType = 'empty';
      }

      // Determine volumeMode - if serial exists, it's Block mode, otherwise Filesystem
      const volumeMode = diskDevice?.serial ? 'Block' : 'Filesystem';
      const serial = diskDevice?.serial;

      return {
        name: vol.name,
        sourceType,
        sourceDetail,
        sourceNamespace,
        bus,
        volumeMode,
        serial,
        accessMode: dvtAccessMode || ('ReadWriteOnce' as const),
        size: dvtSize || vol.emptyDisk?.capacity || '10Gi',
        storageClass: dvtStorageClass,
        dataVolumeSourceType,
        dataVolumeUrl,
      };
    });
  }, [resource.spec?.template?.spec]);

  // Parse scheduling configuration - use local state for UI
  const [currentNodeSelectors, setCurrentNodeSelectors] = React.useState<NodeSelectorEntry[]>([]);
  const [currentTolerations, setCurrentTolerations] = React.useState<Toleration[]>([]);
  const [currentAffinityRules, setCurrentAffinityRules] = React.useState<AffinityRule[]>([]);

  // Initialize node selectors from resource
  React.useEffect(() => {
    const selectorObj = resource.spec?.template?.spec?.nodeSelector || {};
    const entries = Object.entries(selectorObj).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    setCurrentNodeSelectors(entries);
  }, [resource.spec?.template?.spec?.nodeSelector]);

  // Initialize tolerations from resource
  React.useEffect(() => {
    const tolerations = resource.spec?.template?.spec?.tolerations || [];
    setCurrentTolerations(tolerations);
  }, [resource.spec?.template?.spec?.tolerations]);

  // Initialize affinity rules from resource
  React.useEffect(() => {
    const affinity = resource.spec?.template?.spec?.affinity;
    if (!affinity) {
      setCurrentAffinityRules([]);
      return;
    }

    const rules: AffinityRule[] = [];

    // Parse nodeAffinity
    if (affinity.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
      const required = affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      required.nodeSelectorTerms?.forEach((term: KubeResourceBuilder) => {
        if (term.matchExpressions) {
          rules.push({
            type: 'nodeAffinity',
            condition: 'required',
            nodeLabels: term.matchExpressions.map((exp: KubeResourceBuilder) => ({
              key: exp.key,
              operator: exp.operator,
              values: exp.values || [],
            })),
          });
        }
      });
    }

    if (affinity.nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution) {
      const preferred = affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution;
      preferred.forEach((pref: KubeResourceBuilder) => {
        if (pref.preference?.matchExpressions) {
          rules.push({
            type: 'nodeAffinity',
            condition: 'preferred',
            weight: pref.weight,
            nodeLabels: pref.preference.matchExpressions.map((exp: KubeResourceBuilder) => ({
              key: exp.key,
              operator: exp.operator,
              values: exp.values || [],
            })),
          });
        }
      });
    }

    // Parse podAffinity
    if (affinity.podAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
      const required = affinity.podAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      required.forEach((term: KubeResourceBuilder) => {
        rules.push({
          type: 'podAffinity',
          condition: 'required',
          topologyKey: term.topologyKey,
          podLabels:
            term.labelSelector?.matchExpressions?.map((exp: KubeResourceBuilder) => ({
              key: exp.key,
              operator: exp.operator,
              values: exp.values || [],
            })) || [],
        });
      });
    }

    if (affinity.podAffinity?.preferredDuringSchedulingIgnoredDuringExecution) {
      const preferred = affinity.podAffinity.preferredDuringSchedulingIgnoredDuringExecution;
      preferred.forEach((pref: KubeResourceBuilder) => {
        rules.push({
          type: 'podAffinity',
          condition: 'preferred',
          weight: pref.weight,
          topologyKey: pref.podAffinityTerm.topologyKey,
          podLabels:
            pref.podAffinityTerm.labelSelector?.matchExpressions?.map(
              (exp: KubeResourceBuilder) => ({
                key: exp.key,
                operator: exp.operator,
                values: exp.values || [],
              })
            ) || [],
        });
      });
    }

    // Parse podAntiAffinity
    if (affinity.podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
      const required = affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      required.forEach((term: KubeResourceBuilder) => {
        rules.push({
          type: 'podAntiAffinity',
          condition: 'required',
          topologyKey: term.topologyKey,
          podLabels:
            term.labelSelector?.matchExpressions?.map((exp: KubeResourceBuilder) => ({
              key: exp.key,
              operator: exp.operator,
              values: exp.values || [],
            })) || [],
        });
      });
    }

    if (affinity.podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution) {
      const preferred = affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution;
      preferred.forEach((pref: KubeResourceBuilder) => {
        rules.push({
          type: 'podAntiAffinity',
          condition: 'preferred',
          weight: pref.weight,
          topologyKey: pref.podAffinityTerm.topologyKey,
          podLabels:
            pref.podAffinityTerm.labelSelector?.matchExpressions?.map(
              (exp: KubeResourceBuilder) => ({
                key: exp.key,
                operator: exp.operator,
                values: exp.values || [],
              })
            ) || [],
        });
      });
    }

    setCurrentAffinityRules(rules);
  }, [resource.spec?.template?.spec?.affinity]);

  const enableLiveMigrate = resource.spec?.template?.spec?.evictionStrategy === 'LiveMigrate';

  // Parse advanced details (Virtual Hardware + User Data)
  const firmwareType = resource.spec?.template?.spec?.domain?.firmware?.bootloader?.efi
    ? 'uefi'
    : 'bios';
  const cpuModel = resource.spec?.template?.spec?.domain?.cpu?.model || '';
  const enableNestedVirtualization =
    resource.spec?.template?.spec?.domain?.cpu?.features?.some(
      (f: KubeResourceBuilder) => f.name === 'vmx' || f.name === 'svm'
    ) || false;
  const machineType = resource.spec?.template?.spec?.domain?.machine?.type || '';
  const enableAcpi = resource.spec?.template?.spec?.domain?.features?.acpi?.enabled !== false;
  const enableTPM = !!resource.spec?.template?.spec?.domain?.devices?.tpm;
  const enableEfiPersistent =
    !!resource.spec?.template?.spec?.domain?.firmware?.bootloader?.efi?.persistent;
  const isUefi = firmwareType === 'uefi';
  const hugepages = resource.spec?.template?.spec?.domain?.memory?.hugepages?.pageSize || '';
  const timezone = resource.spec?.template?.spec?.domain?.clock?.timezone || '';

  // Performance
  const devices = resource.spec?.template?.spec?.domain?.devices;
  const enableBlockMultiQueue = !!devices?.blockMultiQueue;
  const enableNetMultiQueue = !!devices?.networkInterfaceMultiqueue;
  const ioThreadsPolicy = resource.spec?.template?.spec?.domain?.ioThreadsPolicy || '';

  // Devices
  const enableSound = !!devices?.sound;
  const enableWatchdog = !!devices?.watchdog;
  const watchdogAction = devices?.watchdog?.action || 'reset';
  const enableRng = !!devices?.rng;
  const enableDownwardMetrics = !!devices?.downwardMetrics;

  // Security
  const enableSmm = !!resource.spec?.template?.spec?.domain?.features?.smm?.enabled;

  // Auto-attach (all default to true when absent)
  const autoGraphics = devices?.autoattachGraphicsDevice !== false;
  const autoSerial = devices?.autoattachSerialConsole !== false;
  const autoMemBalloon = devices?.autoattachMemBalloon !== false;
  const autoPodInterface = devices?.autoattachPodInterface !== false;
  const autoVSOCK = devices?.autoattachVSOCK !== false;
  const autoInputDevice = devices?.autoattachInputDevice !== false;

  // Scheduling
  const priorityClassName = resource.spec?.template?.spec?.priorityClassName || '';

  // User Data configuration
  const userDataMode = resource.spec?.template?.spec?.volumes?.some(
    (v: KubeResourceBuilder) => v.cloudInitConfigDrive
  )
    ? 'ignition'
    : 'cloudInit';
  const cloudInitVolume = resource.spec?.template?.spec?.volumes?.find(
    (v: KubeResourceBuilder) => v.cloudInitNoCloud
  );
  const ignitionVolume = resource.spec?.template?.spec?.volumes?.find(
    (v: KubeResourceBuilder) => v.cloudInitConfigDrive
  );

  // Parse Cloud-Init data
  const cloudInitUserData = cloudInitVolume?.cloudInitNoCloud?.userData || '';
  const cloudInitNetworkData = cloudInitVolume?.cloudInitNoCloud?.networkData || '';
  const cloudInitUserDataSecret = cloudInitVolume?.cloudInitNoCloud?.secretRef?.name || '';
  const cloudInitNetworkDataSecret =
    cloudInitVolume?.cloudInitNoCloud?.networkDataSecretRef?.name || '';

  // Parse Ignition data
  const ignitionData = ignitionVolume?.cloudInitConfigDrive?.userData || '';
  const ignitionDataSecret = ignitionVolume?.cloudInitConfigDrive?.secretRef?.name || '';

  // Local state for UI interactions (disk form, user data types, etc.)
  const [cloudInitUserDataType, setCloudInitUserDataType] = useState<
    'inline' | 'base64' | 'secret'
  >(cloudInitUserDataSecret ? 'secret' : 'inline');
  const [cloudInitNetworkDataType, setCloudInitNetworkDataType] = useState<
    'inline' | 'base64' | 'secret'
  >(cloudInitNetworkDataSecret ? 'secret' : 'inline');
  const [ignitionDataType, setIgnitionDataType] = useState<'inline' | 'base64' | 'secret'>(
    ignitionDataSecret ? 'secret' : 'inline'
  );
  const [showDiskForm, setShowDiskForm] = useState(false);
  const [diskEditIndex, setDiskEditIndex] = useState<number | null>(null);
  const [diskFormData, setDiskFormData] = useState<AdditionalDisk>({
    name: '',
    sourceType: 'empty',
    bus: 'virtio',
    size: '10Gi',
    storageClass: '',
    accessMode: 'ReadWriteOnce',
    volumeMode: 'Block',
    isBootable: false,
    preallocation: false,
  });

  // Fetch namespaces, configmaps, secrets, nodes, etc.
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [configMaps, setConfigMaps] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [serviceAccounts, setServiceAccounts] = useState<string[]>([]);
  const [pvcs, setPvcs] = useState<string[]>([]);
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const [volumeSnapshots, setVolumeSnapshots] = useState<string[]>([]);
  const [dataVolumes, setDataVolumes] = useState<string[]>([]);
  const [nodeLabels, setNodeLabels] = useState<string[]>([]); // Available node label keys

  // Fetch permitted host devices from KubeVirt CR for device passthrough
  const { items: kubeVirtConfigs } = KubeVirt.useList();
  const kvConfig = kubeVirtConfigs?.[0];
  const permittedPciDevices = kvConfig?.getPciHostDevices() || [];
  const permittedMediatedDevices = kvConfig?.getMediatedDevices() || [];
  const allPermittedDeviceNames = [
    ...permittedPciDevices.map(d => d.resourceName),
    ...permittedMediatedDevices.map(d => d.resourceName),
  ];
  const [newGpu, setNewGpu] = useState({ name: '', deviceName: '' });
  const [newHostDev, setNewHostDev] = useState({ name: '', deviceName: '' });

  // Local state for complex UI interactions
  const [useAdvancedTopologyState, setUseAdvancedTopologyState] = useState(useAdvancedTopology);

  // Fetch NADs for the selected namespace
  const { items: networkAttachmentDefs } = NetworkAttachmentDefinition.useList({ namespace });

  // Calculate total vCPUs
  const totalVCPUs = useAdvancedTopologyState
    ? parseInt(cpuCores || '1') * parseInt(cpuSockets || '1') * parseInt(cpuThreads || '1')
    : parseInt(customCpu || '1');

  // Get selected boot source
  const selectedBootSource = dataSources?.find(ds => ds.getName() === bootSourceId);

  // Check if pod networking exists
  const hasPodNetworking = currentNetworkInterfaces.some(iface => iface.type === 'pod');

  React.useEffect(() => {
    let cancelled = false;
    ApiProxy.request('/api/v1/namespaces')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const nsList = response?.items?.map(
            (ns: { metadata: { name: string } }) => ns.metadata.name
          ) || ['default'];
          setNamespaces(nsList);
        }
      )
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to fetch namespaces:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch ConfigMaps, Secrets, ServiceAccounts for selected namespace
  React.useEffect(() => {
    if (!namespace) return;
    let cancelled = false;

    // Fetch ConfigMaps
    ApiProxy.request(`/api/v1/namespaces/${namespace}/configmaps`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const cmList =
            response?.items?.map((cm: { metadata: { name: string } }) => cm.metadata.name) || [];
          setConfigMaps(cmList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch configmaps:', err);
      });

    // Fetch Secrets
    ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const secretList =
            response?.items?.map((s: { metadata: { name: string } }) => s.metadata.name) || [];
          setSecrets(secretList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch secrets:', err);
      });

    // Fetch ServiceAccounts
    ApiProxy.request(`/api/v1/namespaces/${namespace}/serviceaccounts`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const saList =
            response?.items?.map((sa: { metadata: { name: string } }) => sa.metadata.name) || [];
          setServiceAccounts(saList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch serviceaccounts:', err);
      });

    // Fetch PVCs
    ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const pvcList =
            response?.items?.map((pvc: { metadata: { name: string } }) => pvc.metadata.name) || [];
          setPvcs(pvcList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch pvcs:', err);
      });

    // Fetch VolumeSnapshots
    ApiProxy.request(`/apis/snapshot.storage.k8s.io/v1/namespaces/${namespace}/volumesnapshots`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const vsList =
            response?.items?.map((vs: { metadata: { name: string } }) => vs.metadata.name) || [];
          setVolumeSnapshots(vsList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch volume snapshots:', err);
      });

    // Fetch DataVolumes
    ApiProxy.request(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const dvList =
            response?.items?.map((dv: { metadata: { name: string } }) => dv.metadata.name) || [];
          setDataVolumes(dvList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch datavolumes:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [namespace]);

  // Fetch StorageClasses and Nodes (cluster-wide)
  React.useEffect(() => {
    let cancelled = false;
    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const scList =
            response?.items?.map((sc: { metadata: { name: string } }) => sc.metadata.name) || [];
          setStorageClasses(scList);
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch storage classes:', err);
      });

    // Fetch nodes and extract unique label keys
    ApiProxy.request('/api/v1/nodes')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          if (cancelled) return;
          const nodes = response?.items || [];
          const labelKeysSet = new Set<string>();
          nodes.forEach((node: KubeResourceBuilder) => {
            if (node.metadata?.labels) {
              Object.keys(node.metadata.labels).forEach(key => labelKeysSet.add(key));
            }
          });
          setNodeLabels(Array.from(labelKeysSet).sort());
        }
      )
      .catch(err => {
        if (!cancelled) console.error('Failed to fetch nodes:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Helper functions to update resource
  const updateMetadata = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      metadata: {
        ...resource.metadata,
        ...updates,
      },
    });
  };

  const updateSpec = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        ...updates,
      },
    });
  };

  // eslint-disable-next-line no-unused-vars
  const updateTemplate = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          ...updates,
        },
      },
    });
  };

  const updateTemplateSpec = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            ...updates,
          },
        },
      },
    });
  };

  const updateDomain = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              ...updates,
            },
          },
        },
      },
    });
  };

  // eslint-disable-next-line no-unused-vars
  const updateDevices = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                ...updates,
              },
            },
          },
        },
      },
    });
  };

  const updateResources = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              resources: {
                ...resource.spec?.template?.spec?.domain?.resources,
                ...updates,
              },
            },
          },
        },
      },
    });
  };

  // Handler functions
  const handleNameChange = (value: string) => {
    // Just update the name; the boot volume useEffect below keeps
    // dataVolumeTemplates, volumes, and disks in sync automatically.
    updateMetadata({ name: value });
  };

  const handleNamespaceChange = (value: string) => {
    updateMetadata({ namespace: value });
  };

  const handleLabelsChange = (newLabels: MetadataEntry[]) => {
    setLabels(newLabels);

    // Only sync valid entries (non-empty keys) to resource
    const validLabels = newLabels.filter(entry => entry.key);
    const labelObj: Record<string, string> = {};
    validLabels.forEach(entry => {
      labelObj[entry.key] = entry.value;
    });
    updateMetadata({ labels: Object.keys(labelObj).length > 0 ? labelObj : undefined });
  };

  const handleAnnotationsChange = (newAnnotations: MetadataEntry[]) => {
    setAnnotations(newAnnotations);

    // Only sync valid entries (non-empty keys) to resource
    const validAnnotations = newAnnotations.filter(entry => entry.key);
    const annotationObj: Record<string, string> = {};
    validAnnotations.forEach(entry => {
      annotationObj[entry.key] = entry.value;
    });
    updateMetadata({
      annotations: Object.keys(annotationObj).length > 0 ? annotationObj : undefined,
    });
  };

  // Boot Source handlers
  const handleBootSourceChange = (sourceName: string) => {
    const source = dataSources?.find(ds => ds.getName() === sourceName);
    if (!source) return;

    const storageClass = source.getStorageClass();
    const storage: DVTStorageSpec = {
      resources: {
        requests: {
          storage: source.getSize(),
        },
      },
    };
    // Only set storageClassName when it's a real value (not the '-' fallback)
    if (storageClass && storageClass !== '-') {
      storage.storageClassName = storageClass;
    }

    const dataVolumeTemplate = {
      metadata: {
        name: `${name}-boot-volume`,
      },
      spec: {
        sourceRef: {
          kind: 'DataSource',
          name: source.getName(),
          namespace: source.getNamespace(),
        },
        storage,
      },
    };

    // Only set dataVolumeTemplates here; the useEffect below ensures
    // matching volume/disk entries stay in sync automatically.
    updateSpec({ dataVolumeTemplates: [dataVolumeTemplate] });
  };

  const handleBootDvtUpdate = (sourceSpec: KubeResourceBuilder, size?: string) => {
    const dvts = resource.spec?.dataVolumeTemplates || [];
    // Find existing boot DVT or create new
    const bootIdx = dvts.findIndex(
      (d: KubeResourceBuilder) => d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
    );

    const storage: DVTStorageSpec = {
      resources: {
        requests: {
          storage: size || '30Gi',
        },
      },
    };

    // Preserve existing storage settings when just changing the source
    if (bootIdx >= 0) {
      const existing = dvts[bootIdx];
      if (existing.spec?.storage?.storageClassName) {
        storage.storageClassName = existing.spec.storage.storageClassName;
      }
      if (existing.spec?.storage?.resources?.requests?.storage) {
        storage.resources.requests.storage = existing.spec.storage.resources.requests.storage;
      }
    }

    const newBootDvt = {
      metadata: {
        name: `${name}-boot-volume`,
      },
      spec: {
        ...sourceSpec,
        storage,
      },
    };

    if (bootIdx >= 0) {
      const newDvts = [...dvts];
      newDvts[bootIdx] = newBootDvt;
      updateSpec({ dataVolumeTemplates: newDvts });
    } else {
      updateSpec({ dataVolumeTemplates: [...dvts, newBootDvt] });
    }
  };

  const clearBootSource = () => {
    const dvts = (resource.spec?.dataVolumeTemplates || []).filter(
      (d: KubeResourceBuilder) => !d.metadata?.name?.endsWith('-boot-volume')
    );
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        dataVolumeTemplates: dvts.length > 0 ? dvts : undefined,
      },
    });
  };

  // Resource Mode handlers
  const handleResourceModeChange = (mode: 'instanceType' | 'custom') => {
    if (mode === 'instanceType') {
      // Clear custom resources, set placeholder instancetype
      const newSpec = { ...resource.spec };
      if (newSpec.template?.spec?.domain) {
        const domain = { ...newSpec.template.spec.domain };
        delete domain.cpu;
        delete domain.resources;
        newSpec.template = {
          ...newSpec.template,
          spec: {
            ...newSpec.template.spec,
            domain,
          },
        };
      }
      // Set empty instancetype placeholder so radio stays selected
      newSpec.instancetype = {
        kind: 'VirtualMachineClusterInstancetype',
        name: '',
      };
      onChange({ ...resource, spec: newSpec });
    } else {
      // Clear instance type and set default custom resources
      const newSpec = { ...resource.spec };
      delete newSpec.instancetype;
      delete newSpec.preference;

      onChange({
        ...resource,
        spec: {
          ...newSpec,
          template: {
            ...newSpec.template,
            spec: {
              ...newSpec.template?.spec,
              domain: {
                ...newSpec.template?.spec?.domain,
                cpu: {
                  cores: 2,
                },
                resources: {
                  requests: {
                    memory: '2Gi',
                  },
                },
              },
            },
          },
        },
      });
    }
  };

  const handleInstanceTypeChange = (instanceType: VirtualMachineClusterInstanceType | null) => {
    if (instanceType) {
      updateSpec({
        instancetype: {
          kind: 'VirtualMachineClusterInstancetype',
          name: instanceType.getName(),
        },
      });
    } else {
      const newSpec = { ...resource.spec };
      delete newSpec.instancetype;
      onChange({ ...resource, spec: newSpec });
    }
  };

  const handleCustomCpuChange = (value: string) => {
    const cores = parseInt(value);
    if (!isNaN(cores) && cores > 0) {
      updateDomain({
        cpu: { cores },
      });
    }
  };

  const handleCustomMemoryChange = (value: string, unit: 'Mi' | 'Gi') => {
    const amount = parseInt(value);
    if (!isNaN(amount) && amount > 0) {
      updateResources({
        requests: {
          memory: `${amount}${unit}`,
        },
      });
    }
  };

  const handleAdvancedTopologyChange = (cores: string, sockets: string, threads: string) => {
    const coresNum = parseInt(cores);
    const socketsNum = parseInt(sockets);
    const threadsNum = parseInt(threads);

    if (!isNaN(coresNum) && !isNaN(socketsNum) && !isNaN(threadsNum)) {
      updateDomain({
        cpu: {
          cores: coresNum,
          sockets: socketsNum,
          threads: threadsNum,
        },
      });
    }
  };

  // Network Interface handlers
  const handleNetworkInterfacesChange = (newInterfaces: NetworkInterface[]) => {
    // Build interfaces and networks arrays
    const interfaces = newInterfaces.map(iface => {
      const interfaceObj: KubeResourceBuilder = {
        name: iface.name,
        model: iface.model || 'virtio',
      };

      if (iface.type === 'pod') {
        interfaceObj.masquerade = {};
      } else {
        interfaceObj.bridge = {};
      }

      if (iface.macAddress) {
        interfaceObj.macAddress = iface.macAddress;
      }

      return interfaceObj;
    });

    const networks = newInterfaces.map(iface => {
      if (iface.type === 'pod') {
        return {
          name: iface.name,
          pod: {},
        };
      } else {
        return {
          name: iface.name,
          multus: {
            networkName: iface.nadName,
          },
        };
      }
    });

    // Update both interfaces and networks in a single onChange call
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            networks,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                interfaces,
              },
            },
          },
        },
      },
    });
  };

  const addNetworkInterface = () => {
    const newName = `net-${currentNetworkInterfaces.length}`;
    const newInterfaces = [
      ...currentNetworkInterfaces,
      { name: newName, type: 'nad' as const, model: 'virtio' as const },
    ];
    handleNetworkInterfacesChange(newInterfaces);
  };

  const removeNetworkInterface = (index: number) => {
    const newInterfaces = currentNetworkInterfaces.filter((_, i) => i !== index);
    handleNetworkInterfacesChange(newInterfaces);
  };

  const updateNetworkInterface = (index: number, updates: Partial<NetworkInterface>) => {
    const newInterfaces = currentNetworkInterfaces.map((iface, i) =>
      i === index ? { ...iface, ...updates } : iface
    );
    handleNetworkInterfacesChange(newInterfaces);
  };

  // SSH Key handler
  // eslint-disable-next-line no-unused-vars
  const handleSSHKeyChange = (secretName: string) => {
    if (secretName) {
      updateTemplateSpec({
        accessCredentials: [
          {
            sshPublicKey: {
              source: {
                secret: {
                  secretName,
                },
              },
              propagationMethod: {
                noCloud: {},
              },
            },
          },
        ],
      });
    } else {
      // Remove SSH key
      const newSpec = { ...resource.spec };
      if (newSpec.template?.spec) {
        delete newSpec.template.spec.accessCredentials;
      }
      onChange({ ...resource, spec: newSpec });
    }
  };

  // Run Strategy handler
  const handleRunStrategyChange = (strategy: 'Always' | 'Halted') => {
    updateSpec({ runStrategy: strategy });
  };

  // Disk management handlers
  const getSourceTypeLabel = (sourceType: AdditionalDisk['sourceType']): string => {
    const labels: Record<AdditionalDisk['sourceType'], string> = {
      empty: 'Empty Disk',
      blank: 'DataVolume (Blank)',
      containerDisk: 'Container Disk',
      persistentVolumeClaim: 'PVC',
      snapshot: 'PVC Snapshot',
      clone: 'Clone PVC',
      dataVolume: 'DataVolume',
      dataVolumeExisting: 'DataVolume (Existing)',
      ephemeral: 'Ephemeral',
      hostDisk: 'Host Disk',
      configMap: 'ConfigMap',
      secret: 'Secret',
      serviceAccount: 'Service Account',
    };
    return labels[sourceType] || sourceType;
  };

  const [cloneSourcePvcs, setCloneSourcePvcs] = useState<Record<string, string[]>>({});

  const fetchPvcsForNamespace = (ns: string) => {
    if (cloneSourcePvcs[ns]) return;
    ApiProxy.request(`/api/v1/namespaces/${ns}/persistentvolumeclaims`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const pvcList =
            response?.items?.map((pvc: { metadata: { name: string } }) => pvc.metadata.name) || [];
          setCloneSourcePvcs(prev => ({ ...prev, [ns]: pvcList }));
        }
      )
      .catch(err => console.error(`Failed to fetch PVCs for namespace ${ns}:`, err));
  };

  // Auto-fetch resources when disk form opens with certain source types
  React.useEffect(() => {
    if (!showDiskForm) return;

    // Fetch PVCs for clone source type
    if (diskFormData.sourceType === 'clone') {
      const ns = diskFormData.sourceNamespace || namespace;
      fetchPvcsForNamespace(ns);
    }

    // Fetch PVCs for ephemeral source type
    if (diskFormData.sourceType === 'ephemeral') {
      // Ephemeral uses the current namespace's PVCs (already fetched in main useEffect)
    }

    // Initialize dataVolumeSourceType to 'http' if not set
    if (diskFormData.sourceType === 'dataVolume' && !diskFormData.dataVolumeSourceType) {
      setDiskFormData(prev => ({ ...prev, dataVolumeSourceType: 'http' }));
    }
  }, [showDiskForm, diskFormData.sourceType, diskFormData.sourceNamespace, namespace]);

  const startAddDisk = () => {
    const diskNumber =
      currentAdditionalDisks.filter(
        d => !['configMap', 'secret', 'serviceAccount'].includes(d.sourceType)
      ).length + 1;
    setDiskFormData({
      name: `disk-${diskNumber}`,
      sourceType: 'empty',
      bus: 'virtio',
      size: '10Gi',
      storageClass: selectedBootSource?.getStorageClass() || '',
      accessMode: 'ReadWriteOnce',
      volumeMode: 'Block',
      isBootable: false,
      preallocation: false,
    });
    setDiskEditIndex(null);
    setShowDiskForm(true);
  };

  const startEditDisk = (index: number) => {
    setDiskFormData({ ...currentAdditionalDisks[index] });
    setDiskEditIndex(index);
    setShowDiskForm(true);
  };

  const saveDisk = () => {
    if (!diskFormData.name) {
      enqueueSnackbar('Disk name is required', { variant: 'error' });
      return;
    }

    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];
    const dataVolumeTemplates = resource.spec?.dataVolumeTemplates || [];

    // Check if this source type needs DataVolumeTemplate
    const needsDVT = ['clone', 'snapshot', 'dataVolume', 'blank'].includes(diskFormData.sourceType);

    if (diskEditIndex !== null) {
      // Edit existing disk - TODO: handle DVT updates
      const oldDisk = currentAdditionalDisks[diskEditIndex];

      const newVolumes = volumes.map((v: KubeResourceBuilder) => {
        if (v.name !== oldDisk.name) return v;
        return buildVolumeFromDiskFormData(diskFormData);
      });

      const newDisks = disks.map((d: KubeResourceBuilder) => {
        if (d.name !== oldDisk.name) return d;
        return buildDiskDeviceFromDiskFormData(diskFormData);
      });

      onChange({
        ...resource,
        spec: {
          ...resource.spec,
          template: {
            ...resource.spec?.template,
            spec: {
              ...resource.spec?.template?.spec,
              volumes: newVolumes,
              domain: {
                ...resource.spec?.template?.spec?.domain,
                devices: {
                  ...resource.spec?.template?.spec?.domain?.devices,
                  disks: newDisks,
                },
              },
            },
          },
        },
      });
    } else {
      // Add new disk
      const newVolume = buildVolumeFromDiskFormData(diskFormData);
      const newDiskDevice = buildDiskDeviceFromDiskFormData(diskFormData);

      let newDataVolumeTemplates = dataVolumeTemplates;
      if (needsDVT) {
        const dvt = buildDataVolumeTemplate(diskFormData);
        newDataVolumeTemplates = [...dataVolumeTemplates, dvt];
      }

      onChange({
        ...resource,
        spec: {
          ...resource.spec,
          ...(newDataVolumeTemplates.length > 0 && { dataVolumeTemplates: newDataVolumeTemplates }),
          template: {
            ...resource.spec?.template,
            spec: {
              ...resource.spec?.template?.spec,
              volumes: [...volumes, newVolume],
              domain: {
                ...resource.spec?.template?.spec?.domain,
                devices: {
                  ...resource.spec?.template?.spec?.domain?.devices,
                  disks: [...disks, newDiskDevice],
                },
              },
            },
          },
        },
      });
    }

    setShowDiskForm(false);
    setDiskEditIndex(null);
  };

  // Helper to build volume object from disk form data
  const buildVolumeFromDiskFormData = (disk: AdditionalDisk): KubeResourceBuilder => {
    const base = { name: disk.name };

    switch (disk.sourceType) {
      case 'empty':
        return { ...base, emptyDisk: { capacity: disk.size } };
      case 'blank': {
        const vmN = resource.metadata?.name || '';
        return { ...base, dataVolume: { name: vmN ? `${vmN}-${disk.name}` : disk.name } };
      }
      case 'containerDisk':
        return { ...base, containerDisk: { image: disk.sourceDetail } };
      case 'persistentVolumeClaim':
        return { ...base, persistentVolumeClaim: { claimName: disk.sourceDetail } };
      case 'dataVolumeExisting':
        return { ...base, dataVolume: { name: disk.sourceDetail } };
      case 'dataVolume':
      case 'clone':
      case 'snapshot': {
        // These use DataVolumeTemplate — prefix with VM name to avoid collisions
        const vmN2 = resource.metadata?.name || '';
        return { ...base, dataVolume: { name: vmN2 ? `${vmN2}-${disk.name}` : disk.name } };
      }
      case 'configMap':
        return { ...base, configMap: { name: disk.sourceDetail } };
      case 'secret':
        return { ...base, secret: { secretName: disk.sourceDetail } };
      case 'serviceAccount':
        return { ...base, serviceAccount: { serviceAccountName: disk.sourceDetail } };
      case 'ephemeral':
        // Ephemeral uses existing PVC that gets deleted with VM
        return {
          ...base,
          ephemeral: {
            persistentVolumeClaim: {
              claimName: disk.sourceDetail,
            },
          },
        };
      case 'hostDisk':
        return { ...base, hostDisk: { path: disk.sourceDetail || '/tmp', type: 'Disk' } };
      default:
        return { ...base, emptyDisk: { capacity: disk.size } };
    }
  };

  // Helper to build DataVolumeTemplate for clone/snapshot/blank
  const buildDataVolumeTemplate = (disk: AdditionalDisk): KubeResourceBuilder => {
    const vmName = resource.metadata?.name || '';
    const dvtName = vmName ? `${vmName}-${disk.name}` : disk.name;
    const base: KubeResourceBuilder = {
      metadata: { name: dvtName },
      spec: {
        storage: {
          resources: {
            requests: {
              storage: disk.size || '10Gi',
            },
          },
          ...(disk.storageClass &&
            disk.storageClass !== '-' && { storageClassName: disk.storageClass }),
          accessModes: [disk.accessMode || 'ReadWriteOnce'],
          volumeMode: disk.volumeMode || 'Filesystem',
        },
      },
    };

    // Add source based on type
    if (disk.sourceType === 'clone') {
      base.spec.source = {
        pvc: {
          name: disk.sourceDetail,
          namespace: disk.sourceNamespace || namespace,
        },
      };
    } else if (disk.sourceType === 'snapshot') {
      base.spec.source = {
        snapshot: {
          name: disk.sourceDetail,
          namespace: disk.sourceNamespace || namespace,
        },
      };
    } else if (disk.sourceType === 'blank') {
      base.spec.source = {
        blank: {},
      };
    } else if (disk.sourceType === 'dataVolume') {
      // Import DataVolume from URL/registry/blank/upload
      const dvSourceType = disk.dataVolumeSourceType || 'blank';

      if (dvSourceType === 'http') {
        base.spec.source = {
          http: {
            url: disk.dataVolumeUrl || '',
          },
        };
      } else if (dvSourceType === 'registry') {
        base.spec.source = {
          registry: {
            url: disk.dataVolumeUrl || '',
          },
        };
      } else if (dvSourceType === 'blank') {
        base.spec.source = {
          blank: {},
        };
      } else if (dvSourceType === 'upload') {
        base.spec.source = {
          upload: {},
        };
      }
    }

    return base;
  };

  // Helper to build disk device object from disk form data
  const buildDiskDeviceFromDiskFormData = (disk: AdditionalDisk): KubeResourceBuilder => {
    const base: KubeResourceBuilder = {
      name: disk.name,
      disk: { bus: disk.bus || 'virtio' },
    };

    // Add serial for Block mode
    if (disk.volumeMode === 'Block' && disk.serial) {
      base.serial = disk.serial;
    }

    // Add bootOrder if specified
    if (disk.bootOrder) {
      base.bootOrder = disk.bootOrder;
    }

    return base;
  };

  const cancelDiskForm = () => {
    setShowDiskForm(false);
    setDiskEditIndex(null);
  };

  const addSpecialVolume = () => {
    const volumeNumber =
      currentAdditionalDisks.filter(d =>
        ['configMap', 'secret', 'serviceAccount'].includes(d.sourceType)
      ).length + 1;
    const newDiskName = `volume-${volumeNumber}`;

    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];

    // Add volume
    const newVolume = {
      name: newDiskName,
      configMap: {
        name: '',
      },
    };

    // Add disk device
    const newDisk = {
      name: newDiskName,
      disk: {
        bus: 'virtio',
      },
    };

    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            volumes: [...volumes, newVolume],
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                disks: [...disks, newDisk],
              },
            },
          },
        },
      },
    });
  };

  const removeDisk = (index: number) => {
    const diskToRemove = currentAdditionalDisks[index];
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];
    const dataVolumeTemplates = resource.spec?.dataVolumeTemplates || [];

    const newVolumes = volumes.filter((v: KubeResourceBuilder) => v.name !== diskToRemove.name);
    const newDisks = disks.filter((d: KubeResourceBuilder) => d.name !== diskToRemove.name);
    // Also remove matching dataVolumeTemplate (for clone/snapshot/dataVolume disks)
    const newDvts = dataVolumeTemplates.filter(
      (d: KubeResourceBuilder) => d.metadata?.name !== diskToRemove.name
    );

    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        ...(newDvts.length > 0
          ? { dataVolumeTemplates: newDvts }
          : { dataVolumeTemplates: undefined }),
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            volumes: newVolumes,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                disks: newDisks,
              },
            },
          },
        },
      },
    });
  };

  const updateDisk = (index: number, updates: Partial<AdditionalDisk>) => {
    const diskToUpdate = currentAdditionalDisks[index];
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];

    // Handle sourceType or sourceDetail changes in volumes
    const newVolumes = volumes.map((v: KubeResourceBuilder) => {
      if (v.name !== diskToUpdate.name) return v;

      // Update based on source type
      const newSourceType = updates.sourceType ?? diskToUpdate.sourceType;
      const newSourceDetail = updates.sourceDetail ?? diskToUpdate.sourceDetail;

      if (newSourceType === 'configMap') {
        return {
          name: v.name,
          configMap: {
            name: newSourceDetail ?? '',
          },
        };
      } else if (newSourceType === 'secret') {
        return {
          name: v.name,
          secret: {
            secretName: newSourceDetail ?? '',
          },
        };
      } else if (newSourceType === 'serviceAccount') {
        return {
          name: v.name,
          serviceAccount: {
            serviceAccountName: newSourceDetail ?? '',
          },
        };
      }

      return v;
    });

    // Handle disk device updates (volumeMode, serial, bus)
    const newDisks = disks.map((d: KubeResourceBuilder) => {
      if (d.name !== diskToUpdate.name) return d;

      // Determine the new volumeMode
      const newVolumeMode = updates.volumeMode ?? diskToUpdate.volumeMode ?? 'Filesystem';
      const newBus = updates.bus ?? d.disk?.bus ?? 'virtio';

      // Build disk device based on volumeMode
      if (newVolumeMode === 'Filesystem') {
        const result = {
          name: d.name,
          disk: {
            bus: newBus,
          },
        };
        return result;
      } else {
        // Block mode - include serial
        const newSerial = updates.serial ?? d.serial ?? '';
        const result = {
          name: d.name,
          disk: {
            bus: newBus,
          },
          ...(newSerial && { serial: newSerial }),
        };
        return result;
      }
    });

    // Update both volumes and disks in one onChange
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            volumes: newVolumes,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                disks: newDisks,
              },
            },
          },
        },
      },
    });
  };

  // Scheduling handlers
  const handleNodeSelectorsChange = (selectors: NodeSelectorEntry[]) => {
    setCurrentNodeSelectors(selectors);

    // Only sync to resource if there are valid entries (non-empty keys)
    const validSelectors = selectors.filter(s => s.key);
    if (validSelectors.length === 0) {
      updateTemplateSpec({ nodeSelector: undefined });
    } else {
      const selectorObj: Record<string, string> = {};
      validSelectors.forEach(entry => {
        selectorObj[entry.key] = entry.value;
      });
      updateTemplateSpec({ nodeSelector: selectorObj });
    }
  };

  const handleTolerationsChange = (tolerations: Toleration[]) => {
    setCurrentTolerations(tolerations);
    updateTemplateSpec({ tolerations: tolerations.length > 0 ? tolerations : undefined });
  };

  const handleAffinityChange = (rules: AffinityRule[]) => {
    setCurrentAffinityRules(rules);
    if (rules.length === 0) {
      updateTemplateSpec({ affinity: undefined });
      return;
    }

    const affinity: KubeResourceBuilder = {};

    // Group rules by type and condition
    const nodeAffinityRequired = rules.filter(
      r => r.type === 'nodeAffinity' && r.condition === 'required'
    );
    const nodeAffinityPreferred = rules.filter(
      r => r.type === 'nodeAffinity' && r.condition === 'preferred'
    );
    const podAffinityRequired = rules.filter(
      r => r.type === 'podAffinity' && r.condition === 'required'
    );
    const podAffinityPreferred = rules.filter(
      r => r.type === 'podAffinity' && r.condition === 'preferred'
    );
    const podAntiAffinityRequired = rules.filter(
      r => r.type === 'podAntiAffinity' && r.condition === 'required'
    );
    const podAntiAffinityPreferred = rules.filter(
      r => r.type === 'podAntiAffinity' && r.condition === 'preferred'
    );

    // Build nodeAffinity
    if (nodeAffinityRequired.length > 0 || nodeAffinityPreferred.length > 0) {
      affinity.nodeAffinity = {};

      if (nodeAffinityRequired.length > 0) {
        affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = {
          nodeSelectorTerms: nodeAffinityRequired.map(rule => ({
            matchExpressions: (rule.nodeLabels || []).map(label => ({
              key: label.key,
              operator: label.operator,
              values: label.values,
            })),
          })),
        };
      }

      if (nodeAffinityPreferred.length > 0) {
        affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution =
          nodeAffinityPreferred.map(rule => ({
            weight: rule.weight || 1,
            preference: {
              matchExpressions: (rule.nodeLabels || []).map(label => ({
                key: label.key,
                operator: label.operator,
                values: label.values,
              })),
            },
          }));
      }
    }

    // Build podAffinity
    if (podAffinityRequired.length > 0 || podAffinityPreferred.length > 0) {
      affinity.podAffinity = {};

      if (podAffinityRequired.length > 0) {
        affinity.podAffinity.requiredDuringSchedulingIgnoredDuringExecution =
          podAffinityRequired.map(rule => ({
            topologyKey: rule.topologyKey || 'kubernetes.io/hostname',
            labelSelector: {
              matchExpressions: (rule.podLabels || []).map(label => ({
                key: label.key,
                operator: label.operator,
                values: label.values,
              })),
            },
          }));
      }

      if (podAffinityPreferred.length > 0) {
        affinity.podAffinity.preferredDuringSchedulingIgnoredDuringExecution =
          podAffinityPreferred.map(rule => ({
            weight: rule.weight || 1,
            podAffinityTerm: {
              topologyKey: rule.topologyKey || 'kubernetes.io/hostname',
              labelSelector: {
                matchExpressions: (rule.podLabels || []).map(label => ({
                  key: label.key,
                  operator: label.operator,
                  values: label.values,
                })),
              },
            },
          }));
      }
    }

    // Build podAntiAffinity
    if (podAntiAffinityRequired.length > 0 || podAntiAffinityPreferred.length > 0) {
      affinity.podAntiAffinity = {};

      if (podAntiAffinityRequired.length > 0) {
        affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution =
          podAntiAffinityRequired.map(rule => ({
            topologyKey: rule.topologyKey || 'kubernetes.io/hostname',
            labelSelector: {
              matchExpressions: (rule.podLabels || []).map(label => ({
                key: label.key,
                operator: label.operator,
                values: label.values,
              })),
            },
          }));
      }

      if (podAntiAffinityPreferred.length > 0) {
        affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution =
          podAntiAffinityPreferred.map(rule => ({
            weight: rule.weight || 1,
            podAffinityTerm: {
              topologyKey: rule.topologyKey || 'kubernetes.io/hostname',
              labelSelector: {
                matchExpressions: (rule.podLabels || []).map(label => ({
                  key: label.key,
                  operator: label.operator,
                  values: label.values,
                })),
              },
            },
          }));
      }
    }

    updateTemplateSpec({ affinity });
  };

  const handleEvictionStrategyChange = (enabled: boolean) => {
    updateTemplateSpec({ evictionStrategy: enabled ? 'LiveMigrate' : undefined });
  };

  // Advanced Details handlers
  const handleFirmwareChange = (type: 'bios' | 'uefi' | 'uefi-secure') => {
    if (type === 'bios') {
      updateDomain({ firmware: undefined });
    } else {
      updateDomain({
        firmware: {
          bootloader: {
            efi: {
              secureBoot: type === 'uefi-secure',
            },
          },
        },
      });
    }
  };

  const handleCpuModelChange = (model: string) => {
    const currentCpu = resource.spec?.template?.spec?.domain?.cpu || {};
    updateDomain({
      cpu: {
        ...currentCpu,
        model: model || undefined,
      },
    });
  };

  const handleNestedVirtualizationChange = (enabled: boolean) => {
    const currentCpu = resource.spec?.template?.spec?.domain?.cpu || {};
    const features = enabled
      ? [
          { name: 'vmx', policy: 'require' },
          { name: 'svm', policy: 'require' },
        ]
      : undefined;
    updateDomain({
      cpu: {
        ...currentCpu,
        features,
      },
    });
  };

  const handleMachineTypeChange = (type: string) => {
    updateDomain({
      machine: type ? { type } : undefined,
    });
  };

  const handleAcpiChange = (enabled: boolean) => {
    updateDomain({
      features: {
        ...resource.spec?.template?.spec?.domain?.features,
        acpi: enabled ? { enabled: true } : undefined,
      },
    });
  };

  const handleTPMChange = (enabled: boolean) => {
    updateDomain({
      devices: {
        ...resource.spec?.template?.spec?.domain?.devices,
        tpm: enabled ? { persistent: true } : undefined,
      },
    });
  };

  const handleEfiPersistentChange = (enabled: boolean) => {
    const efi = resource.spec?.template?.spec?.domain?.firmware?.bootloader?.efi || {};
    updateDomain({
      firmware: {
        bootloader: {
          efi: {
            ...efi,
            persistent: enabled || undefined,
          },
        },
      },
    });
  };

  const handleHugepagesChange = (pageSize: string) => {
    updateDomain({
      memory: {
        ...resource.spec?.template?.spec?.domain?.memory,
        hugepages: pageSize ? { pageSize } : undefined,
      },
    });
  };

  // Performance handlers
  const handleBlockMultiQueueChange = (enabled: boolean) => {
    updateDevices({ blockMultiQueue: enabled || undefined });
  };

  const handleNetMultiQueueChange = (enabled: boolean) => {
    updateDevices({ networkInterfaceMultiqueue: enabled || undefined });
  };

  const handleIoThreadsPolicyChange = (policy: string) => {
    updateDomain({ ioThreadsPolicy: policy || undefined });
  };

  // Device handlers
  const handleSoundChange = (enabled: boolean) => {
    updateDevices({ sound: enabled ? { name: 'sound0', model: 'ich9' } : undefined });
  };

  const handleWatchdogChange = (enabled: boolean) => {
    updateDevices({
      watchdog: enabled ? { name: 'watchdog0', i6300esb: { action: 'reset' } } : undefined,
    });
  };

  const handleWatchdogActionChange = (action: string) => {
    updateDevices({
      watchdog: { name: 'watchdog0', i6300esb: { action } },
    });
  };

  const handleRngChange = (enabled: boolean) => {
    updateDevices({ rng: enabled ? {} : undefined });
  };

  const handleDownwardMetricsChange = (enabled: boolean) => {
    updateDevices({ downwardMetrics: enabled ? {} : undefined });
  };

  // Security handler
  const handleSmmChange = (enabled: boolean) => {
    const currentFeatures = resource.spec?.template?.spec?.domain?.features || {};
    updateDomain({
      features: {
        ...currentFeatures,
        smm: enabled ? { enabled: true } : undefined,
      },
    });
  };

  // Auto-attach handlers (write false to disable, remove to re-enable)
  const handleAutoAttachChange = (field: string, enabled: boolean) => {
    updateDevices({ [field]: enabled ? undefined : false });
  };

  // Scheduling handler
  const handlePriorityClassChange = (className: string) => {
    updateTemplateSpec({ priorityClassName: className || undefined });
  };

  const handleTimezoneChange = (tz: string) => {
    updateDomain({
      clock: tz ? { timezone: tz } : undefined,
    });
  };

  const handleUserDataModeChange = (mode: 'cloudInit' | 'ignition') => {
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const otherVolumes = volumes.filter(
      (v: KubeResourceBuilder) => !v.cloudInitNoCloud && !v.cloudInitConfigDrive
    );

    // Also ensure cloudinitdisk exists in devices.disks
    const disks = resource.spec?.template?.spec?.domain?.devices?.disks || [];
    const hasCloudInitDisk = disks.some((d: KubeResourceBuilder) => d.name === 'cloudinitdisk');

    const newVolumes =
      mode === 'cloudInit'
        ? [
            ...otherVolumes,
            {
              name: 'cloudinitdisk',
              cloudInitNoCloud: {
                userData: '#cloud-config\n',
              },
            },
          ]
        : [
            ...otherVolumes,
            {
              name: 'cloudinitdisk',
              cloudInitConfigDrive: {
                userData: '{"ignition": {"version": "3.3.0"}}',
              },
            },
          ];

    const newDisks = hasCloudInitDisk
      ? disks
      : [
          ...disks,
          {
            name: 'cloudinitdisk',
            disk: {
              bus: 'virtio',
            },
          },
        ];

    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            volumes: newVolumes,
            domain: {
              ...resource.spec?.template?.spec?.domain,
              devices: {
                ...resource.spec?.template?.spec?.domain?.devices,
                disks: newDisks,
              },
            },
          },
        },
      },
    });
  };

  const handleCloudInitUserDataChange = (type: 'inline' | 'base64' | 'secret', data: string) => {
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const otherVolumes = volumes.filter((v: KubeResourceBuilder) => !v.cloudInitNoCloud);
    const existingCloudInit = volumes.find((v: KubeResourceBuilder) => v.cloudInitNoCloud);

    const cloudInitConfig: KubeResourceBuilder = {
      name: 'cloudinitdisk',
      cloudInitNoCloud: {
        ...(existingCloudInit?.cloudInitNoCloud || {}),
      },
    };

    if (type === 'secret') {
      cloudInitConfig.cloudInitNoCloud.secretRef = { name: data };
      delete cloudInitConfig.cloudInitNoCloud.userData;
      delete cloudInitConfig.cloudInitNoCloud.userDataBase64;
    } else if (type === 'base64') {
      cloudInitConfig.cloudInitNoCloud.userDataBase64 = data;
      delete cloudInitConfig.cloudInitNoCloud.userData;
      delete cloudInitConfig.cloudInitNoCloud.secretRef;
    } else {
      cloudInitConfig.cloudInitNoCloud.userData = data;
      delete cloudInitConfig.cloudInitNoCloud.userDataBase64;
      delete cloudInitConfig.cloudInitNoCloud.secretRef;
    }

    updateTemplateSpec({ volumes: [...otherVolumes, cloudInitConfig] });
  };

  const handleCloudInitNetworkDataChange = (type: 'inline' | 'base64' | 'secret', data: string) => {
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const otherVolumes = volumes.filter((v: KubeResourceBuilder) => !v.cloudInitNoCloud);
    const existingCloudInit = volumes.find((v: KubeResourceBuilder) => v.cloudInitNoCloud);

    const cloudInitConfig: KubeResourceBuilder = {
      name: 'cloudinitdisk',
      cloudInitNoCloud: {
        ...(existingCloudInit?.cloudInitNoCloud || {}),
      },
    };

    if (type === 'secret') {
      cloudInitConfig.cloudInitNoCloud.networkDataSecretRef = { name: data };
      delete cloudInitConfig.cloudInitNoCloud.networkData;
      delete cloudInitConfig.cloudInitNoCloud.networkDataBase64;
    } else if (type === 'base64') {
      cloudInitConfig.cloudInitNoCloud.networkDataBase64 = data;
      delete cloudInitConfig.cloudInitNoCloud.networkData;
      delete cloudInitConfig.cloudInitNoCloud.networkDataSecretRef;
    } else {
      cloudInitConfig.cloudInitNoCloud.networkData = data;
      delete cloudInitConfig.cloudInitNoCloud.networkDataBase64;
      delete cloudInitConfig.cloudInitNoCloud.networkDataSecretRef;
    }

    updateTemplateSpec({ volumes: [...otherVolumes, cloudInitConfig] });
  };

  const handleIgnitionDataChange = (type: 'inline' | 'base64' | 'secret', data: string) => {
    const volumes = resource.spec?.template?.spec?.volumes || [];
    const otherVolumes = volumes.filter((v: KubeResourceBuilder) => !v.cloudInitConfigDrive);

    const ignitionConfig: KubeResourceBuilder = {
      name: 'cloudinitdisk',
      cloudInitConfigDrive: {},
    };

    if (type === 'secret') {
      ignitionConfig.cloudInitConfigDrive.secretRef = { name: data };
    } else if (type === 'base64') {
      ignitionConfig.cloudInitConfigDrive.userDataBase64 = data;
    } else {
      ignitionConfig.cloudInitConfigDrive.userData = data;
    }

    updateTemplateSpec({ volumes: [...otherVolumes, ignitionConfig] });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Name and Metadata Section */}
      <Accordion defaultExpanded sx={{ borderLeft: '3px solid #795548' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(121, 85, 72, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:tag-outline" color="#795548" />
            <Typography variant="h6">Name and Metadata</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <MandatoryTextField
            fullWidth
            label="Name"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            showErrors={showErrors}
            helperText={editMode ? 'Name cannot be changed' : 'Unique name for the virtual machine'}
            disabled={editMode}
            sx={{ mb: 2 }}
          />

          <Autocomplete
            fullWidth
            options={namespaces}
            value={namespace}
            onChange={(_, newValue) => handleNamespaceChange(newValue || 'default')}
            disabled={editMode}
            renderInput={params => (
              <TextField
                {...params}
                label="Namespace"
                required
                helperText={
                  showErrors && !namespace
                    ? 'Namespace is required'
                    : editMode
                    ? 'Namespace cannot be changed'
                    : 'Namespace for the VM'
                }
                sx={showErrors && !namespace ? mandatoryFieldSx : undefined}
              />
            )}
            sx={{ mb: 2 }}
          />

          <Divider sx={{ my: 2 }} />

          {/* Labels */}
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Labels
          </Typography>
          <Box sx={{ mb: 2 }}>
            {labels.map((label, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  label="Key"
                  value={label.key}
                  onChange={e => {
                    const newLabels = [...labels];
                    newLabels[index] = { ...label, key: e.target.value };
                    handleLabelsChange(newLabels);
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Value"
                  value={label.value}
                  onChange={e => {
                    const newLabels = [...labels];
                    newLabels[index] = { ...label, value: e.target.value };
                    handleLabelsChange(newLabels);
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <IconButton
                  onClick={() => {
                    const newLabels = labels.filter((_, i) => i !== index);
                    handleLabelsChange(newLabels);
                  }}
                  size="small"
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Box>
            ))}
            <Button
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => handleLabelsChange([...labels, { key: '', value: '' }])}
              size="small"
            >
              Add Label
            </Button>
          </Box>

          {/* Annotations */}
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Annotations
          </Typography>
          <Box>
            {annotations.map((annotation, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  label="Key"
                  value={annotation.key}
                  onChange={e => {
                    const newAnnotations = [...annotations];
                    newAnnotations[index] = { ...annotation, key: e.target.value };
                    handleAnnotationsChange(newAnnotations);
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Value"
                  value={annotation.value}
                  onChange={e => {
                    const newAnnotations = [...annotations];
                    newAnnotations[index] = { ...annotation, value: e.target.value };
                    handleAnnotationsChange(newAnnotations);
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <IconButton
                  onClick={() => {
                    const newAnnotations = annotations.filter((_, i) => i !== index);
                    handleAnnotationsChange(newAnnotations);
                  }}
                  size="small"
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Box>
            ))}
            <Button
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => handleAnnotationsChange([...annotations, { key: '', value: '' }])}
              size="small"
            >
              Add Annotation
            </Button>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Boot Source Section — hidden in edit mode (boot disks should not be changed) */}
      {!editMode && (
        <Accordion defaultExpanded sx={{ borderLeft: '3px solid #ff9800' }}>
          <AccordionSummary
            expandIcon={<Icon icon="mdi:chevron-down" />}
            sx={{ bgcolor: 'rgba(255, 152, 0, 0.06)' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icon icon="mdi:disc" color="#ff9800" />
              <Typography variant="h6">Boot Source</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ mb: 2 }}>
              <CatalogButton onClick={() => setBootCatalogOpen(true)} />
            </Box>

            {/* Boot Source Type selector */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Select
                value={bootSourceType}
                onChange={e => {
                  const newType = e.target.value as string;
                  setBootSourceTypeOverride(newType);
                  if (!newType) {
                    clearBootSource();
                    return;
                  }
                  // Create initial DVT based on type
                  switch (newType) {
                    case 'dataSource':
                      // Don't create DVT yet, wait for DataSource selection
                      clearBootSource();
                      break;
                    case 'registry':
                      handleBootDvtUpdate({ source: { registry: { url: '' } } });
                      break;
                    case 'http':
                      handleBootDvtUpdate({ source: { http: { url: '' } } });
                      break;
                    case 'pvc':
                      handleBootDvtUpdate({
                        source: { pvc: { name: '', namespace: namespace } },
                      });
                      break;
                    case 'upload': {
                      // Must set both DVT and runStrategy in one onChange call,
                      // otherwise the second updateSpec overwrites the first.
                      const dvts = resource.spec?.dataVolumeTemplates || [];
                      const bootIdx = dvts.findIndex(
                        (d: KubeResourceBuilder) =>
                          d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
                      );
                      const uploadDvt = {
                        metadata: { name: `${name}-boot-volume` },
                        spec: {
                          source: { upload: {} },
                          storage: {
                            ...(bootIdx >= 0 ? dvts[bootIdx].spec?.storage : {}),
                            resources: {
                              requests: {
                                storage:
                                  (bootIdx >= 0 &&
                                    dvts[bootIdx].spec?.storage?.resources?.requests?.storage) ||
                                  '30Gi',
                              },
                            },
                          },
                        },
                      };
                      const newDvts =
                        bootIdx >= 0
                          ? dvts.map((d: KubeResourceBuilder, i: number) =>
                              i === bootIdx ? uploadDvt : d
                            )
                          : [...dvts, uploadDvt];
                      updateSpec({
                        dataVolumeTemplates: newDvts,
                        runStrategy: 'Halted',
                      });
                      break;
                    }
                    case 'blank':
                      handleBootDvtUpdate({ source: { blank: {} } });
                      break;
                  }
                }}
                displayEmpty
              >
                <MenuItem value="">
                  <em>No boot source</em>
                </MenuItem>
                <MenuItem value="dataSource">DataSource (Bootable Volume)</MenuItem>
                <MenuItem value="registry">Container Registry</MenuItem>
                <MenuItem value="http">HTTP/HTTPS URL</MenuItem>
                <MenuItem value="pvc">PVC Clone</MenuItem>
                <MenuItem value="upload">Upload (virtctl)</MenuItem>
                <MenuItem value="blank">Blank Disk</MenuItem>
              </Select>
            </FormControl>

            {/* DataSource specific fields */}
            {bootSourceType === 'dataSource' && (
              <>
                <FormControl fullWidth>
                  <Select
                    value={bootSourceId}
                    onChange={e => handleBootSourceChange(e.target.value)}
                    displayEmpty
                  >
                    <MenuItem value="" disabled>
                      Select a data source
                    </MenuItem>
                    {dataSources?.map(ds => (
                      <MenuItem key={ds.metadata.uid} value={ds.getName()}>
                        {ds.getName()} - {ds.getOperatingSystem()} ({ds.getSize()})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {selectedBootSource && (
                  <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="body2">
                      <strong>OS:</strong> {selectedBootSource.getOperatingSystem()}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Size:</strong> {selectedBootSource.getSize()}
                    </Typography>
                  </Box>
                )}
              </>
            )}

            {/* Registry specific fields */}
            {bootSourceType === 'registry' && (
              <TextField
                fullWidth
                label="Registry URL"
                value={bootDvt?.spec?.source?.registry?.url || ''}
                onChange={e =>
                  handleBootDvtUpdate({ source: { registry: { url: e.target.value } } })
                }
                placeholder="docker://quay.io/fedora/fedora-coreos-kubevirt:stable"
                helperText="Container registry URL (must start with docker:// or oci-archive://)"
              />
            )}

            {/* HTTP specific fields */}
            {bootSourceType === 'http' && (
              <TextField
                fullWidth
                label="Image URL"
                value={bootDvt?.spec?.source?.http?.url || ''}
                onChange={e => handleBootDvtUpdate({ source: { http: { url: e.target.value } } })}
                placeholder="https://example.com/disk-image.qcow2"
                helperText="URL to ISO, qcow2, or raw disk image"
              />
            )}

            {/* PVC Clone specific fields */}
            {bootSourceType === 'pvc' && (
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Autocomplete
                    fullWidth
                    options={namespaces}
                    value={bootDvt?.spec?.source?.pvc?.namespace || namespace}
                    onChange={(_, newValue) => {
                      handleBootDvtUpdate({
                        source: {
                          pvc: {
                            name: bootDvt?.spec?.source?.pvc?.name || '',
                            namespace: newValue || namespace,
                          },
                        },
                      });
                    }}
                    renderInput={params => <TextField {...params} label="Source Namespace" />}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Autocomplete
                    fullWidth
                    options={pvcs}
                    value={bootDvt?.spec?.source?.pvc?.name || ''}
                    onChange={(_, newValue) => {
                      handleBootDvtUpdate({
                        source: {
                          pvc: {
                            name: newValue || '',
                            namespace: bootDvt?.spec?.source?.pvc?.namespace || namespace,
                          },
                        },
                      });
                    }}
                    renderInput={params => <TextField {...params} label="Source PVC" />}
                  />
                </Grid>
              </Grid>
            )}

            {/* Upload info */}
            {bootSourceType === 'upload' && (
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Alert severity="warning" sx={{ '& .MuiAlert-message': { color: '#ffb74d' } }}>
                  The VM will be created with <strong>runStrategy: Halted</strong> so the upload can
                  complete before the VM starts.
                </Alert>
                <Alert severity="info">
                  <Typography variant="body2" gutterBottom>
                    <strong>After creating the VM, upload a disk image:</strong>
                  </Typography>
                  <CopyCodeBlock
                    title="Step 1 — Port-forward the CDI upload proxy"
                    code={`kubectl port-forward -n cdi svc/cdi-uploadproxy 3443:443 &\nPF_PID=$!`}
                  />
                  <CopyCodeBlock
                    title="Step 2 — Upload a local disk image"
                    code={`virtctl image-upload dv ${
                      name || '<vm-name>'
                    }-boot-volume \\\n  --namespace ${namespace} \\\n  --size=${
                      resource.spec?.dataVolumeTemplates?.find((d: KubeResourceBuilder) =>
                        d.metadata?.name?.endsWith('-boot-volume')
                      )?.spec?.storage?.resources?.requests?.storage || '30Gi'
                    } \\\n  --uploadproxy-url=https://localhost:3443 \\\n  --insecure \\\n  --image-path=/path/to/disk.qcow2`}
                  />
                  <CopyCodeBlock
                    title="Step 3 — Start the VM and stop the port-forward"
                    code={`virtctl start ${name || '<vm-name>'} -n ${namespace}\nkill $PF_PID`}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Supported formats: qcow2, raw, ISO, vmdk (auto-detected). The{' '}
                    <code>--insecure</code> flag is needed because the port-forward uses a
                    self-signed certificate.
                  </Typography>
                </Alert>
              </Box>
            )}

            {/* Blank info */}
            {bootSourceType === 'blank' && (
              <Alert severity="info" sx={{ mt: 1 }}>
                A blank disk will be created. You can install an OS via PXE boot or attach an ISO.
              </Alert>
            )}

            {/* Common fields: Size + Storage Class — shown for all boot source types */}
            {bootSourceType && (
              <>
                <Autocomplete
                  fullWidth
                  sx={{ mt: 2 }}
                  options={storageClasses}
                  value={bootDvt?.spec?.storage?.storageClassName || null}
                  onChange={(_, newValue) => {
                    const dvts = resource.spec?.dataVolumeTemplates || [];
                    const idx = dvts.findIndex(
                      (d: KubeResourceBuilder) =>
                        d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
                    );
                    if (idx === -1) return;
                    const dvt = { ...dvts[idx] };
                    const storage = { ...dvt.spec?.storage };
                    if (newValue) {
                      storage.storageClassName = newValue;
                    } else {
                      delete storage.storageClassName;
                    }
                    dvt.spec = { ...dvt.spec, storage };
                    const newDvts = [...dvts];
                    newDvts[idx] = dvt;
                    updateSpec({ dataVolumeTemplates: newDvts });
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Target Storage Class (optional)"
                      helperText="Storage class for the boot disk. Leave empty to use the cluster default."
                    />
                  )}
                />
                {(() => {
                  const currentSize = bootDvt?.spec?.storage?.resources?.requests?.storage || '';
                  const minSize =
                    bootSourceType === 'dataSource' ? selectedBootSource?.getSize() : '';
                  const isBelowMin =
                    !!minSize &&
                    !!currentSize &&
                    parseSizeToBytes(currentSize) < parseSizeToBytes(minSize);
                  return (
                    <>
                      <TextField
                        fullWidth
                        sx={{ mt: 2, ...(isBelowMin ? mandatoryFieldSx : {}) }}
                        label="Boot Disk Size"
                        value={currentSize}
                        onChange={e => {
                          const dvts = resource.spec?.dataVolumeTemplates || [];
                          const idx = dvts.findIndex(
                            (d: KubeResourceBuilder) =>
                              d.spec?.sourceRef || d.metadata?.name?.endsWith('-boot-volume')
                          );
                          if (idx === -1) return;
                          const dvt = { ...dvts[idx] };
                          dvt.spec = {
                            ...dvt.spec,
                            storage: {
                              ...dvt.spec?.storage,
                              resources: {
                                ...dvt.spec?.storage?.resources,
                                requests: {
                                  ...dvt.spec?.storage?.resources?.requests,
                                  storage: e.target.value,
                                },
                              },
                            },
                          };
                          const newDvts = [...dvts];
                          newDvts[idx] = dvt;
                          updateSpec({ dataVolumeTemplates: newDvts });
                        }}
                        helperText="Size of the boot disk (e.g. 30Gi, 50Gi)"
                      />
                      {isBelowMin && (
                        <Alert
                          severity="warning"
                          sx={{ mt: 1, '& .MuiAlert-message': { color: '#ffb74d' } }}
                        >
                          Disk size <strong>{currentSize}</strong> is below the DataSource minimum
                          of <strong>{minSize}</strong>. CDI will fail to provision with a smaller
                          disk.
                        </Alert>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Resources Section */}
      <Accordion sx={{ borderLeft: '3px solid #9c27b0' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(156, 39, 176, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:memory" color="#9c27b0" />
            <Typography variant="h6">Resources</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <FormControl component="fieldset" sx={{ mb: 2 }}>
            <RadioGroup
              row
              value={resourceMode}
              onChange={e => handleResourceModeChange(e.target.value as 'instanceType' | 'custom')}
            >
              <FormControlLabel
                value="instanceType"
                control={<Radio />}
                label={
                  <>
                    Instance Type <InfoTooltip text={TOOLTIPS.instanceType} />
                  </>
                }
              />
              <FormControlLabel value="custom" control={<Radio />} label="Custom" />
            </RadioGroup>
          </FormControl>

          {resourceMode === 'instanceType' ? (
            <>
              <Autocomplete
                fullWidth
                options={clusterInstanceTypes}
                value={selectedInstanceType}
                onChange={(_, newValue) => handleInstanceTypeChange(newValue)}
                getOptionLabel={option => option.getName()}
                renderOption={(props, option) => (
                  <li {...props} key={option.metadata.uid}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                      <Typography variant="body1">
                        <strong>{option.getName()}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {option.getCPU()} CPU, {option.getMemory()} Memory
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Select an instance type"
                    required
                    placeholder="Search instance types..."
                  />
                )}
                ListboxProps={{
                  style: { maxHeight: 300 },
                }}
              />

              {selectedInstanceType && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="body2">
                    <strong>CPU:</strong> {selectedInstanceType.getCPU()} cores
                  </Typography>
                  <Typography variant="body2">
                    <strong>Memory:</strong> {selectedInstanceType.getMemory()}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Vendor:</strong> {selectedInstanceType.getVendor()}
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  vCPU
                </Typography>
                {!useAdvancedTopologyState ? (
                  <TextField
                    fullWidth
                    label="vCPU"
                    value={customCpu}
                    onChange={e => handleCustomCpuChange(e.target.value)}
                    inputProps={{ min: 1, type: 'number' }}
                  />
                ) : (
                  <>
                    <TextField
                      fullWidth
                      label="Core(s)"
                      value={cpuCores}
                      onChange={e =>
                        handleAdvancedTopologyChange(e.target.value, cpuSockets, cpuThreads)
                      }
                      inputProps={{ min: 1, type: 'number' }}
                      sx={{ mb: 1 }}
                    />
                    <TextField
                      fullWidth
                      label="Socket(s)"
                      value={cpuSockets}
                      onChange={e =>
                        handleAdvancedTopologyChange(cpuCores, e.target.value, cpuThreads)
                      }
                      inputProps={{ min: 1, type: 'number' }}
                      sx={{ mb: 1 }}
                    />
                    <TextField
                      fullWidth
                      label="Thread(s)"
                      value={cpuThreads}
                      onChange={e =>
                        handleAdvancedTopologyChange(cpuCores, cpuSockets, e.target.value)
                      }
                      inputProps={{ min: 1, type: 'number' }}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Total vCPUs: {totalVCPUs}
                    </Typography>
                  </>
                )}
                <Button
                  size="small"
                  onClick={() => setUseAdvancedTopologyState(!useAdvancedTopologyState)}
                  sx={{ mt: 1 }}
                >
                  {useAdvancedTopologyState ? '« Simple mode' : '» Use advanced topology'}
                </Button>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Memory
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="Memory"
                    value={customMemory}
                    onChange={e => handleCustomMemoryChange(e.target.value, customMemoryUnit)}
                    inputProps={{ min: 1, type: 'number' }}
                  />
                  <Select
                    value={customMemoryUnit}
                    onChange={e =>
                      handleCustomMemoryChange(customMemory, e.target.value as 'Mi' | 'Gi')
                    }
                    sx={{ minWidth: 80 }}
                  >
                    <MenuItem value="Mi">MiB</MenuItem>
                    <MenuItem value="Gi">GiB</MenuItem>
                  </Select>
                </Box>
              </Grid>
            </Grid>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Network Interfaces Section */}
      <Accordion sx={{ borderLeft: '3px solid #2196f3' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(33, 150, 243, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:lan" color="#2196f3" />
            <Typography variant="h6">Network Interfaces</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {currentNetworkInterfaces.map((iface, index) => (
            <Card key={index} sx={{ mb: 2, p: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={3}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Interface Name
                  </Typography>
                  <TextField
                    fullWidth
                    value={iface.name}
                    onChange={e => updateNetworkInterface(index, { name: e.target.value })}
                    size="small"
                  />
                </Grid>
                <Grid item xs={3}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Network Type
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={iface.type}
                      onChange={e =>
                        updateNetworkInterface(index, {
                          type: e.target.value as 'pod' | 'nad',
                          nadName: undefined,
                          model: e.target.value === 'nad' ? 'virtio' : undefined,
                        })
                      }
                    >
                      <MenuItem value="pod" disabled={hasPodNetworking && iface.type !== 'pod'}>
                        Pod Networking
                      </MenuItem>
                      <MenuItem value="nad">Network Attachment</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={4}>
                  {iface.type === 'nad' ? (
                    <>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Select NAD
                      </Typography>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={networkAttachmentDefs?.map(nad => nad.getName()) || []}
                        value={iface.nadName || ''}
                        onChange={(_, newValue) =>
                          updateNetworkInterface(index, { nadName: newValue || undefined })
                        }
                        renderInput={params => (
                          <TextField {...params} placeholder="Search network attachment..." />
                        )}
                      />
                    </>
                  ) : (
                    <>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Network Configuration
                      </Typography>
                      <Typography variant="body2">Default pod networking</Typography>
                    </>
                  )}
                </Grid>
                <Grid item xs={2} sx={{ display: 'flex', alignItems: 'flex-end' }}>
                  <IconButton
                    size="small"
                    onClick={() => removeNetworkInterface(index)}
                    color="error"
                    disabled={currentNetworkInterfaces.length === 1}
                  >
                    <Icon icon="mdi:delete" />
                  </IconButton>
                </Grid>
              </Grid>
            </Card>
          ))}
          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={addNetworkInterface}
            variant="outlined"
            size="small"
          >
            Add Network Interface
          </Button>
        </AccordionDetails>
      </Accordion>

      {/* Additional Disks Section */}
      <Accordion sx={{ borderLeft: '3px solid #ff9800' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(255, 152, 0, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:harddisk" color="#ff9800" />
            <Typography variant="h6">Disks</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Disk Name</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Drive</TableCell>
                <TableCell>Interface</TableCell>
                <TableCell>Storage Class</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* CloudInit Disk (readonly) */}
              <TableRow>
                <TableCell>
                  <Typography variant="body2">cloudinitdisk</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    Other
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    -
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">Disk</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">virtio</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    -
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" disabled>
                    <Icon icon="mdi:dots-vertical" />
                  </IconButton>
                </TableCell>
              </TableRow>

              {/* Root Disk (bootable) — shown when any boot DVT exists */}
              {bootDvt && (
                <TableRow>
                  <TableCell>
                    <Typography variant="body2">rootdisk (bootable)</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {bootSourceType === 'dataSource'
                        ? 'PVC (DataSource)'
                        : bootSourceType === 'registry'
                        ? 'Container Registry'
                        : bootSourceType === 'http'
                        ? 'HTTP/HTTPS URL'
                        : bootSourceType === 'pvc'
                        ? 'PVC Clone'
                        : bootSourceType === 'upload'
                        ? 'Upload (virtctl)'
                        : bootSourceType === 'blank'
                        ? 'Blank Disk'
                        : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {bootDvt?.spec?.storage?.resources?.requests?.storage ||
                        selectedBootSource?.getSize() ||
                        '30Gi'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">Disk</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">virtio</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {bootDvt?.spec?.storage?.storageClassName || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" disabled>
                      <Icon icon="mdi:dots-vertical" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )}

              {/* Additional Disks (exclude special volumes) */}
              {currentAdditionalDisks
                .filter(d => !['configMap', 'secret', 'serviceAccount'].includes(d.sourceType))
                .map((disk, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Typography variant="body2">{disk.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{getSourceTypeLabel(disk.sourceType)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{disk.size || '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">Disk</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{disk.bus}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{disk.storageClass || '-'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => startEditDisk(index)}>
                        <Icon icon="mdi:pencil" />
                      </IconButton>
                      <IconButton size="small" onClick={() => removeDisk(index)}>
                        <Icon icon="mdi:delete" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {/* Add Disk Button */}
          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={startAddDisk}
            variant="outlined"
            sx={{ mb: 3 }}
            disabled={showDiskForm}
          >
            Add Disk
          </Button>

          {/* Disk Add/Edit Form */}
          {showDiskForm && (
            <Card sx={{ mb: 3, p: 2, bgcolor: 'action.hover' }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <Typography variant="h6">
                  {diskEditIndex !== null ? 'Edit Disk' : 'Add Disk'}
                </Typography>
                <Box>
                  <Button
                    size="small"
                    startIcon={<Icon icon="mdi:check" />}
                    onClick={saveDisk}
                    variant="contained"
                    color="primary"
                    sx={{ mr: 1 }}
                  >
                    Save
                  </Button>
                  <Button
                    size="small"
                    startIcon={<Icon icon="mdi:close" />}
                    onClick={cancelDiskForm}
                    variant="outlined"
                  >
                    Cancel
                  </Button>
                </Box>
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Disk Name *
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={diskFormData.name}
                    onChange={e => setDiskFormData({ ...diskFormData, name: e.target.value })}
                    required
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Source Type
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={diskFormData.sourceType}
                      onChange={e =>
                        setDiskFormData({
                          ...diskFormData,
                          sourceType: e.target.value as AdditionalDisk['sourceType'],
                        })
                      }
                      displayEmpty
                    >
                      <MenuItem value="dataVolume">DataVolume (Import New)</MenuItem>
                      <MenuItem value="dataVolumeExisting">DataVolume (Use Existing)</MenuItem>
                      <MenuItem value="blank">DataVolume (Blank)</MenuItem>
                      <MenuItem value="persistentVolumeClaim">PVC (Use Existing)</MenuItem>
                      <MenuItem value="snapshot">PVC Snapshot (Restore)</MenuItem>
                      <MenuItem value="clone">Clone PVC (Copy)</MenuItem>
                      <MenuItem value="containerDisk">Container Disk</MenuItem>
                      <MenuItem value="empty">Empty Disk</MenuItem>
                      <MenuItem value="ephemeral">Ephemeral</MenuItem>
                      <MenuItem value="hostDisk">Host Disk</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {diskFormData.sourceType === 'containerDisk' && (
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Container Image
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={diskFormData.sourceDetail || ''}
                      onChange={e =>
                        setDiskFormData({ ...diskFormData, sourceDetail: e.target.value })
                      }
                      placeholder="registry.example.com/image:tag"
                    />
                  </Grid>
                )}

                {diskFormData.sourceType === 'persistentVolumeClaim' && (
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      PVC Name
                    </Typography>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={pvcs}
                      value={diskFormData.sourceDetail || ''}
                      onChange={(_, newValue) =>
                        setDiskFormData({ ...diskFormData, sourceDetail: newValue || undefined })
                      }
                      renderInput={params => <TextField {...params} placeholder="Select PVC..." />}
                    />
                  </Grid>
                )}

                {diskFormData.sourceType === 'snapshot' && (
                  <>
                    <Grid item xs={12}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Snapshot Name
                      </Typography>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={volumeSnapshots}
                        value={diskFormData.sourceDetail || ''}
                        onChange={(_, newValue) =>
                          setDiskFormData({ ...diskFormData, sourceDetail: newValue || undefined })
                        }
                        renderInput={params => (
                          <TextField {...params} placeholder="Select snapshot..." />
                        )}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Size
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        value={diskFormData.size?.replace(/[^0-9]/g, '') || '10'}
                        onChange={e => {
                          const unit = diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi';
                          setDiskFormData({ ...diskFormData, size: `${e.target.value}${unit}` });
                        }}
                        type="number"
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Unit
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi'}
                          onChange={e => {
                            const num = diskFormData.size?.replace(/[^0-9]/g, '') || '10';
                            setDiskFormData({ ...diskFormData, size: `${num}${e.target.value}` });
                          }}
                        >
                          <MenuItem value="Mi">MiB</MenuItem>
                          <MenuItem value="Gi">GiB</MenuItem>
                          <MenuItem value="Ti">TiB</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </>
                )}

                {diskFormData.sourceType === 'clone' && (
                  <>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Source Namespace
                      </Typography>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={namespaces}
                        value={diskFormData.sourceNamespace || namespace}
                        onChange={(_, newValue) => {
                          const ns = newValue || namespace;
                          setDiskFormData({
                            ...diskFormData,
                            sourceNamespace: ns,
                            sourceDetail: undefined,
                          });
                          fetchPvcsForNamespace(ns);
                        }}
                        renderInput={params => (
                          <TextField {...params} placeholder="Select namespace..." />
                        )}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Source PVC Name
                      </Typography>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={cloneSourcePvcs[diskFormData.sourceNamespace || namespace] || []}
                        value={diskFormData.sourceDetail || ''}
                        onChange={(_, newValue) =>
                          setDiskFormData({ ...diskFormData, sourceDetail: newValue || undefined })
                        }
                        renderInput={params => (
                          <TextField {...params} placeholder="Select PVC..." />
                        )}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Size
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        value={diskFormData.size?.replace(/[^0-9]/g, '') || '10'}
                        onChange={e => {
                          const unit = diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi';
                          setDiskFormData({ ...diskFormData, size: `${e.target.value}${unit}` });
                        }}
                        type="number"
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Unit
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi'}
                          onChange={e => {
                            const num = diskFormData.size?.replace(/[^0-9]/g, '') || '10';
                            setDiskFormData({ ...diskFormData, size: `${num}${e.target.value}` });
                          }}
                        >
                          <MenuItem value="Mi">MiB</MenuItem>
                          <MenuItem value="Gi">GiB</MenuItem>
                          <MenuItem value="Ti">TiB</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </>
                )}

                {diskFormData.sourceType === 'dataVolumeExisting' && (
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      DataVolume Name
                    </Typography>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={dataVolumes}
                      value={diskFormData.sourceDetail || ''}
                      onChange={(_, newValue) =>
                        setDiskFormData({ ...diskFormData, sourceDetail: newValue || undefined })
                      }
                      renderInput={params => (
                        <TextField {...params} placeholder="Select DataVolume..." />
                      )}
                    />
                  </Grid>
                )}

                {diskFormData.sourceType === 'dataVolume' && (
                  <>
                    <Grid item xs={12}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Import Source
                      </Typography>
                      <Select
                        fullWidth
                        size="small"
                        value={diskFormData.dataVolumeSourceType || 'http'}
                        onChange={e =>
                          setDiskFormData({
                            ...diskFormData,
                            dataVolumeSourceType: e.target.value as
                              | 'http'
                              | 'registry'
                              | 'blank'
                              | 'upload',
                          })
                        }
                      >
                        <MenuItem value="http">HTTP/HTTPS URL</MenuItem>
                        <MenuItem value="registry">Container Registry</MenuItem>
                        <MenuItem value="blank">Blank (Empty)</MenuItem>
                        <MenuItem value="upload">Upload (virtctl)</MenuItem>
                      </Select>
                    </Grid>

                    {diskFormData.dataVolumeSourceType === 'http' && (
                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          URL
                        </Typography>
                        <TextField
                          fullWidth
                          size="small"
                          value={diskFormData.dataVolumeUrl || ''}
                          onChange={e =>
                            setDiskFormData({ ...diskFormData, dataVolumeUrl: e.target.value })
                          }
                          placeholder="https://example.com/disk-image.iso"
                          helperText="URL to ISO, qcow2, or raw disk image"
                        />
                      </Grid>
                    )}

                    {diskFormData.dataVolumeSourceType === 'registry' && (
                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Registry URL
                        </Typography>
                        <TextField
                          fullWidth
                          size="small"
                          value={diskFormData.dataVolumeUrl || ''}
                          onChange={e =>
                            setDiskFormData({ ...diskFormData, dataVolumeUrl: e.target.value })
                          }
                          placeholder="docker://docker.io/user/image:tag"
                          helperText="Container registry URL (must start with docker:// or oci-archive://)"
                        />
                      </Grid>
                    )}

                    {diskFormData.dataVolumeSourceType === 'upload' && (
                      <Grid item xs={12}>
                        <Alert severity="info">
                          Upload mode: Use virtctl image-upload after creation
                        </Alert>
                      </Grid>
                    )}

                    <Grid item xs={4}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Size
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        value={diskFormData.size?.replace(/[^0-9]/g, '') || '10'}
                        onChange={e => {
                          const unit = diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi';
                          setDiskFormData({ ...diskFormData, size: `${e.target.value}${unit}` });
                        }}
                        type="number"
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Unit
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi'}
                          onChange={e => {
                            const num = diskFormData.size?.replace(/[^0-9]/g, '') || '10';
                            setDiskFormData({ ...diskFormData, size: `${num}${e.target.value}` });
                          }}
                        >
                          <MenuItem value="Mi">MiB</MenuItem>
                          <MenuItem value="Gi">GiB</MenuItem>
                          <MenuItem value="Ti">TiB</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </>
                )}

                {diskFormData.sourceType === 'ephemeral' && (
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      PVC Name (for ephemeral backing)
                    </Typography>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={pvcs}
                      value={diskFormData.sourceDetail || ''}
                      onChange={(_, newValue) =>
                        setDiskFormData({ ...diskFormData, sourceDetail: newValue || undefined })
                      }
                      renderInput={params => <TextField {...params} placeholder="Select PVC..." />}
                    />
                  </Grid>
                )}

                {diskFormData.sourceType === 'hostDisk' && (
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Host Path
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={diskFormData.sourceDetail || ''}
                      onChange={e =>
                        setDiskFormData({ ...diskFormData, sourceDetail: e.target.value })
                      }
                      placeholder="/path/to/disk.img"
                      helperText="Path to disk image on the host node"
                    />
                  </Grid>
                )}

                {(diskFormData.sourceType === 'empty' || diskFormData.sourceType === 'blank') && (
                  <>
                    <Grid item xs={4}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Size
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        value={diskFormData.size?.replace(/[^0-9]/g, '') || '10'}
                        onChange={e => {
                          const unit = diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi';
                          setDiskFormData({ ...diskFormData, size: `${e.target.value}${unit}` });
                        }}
                        type="number"
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Unit
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.size?.match(/[A-Za-z]+$/)?.[0] || 'Gi'}
                          onChange={e => {
                            const num = diskFormData.size?.replace(/[^0-9]/g, '') || '10';
                            setDiskFormData({ ...diskFormData, size: `${num}${e.target.value}` });
                          }}
                        >
                          <MenuItem value="Mi">MiB</MenuItem>
                          <MenuItem value="Gi">GiB</MenuItem>
                          <MenuItem value="Ti">TiB</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </>
                )}

                <Grid item xs={6}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Interface
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={diskFormData.bus}
                      onChange={e =>
                        setDiskFormData({
                          ...diskFormData,
                          bus: e.target.value as 'virtio' | 'sata' | 'scsi',
                        })
                      }
                    >
                      <MenuItem value="virtio">VirtIO</MenuItem>
                      <MenuItem value="sata">SATA</MenuItem>
                      <MenuItem value="scsi">SCSI</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Storage-related fields for types that create new storage */}
                {['blank', 'snapshot', 'clone', 'dataVolume'].includes(diskFormData.sourceType) && (
                  <>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Storage Class (optional) <InfoTooltip text={TOOLTIPS.storageClass} />
                      </Typography>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={storageClasses}
                        value={diskFormData.storageClass || ''}
                        onChange={(_, newValue) =>
                          setDiskFormData({ ...diskFormData, storageClass: newValue || undefined })
                        }
                        renderInput={params => (
                          <TextField
                            {...params}
                            placeholder="Cluster default"
                            helperText="Leave empty to use the cluster default"
                          />
                        )}
                      />
                    </Grid>

                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Access Mode <InfoTooltip text={TOOLTIPS.accessModeRWO} />
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.accessMode || 'ReadWriteOnce'}
                          onChange={e =>
                            setDiskFormData({
                              ...diskFormData,
                              accessMode: e.target.value as
                                | 'ReadWriteOnce'
                                | 'ReadWriteMany'
                                | 'ReadOnlyMany',
                            })
                          }
                        >
                          <MenuItem value="ReadWriteOnce">ReadWriteOnce (RWO)</MenuItem>
                          <MenuItem value="ReadWriteMany">ReadWriteMany (RWX)</MenuItem>
                          <MenuItem value="ReadOnlyMany">ReadOnlyMany (ROX)</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Volume Mode <InfoTooltip text={TOOLTIPS.volumeModeFilesystem} />
                      </Typography>
                      <FormControl fullWidth size="small">
                        <Select
                          value={diskFormData.volumeMode || 'Block'}
                          onChange={e =>
                            setDiskFormData({
                              ...diskFormData,
                              volumeMode: e.target.value as 'Filesystem' | 'Block',
                            })
                          }
                        >
                          <MenuItem value="Filesystem">Filesystem</MenuItem>
                          <MenuItem value="Block">Block</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid item xs={6}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={diskFormData.preallocation || false}
                            onChange={e =>
                              setDiskFormData({ ...diskFormData, preallocation: e.target.checked })
                            }
                          />
                        }
                        label={
                          <>
                            Thick Provisioning (Preallocation){' '}
                            <InfoTooltip text={TOOLTIPS.preallocation} />
                          </>
                        }
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </Card>
          )}

          <Divider sx={{ my: 3 }} />

          {/* ConfigMap, Secrets, Service Accounts */}
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            ConfigMaps, Secrets, Service Accounts
          </Typography>
          <Table size="small" sx={{ mb: 2, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell>Serial</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentAdditionalDisks
                .map((disk, realIndex) => ({ disk, realIndex }))
                .filter(({ disk }) =>
                  ['configMap', 'secret', 'serviceAccount'].includes(disk.sourceType)
                )
                .map(({ disk, realIndex }) => {
                  const availableNames =
                    disk.sourceType === 'configMap'
                      ? configMaps
                      : disk.sourceType === 'secret'
                      ? secrets
                      : serviceAccounts;

                  return (
                    <TableRow key={realIndex}>
                      <TableCell>
                        <FormControl fullWidth size="small">
                          <Select
                            value={disk.sourceType}
                            onChange={e =>
                              updateDisk(realIndex, {
                                sourceType: e.target.value as
                                  | 'configMap'
                                  | 'secret'
                                  | 'serviceAccount',
                                sourceDetail: undefined,
                              })
                            }
                          >
                            <MenuItem value="configMap">ConfigMap</MenuItem>
                            <MenuItem value="secret">Secret</MenuItem>
                            <MenuItem value="serviceAccount">ServiceAccount</MenuItem>
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={availableNames}
                          value={disk.sourceDetail || ''}
                          onChange={(_, newValue) =>
                            updateDisk(realIndex, { sourceDetail: newValue || undefined })
                          }
                          renderInput={params => <TextField {...params} placeholder="Select..." />}
                        />
                      </TableCell>
                      <TableCell>
                        <FormControl fullWidth size="small">
                          <Select
                            value={disk.volumeMode || 'Filesystem'}
                            onChange={e => {
                              updateDisk(realIndex, {
                                volumeMode: e.target.value as 'Filesystem' | 'Block',
                                // When switching to Block, ensure we have a serial (use existing or sanitized name)
                                serial:
                                  e.target.value === 'Filesystem'
                                    ? undefined
                                    : disk.serial || disk.name.replace(/-/g, ''),
                              });
                            }}
                          >
                            <MenuItem value="Filesystem">Filesystem</MenuItem>
                            <MenuItem value="Block">Disk</MenuItem>
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        {disk.volumeMode === 'Block' ? (
                          <TextField
                            fullWidth
                            size="small"
                            value={disk.serial || ''}
                            onChange={e => updateDisk(realIndex, { serial: e.target.value })}
                            placeholder="Serial number"
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => removeDisk(realIndex)}>
                          <Icon icon="mdi:delete" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {currentAdditionalDisks.filter(d =>
                ['configMap', 'secret', 'serviceAccount'].includes(d.sourceType)
              ).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No special volumes added yet
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={addSpecialVolume}
            variant="outlined"
          >
            Add ConfigMap/Secret/ServiceAccount
          </Button>
        </AccordionDetails>
      </Accordion>

      {/* Devices Section (GPU / PCI Passthrough) */}
      {allPermittedDeviceNames.length > 0 && (
        <Accordion sx={{ borderLeft: '3px solid #4caf50' }}>
          <AccordionSummary
            expandIcon={<Icon icon="mdi:chevron-down" />}
            sx={{ bgcolor: 'rgba(76, 175, 80, 0.06)' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icon icon="mdi:expansion-card" color="#4caf50" />
              <Typography variant="h6">Devices</Typography>
              {(() => {
                const total =
                  (resource.spec?.template?.spec?.domain?.devices?.gpus || []).length +
                  (resource.spec?.template?.spec?.domain?.devices?.hostDevices || []).length;
                return total > 0 ? (
                  <Chip
                    label={total}
                    size="small"
                    sx={{ height: 20, bgcolor: '#4caf50', color: 'white' }}
                  />
                ) : null;
              })()}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Assign GPUs and PCI host devices from the cluster&apos;s permitted devices list.
              Configure permitted devices in Settings → Feature Gates → HostDevices.
            </Typography>

            {/* GPUs */}
            <Typography variant="subtitle2" fontWeight={600} mb={1}>
              <Icon
                icon="mdi:video"
                width={16}
                style={{ verticalAlign: 'middle', marginRight: 4 }}
              />
              GPUs
            </Typography>
            {(
              (resource.spec?.template?.spec?.domain?.devices?.gpus || []) as Array<{
                name: string;
                deviceName: string;
              }>
            ).map((gpu, idx) => (
              <Box key={idx} display="flex" alignItems="center" gap={1} mb={1}>
                <Chip label={gpu.name} size="small" />
                <Typography variant="body2" color="text.secondary">
                  {gpu.deviceName}
                </Typography>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    const gpus = [...(resource.spec?.template?.spec?.domain?.devices?.gpus || [])];
                    gpus.splice(idx, 1);
                    updateSpec({
                      template: {
                        ...resource.spec?.template,
                        spec: {
                          ...resource.spec?.template?.spec,
                          domain: {
                            ...resource.spec?.template?.spec?.domain,
                            devices: { ...resource.spec?.template?.spec?.domain?.devices, gpus },
                          },
                        },
                      },
                    });
                  }}
                >
                  <Icon icon="mdi:delete" width={16} />
                </IconButton>
              </Box>
            ))}
            <Grid container spacing={2} alignItems="flex-end" mb={3}>
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Name"
                  placeholder="e.g., gpu1"
                  value={newGpu.name}
                  onChange={e => setNewGpu({ ...newGpu, name: e.target.value })}
                />
              </Grid>
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  select
                  label="Device"
                  value={newGpu.deviceName}
                  onChange={e => setNewGpu({ ...newGpu, deviceName: e.target.value })}
                >
                  <MenuItem value="" disabled>
                    Select a permitted device
                  </MenuItem>
                  {allPermittedDeviceNames.map(n => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={2}>
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<Icon icon="mdi:plus" />}
                  disabled={!newGpu.name || !newGpu.deviceName}
                  onClick={() => {
                    const gpus = [
                      ...(resource.spec?.template?.spec?.domain?.devices?.gpus || []),
                      { name: newGpu.name.trim(), deviceName: newGpu.deviceName },
                    ];
                    updateSpec({
                      template: {
                        ...resource.spec?.template,
                        spec: {
                          ...resource.spec?.template?.spec,
                          domain: {
                            ...resource.spec?.template?.spec?.domain,
                            devices: { ...resource.spec?.template?.spec?.domain?.devices, gpus },
                          },
                        },
                      },
                    });
                    setNewGpu({ name: '', deviceName: '' });
                  }}
                >
                  Add
                </Button>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            {/* Host Devices */}
            <Typography variant="subtitle2" fontWeight={600} mb={1}>
              <Icon
                icon="mdi:expansion-card-variant"
                width={16}
                style={{ verticalAlign: 'middle', marginRight: 4 }}
              />
              Host Devices
            </Typography>
            {(
              (resource.spec?.template?.spec?.domain?.devices?.hostDevices || []) as Array<{
                name: string;
                deviceName: string;
              }>
            ).map((dev, idx) => (
              <Box key={idx} display="flex" alignItems="center" gap={1} mb={1}>
                <Chip label={dev.name} size="small" />
                <Typography variant="body2" color="text.secondary">
                  {dev.deviceName}
                </Typography>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    const hostDevices = [
                      ...(resource.spec?.template?.spec?.domain?.devices?.hostDevices || []),
                    ];
                    hostDevices.splice(idx, 1);
                    updateSpec({
                      template: {
                        ...resource.spec?.template,
                        spec: {
                          ...resource.spec?.template?.spec,
                          domain: {
                            ...resource.spec?.template?.spec?.domain,
                            devices: {
                              ...resource.spec?.template?.spec?.domain?.devices,
                              hostDevices,
                            },
                          },
                        },
                      },
                    });
                  }}
                >
                  <Icon icon="mdi:delete" width={16} />
                </IconButton>
              </Box>
            ))}
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Name"
                  placeholder="e.g., qat1"
                  value={newHostDev.name}
                  onChange={e => setNewHostDev({ ...newHostDev, name: e.target.value })}
                />
              </Grid>
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  select
                  label="Device"
                  value={newHostDev.deviceName}
                  onChange={e => setNewHostDev({ ...newHostDev, deviceName: e.target.value })}
                >
                  <MenuItem value="" disabled>
                    Select a permitted device
                  </MenuItem>
                  {allPermittedDeviceNames.map(n => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={2}>
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<Icon icon="mdi:plus" />}
                  disabled={!newHostDev.name || !newHostDev.deviceName}
                  onClick={() => {
                    const hostDevices = [
                      ...(resource.spec?.template?.spec?.domain?.devices?.hostDevices || []),
                      { name: newHostDev.name.trim(), deviceName: newHostDev.deviceName },
                    ];
                    updateSpec({
                      template: {
                        ...resource.spec?.template,
                        spec: {
                          ...resource.spec?.template?.spec,
                          domain: {
                            ...resource.spec?.template?.spec?.domain,
                            devices: {
                              ...resource.spec?.template?.spec?.domain?.devices,
                              hostDevices,
                            },
                          },
                        },
                      },
                    });
                    setNewHostDev({ name: '', deviceName: '' });
                  }}
                >
                  Add
                </Button>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Scheduling Section */}
      <Accordion sx={{ borderLeft: '3px solid #00bcd4' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(0, 188, 212, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:calendar-clock" color="#00bcd4" />
            <Typography variant="h6">Scheduling</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Node Selector */}
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Node Selector
          </Typography>
          {currentNodeSelectors.map((selector, index) => (
            <Grid container spacing={2} key={index} sx={{ mb: 2 }}>
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Label Key"
                  value={selector.key}
                  onChange={e => {
                    const newSelectors = [...currentNodeSelectors];
                    newSelectors[index].key = e.target.value;
                    handleNodeSelectorsChange(newSelectors);
                  }}
                />
              </Grid>
              <Grid item xs={5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Label Value"
                  value={selector.value}
                  onChange={e => {
                    const newSelectors = [...currentNodeSelectors];
                    newSelectors[index].value = e.target.value;
                    handleNodeSelectorsChange(newSelectors);
                  }}
                />
              </Grid>
              <Grid item xs={2}>
                <IconButton
                  size="small"
                  onClick={() =>
                    handleNodeSelectorsChange(currentNodeSelectors.filter((_, i) => i !== index))
                  }
                  color="error"
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() =>
              handleNodeSelectorsChange([...currentNodeSelectors, { key: '', value: '' }])
            }
            variant="outlined"
            size="small"
            sx={{ mb: 3 }}
          >
            Add Node Selector
          </Button>

          <Divider sx={{ my: 3 }} />

          {/* Tolerations */}
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Tolerations
          </Typography>
          {currentTolerations.map((toleration, index) => (
            <Card key={index} sx={{ mb: 2, p: 2, bgcolor: 'action.hover' }}>
              <Grid container spacing={2}>
                <Grid item xs={5}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Taint Key"
                    value={toleration.key}
                    onChange={e => {
                      const newTolerations = [...currentTolerations];
                      newTolerations[index].key = e.target.value;
                      handleTolerationsChange(newTolerations);
                    }}
                  />
                </Grid>
                <Grid item xs={5}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Taint Value"
                    value={toleration.value}
                    onChange={e => {
                      const newTolerations = [...currentTolerations];
                      newTolerations[index].value = e.target.value;
                      handleTolerationsChange(newTolerations);
                    }}
                  />
                </Grid>
                <Grid item xs={2}>
                  <IconButton
                    size="small"
                    onClick={() =>
                      handleTolerationsChange(currentTolerations.filter((_, i) => i !== index))
                    }
                    color="error"
                  >
                    <Icon icon="mdi:delete" />
                  </IconButton>
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Effect
                    </Typography>
                    <Select
                      value={toleration.effect}
                      onChange={e => {
                        const newTolerations = [...currentTolerations];
                        newTolerations[index].effect = e.target.value as
                          | 'NoSchedule'
                          | 'PreferNoSchedule'
                          | 'NoExecute';
                        handleTolerationsChange(newTolerations);
                      }}
                    >
                      <MenuItem value="NoSchedule">NoSchedule</MenuItem>
                      <MenuItem value="PreferNoSchedule">PreferNoSchedule</MenuItem>
                      <MenuItem value="NoExecute">NoExecute</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Card>
          ))}
          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() =>
              handleTolerationsChange([
                ...currentTolerations,
                { key: '', value: '', effect: 'NoSchedule' },
              ])
            }
            variant="outlined"
            size="small"
            sx={{ mb: 3 }}
          >
            Add Toleration
          </Button>

          <Divider sx={{ my: 3 }} />

          {/* Affinity Rules */}
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Affinity Rules
          </Typography>
          {currentAffinityRules.map((rule, ruleIndex) => (
            <Card key={ruleIndex} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider' }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <Typography variant="body2" fontWeight="bold">
                  Affinity Rule #{ruleIndex + 1}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() =>
                    handleAffinityChange(currentAffinityRules.filter((_, i) => i !== ruleIndex))
                  }
                  color="error"
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Box>

              <Grid container spacing={2}>
                {/* Type Selection */}
                <Grid item xs={6}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Type
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={rule.type}
                      onChange={e => {
                        const newRules = [...currentAffinityRules];
                        newRules[ruleIndex] = {
                          type: e.target.value as AffinityRule['type'],
                          condition: rule.condition,
                          weight: rule.weight,
                        };
                        handleAffinityChange(newRules);
                      }}
                    >
                      <MenuItem value="nodeAffinity">Node Affinity</MenuItem>
                      <MenuItem value="podAffinity">Pod Affinity</MenuItem>
                      <MenuItem value="podAntiAffinity">Pod Anti-Affinity</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Condition Selection */}
                <Grid item xs={6}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    Condition
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={rule.condition}
                      onChange={e => {
                        const newRules = [...currentAffinityRules];
                        newRules[ruleIndex].condition = e.target.value as 'required' | 'preferred';
                        handleAffinityChange(newRules);
                      }}
                    >
                      <MenuItem value="required">Required</MenuItem>
                      <MenuItem value="preferred">Preferred</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Weight for Preferred */}
                {rule.condition === 'preferred' && (
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Weight (1-100)"
                      value={rule.weight || 1}
                      onChange={e => {
                        const newRules = [...currentAffinityRules];
                        newRules[ruleIndex].weight = parseInt(e.target.value) || 1;
                        handleAffinityChange(newRules);
                      }}
                      inputProps={{ min: 1, max: 100 }}
                    />
                  </Grid>
                )}

                <Grid item xs={12}>
                  <Divider />
                </Grid>

                {/* Pod Affinity / Anti-Affinity Fields */}
                {(rule.type === 'podAffinity' || rule.type === 'podAntiAffinity') && (
                  <>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Topology Key *"
                        value={rule.topologyKey || ''}
                        onChange={e => {
                          const newRules = [...currentAffinityRules];
                          newRules[ruleIndex].topologyKey = e.target.value;
                          handleAffinityChange(newRules);
                        }}
                        placeholder="e.g., kubernetes.io/hostname"
                        helperText="Pods will be co-located (or separated) based on this topology domain"
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <Typography variant="body2" fontWeight="medium" sx={{ mb: 1, mt: 1 }}>
                        Match Pod Labels
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 1, display: 'block' }}
                      >
                        Complex nested structure - simplified for now. Full implementation pending.
                      </Typography>
                    </Grid>
                  </>
                )}

                {/* Node Affinity Fields */}
                {rule.type === 'nodeAffinity' && (
                  <Grid item xs={12}>
                    <Typography variant="body2" fontWeight="medium" sx={{ mb: 1 }}>
                      Match Node Labels
                    </Typography>
                    {(rule.nodeLabels || []).map((label, labelIndex) => (
                      <Grid container spacing={2} key={labelIndex} sx={{ mb: 2 }}>
                        <Grid item xs={3}>
                          <Autocomplete
                            freeSolo
                            fullWidth
                            size="small"
                            options={nodeLabels}
                            value={label.key}
                            onChange={(_, newValue) => {
                              const newRules = [...currentAffinityRules];
                              const newLabels = [...(newRules[ruleIndex].nodeLabels || [])];
                              newLabels[labelIndex] = {
                                ...newLabels[labelIndex],
                                key: newValue || '',
                              };
                              newRules[ruleIndex].nodeLabels = newLabels;
                              handleAffinityChange(newRules);
                            }}
                            renderInput={params => (
                              <TextField {...params} placeholder="Label key" />
                            )}
                          />
                        </Grid>
                        <Grid item xs={3}>
                          <Select
                            fullWidth
                            size="small"
                            value={label.operator || 'In'}
                            onChange={e => {
                              const newRules = [...currentAffinityRules];
                              const newLabels = [...(newRules[ruleIndex].nodeLabels || [])];
                              newLabels[labelIndex] = {
                                ...newLabels[labelIndex],
                                operator: e.target.value,
                              };
                              newRules[ruleIndex].nodeLabels = newLabels;
                              handleAffinityChange(newRules);
                            }}
                          >
                            <MenuItem value="In">In</MenuItem>
                            <MenuItem value="NotIn">NotIn</MenuItem>
                            <MenuItem value="Exists">Exists</MenuItem>
                            <MenuItem value="DoesNotExist">DoesNotExist</MenuItem>
                            <MenuItem value="Gt">Gt</MenuItem>
                            <MenuItem value="Lt">Lt</MenuItem>
                          </Select>
                        </Grid>
                        <Grid item xs={5}>
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="value1,value2,..."
                            value={(label.values || []).join(',')}
                            onChange={e => {
                              const newRules = [...currentAffinityRules];
                              const newLabels = [...(newRules[ruleIndex].nodeLabels || [])];
                              newLabels[labelIndex] = {
                                ...newLabels[labelIndex],
                                values: e.target.value
                                  ? e.target.value.split(',').map(v => v.trim())
                                  : [],
                              };
                              newRules[ruleIndex].nodeLabels = newLabels;
                              handleAffinityChange(newRules);
                            }}
                            disabled={
                              label.operator === 'Exists' || label.operator === 'DoesNotExist'
                            }
                            helperText={
                              label.operator === 'Exists' || label.operator === 'DoesNotExist'
                                ? 'Values not needed for this operator'
                                : 'Comma-separated values'
                            }
                          />
                        </Grid>
                        <Grid item xs={1}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              const newRules = [...currentAffinityRules];
                              newRules[ruleIndex].nodeLabels = (
                                newRules[ruleIndex].nodeLabels || []
                              ).filter((_, i) => i !== labelIndex);
                              handleAffinityChange(newRules);
                            }}
                            color="error"
                          >
                            <Icon icon="mdi:delete" />
                          </IconButton>
                        </Grid>
                      </Grid>
                    ))}
                    <Button
                      startIcon={<Icon icon="mdi:plus" />}
                      onClick={() => {
                        const newRules = [...currentAffinityRules];
                        if (!newRules[ruleIndex].nodeLabels) {
                          newRules[ruleIndex].nodeLabels = [];
                        }
                        newRules[ruleIndex].nodeLabels.push({
                          key: '',
                          operator: 'In',
                          values: [],
                        });
                        handleAffinityChange(newRules);
                      }}
                      variant="text"
                      size="small"
                      sx={{ mb: 2 }}
                    >
                      Add Label Match
                    </Button>
                  </Grid>
                )}
              </Grid>
            </Card>
          ))}
          <Button
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() =>
              handleAffinityChange([
                ...currentAffinityRules,
                { type: 'nodeAffinity', condition: 'required' },
              ])
            }
            variant="outlined"
            size="small"
            sx={{ mb: 3 }}
          >
            Add Affinity Rule
          </Button>

          <Divider sx={{ my: 3 }} />

          {/* Eviction Strategy */}
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Eviction Strategy
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={enableLiveMigrate}
                onChange={e => handleEvictionStrategyChange(e.target.checked)}
              />
            }
            label={
              <>
                Enable Live Migration on eviction <InfoTooltip text={TOOLTIPS.evictionStrategy} />
              </>
            }
            sx={{ mb: 2 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
            When enabled, VMs will be live migrated to another node instead of being terminated
          </Typography>
        </AccordionDetails>
      </Accordion>

      {/* Advanced Details Section */}
      <Accordion sx={{ borderLeft: '3px solid #607d8b' }}>
        <AccordionSummary
          expandIcon={<Icon icon="mdi:chevron-down" />}
          sx={{ bgcolor: 'rgba(96, 125, 139, 0.06)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:cog-outline" color="#607d8b" />
            <Typography variant="h6">Advanced Details</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {!editMode && (
            <>
              <FormControl component="fieldset" sx={{ mb: 3 }}>
                <FormLabel component="legend">
                  Start VM after creation <InfoTooltip text={TOOLTIPS.runStrategyAlways} />
                </FormLabel>
                <RadioGroup
                  row
                  value={runStrategy}
                  onChange={e => handleRunStrategyChange(e.target.value as 'Always' | 'Halted')}
                >
                  <FormControlLabel value="Always" control={<Radio />} label="Yes" />
                  <FormControlLabel value="Halted" control={<Radio />} label="No" />
                </RadioGroup>
              </FormControl>

              <Divider sx={{ my: 3 }} />
            </>
          )}

          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Virtual Hardware
            </Typography>

            {/* Firmware/BIOS */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Firmware
              </Typography>
              <Select
                size="small"
                value={firmwareType}
                onChange={e =>
                  handleFirmwareChange(e.target.value as 'bios' | 'uefi' | 'uefi-secure')
                }
              >
                <MenuItem value="bios">BIOS Legacy</MenuItem>
                <MenuItem value="uefi">UEFI</MenuItem>
                <MenuItem value="uefi-secure">UEFI with Secure Boot</MenuItem>
              </Select>
            </FormControl>

            {/* Persistent UEFI variables — only shown when firmware is UEFI */}
            {isUefi && (
              <Box sx={{ mb: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={enableEfiPersistent}
                      onChange={e => handleEfiPersistentChange(e.target.checked)}
                    />
                  }
                  label={
                    <>
                      Persist UEFI variables <InfoTooltip text={TOOLTIPS.persistUefiVars} />
                    </>
                  }
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', ml: 4 }}
                >
                  Saves EFI variable store to a persistent volume — preserves boot order, Secure
                  Boot keys, and other UEFI settings across reboots
                </Typography>
              </Box>
            )}

            {/* CPU Model */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                CPU Model (optional)
              </Typography>
              <Select
                size="small"
                value={cpuModel}
                onChange={e => handleCpuModelChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">Default</MenuItem>
                <MenuItem value="host-passthrough">host-passthrough (Direct passthrough)</MenuItem>
                <MenuItem value="host-model">host-model (Host-like model)</MenuItem>
                <MenuItem disabled>───── Intel x86_64 ─────</MenuItem>
                <MenuItem value="Conroe">Conroe</MenuItem>
                <MenuItem value="Penryn">Penryn</MenuItem>
                <MenuItem value="Nehalem">Nehalem</MenuItem>
                <MenuItem value="Westmere">Westmere</MenuItem>
                <MenuItem value="SandyBridge">SandyBridge</MenuItem>
                <MenuItem value="IvyBridge">IvyBridge</MenuItem>
                <MenuItem value="Haswell">Haswell</MenuItem>
                <MenuItem value="Broadwell">Broadwell</MenuItem>
                <MenuItem value="Skylake-Client">Skylake-Client</MenuItem>
                <MenuItem value="Skylake-Server">Skylake-Server</MenuItem>
                <MenuItem value="Cascadelake-Server">Cascadelake-Server</MenuItem>
                <MenuItem value="Cooperlake">Cooperlake</MenuItem>
                <MenuItem value="Icelake-Server">Icelake-Server</MenuItem>
                <MenuItem value="Sapphirerapids">Sapphirerapids</MenuItem>
                <MenuItem disabled>───── AMD x86_64 ─────</MenuItem>
                <MenuItem value="Opteron_G1">Opteron G1</MenuItem>
                <MenuItem value="Opteron_G2">Opteron G2</MenuItem>
                <MenuItem value="Opteron_G3">Opteron G3</MenuItem>
                <MenuItem value="Opteron_G4">Opteron G4</MenuItem>
                <MenuItem value="Opteron_G5">Opteron G5</MenuItem>
                <MenuItem value="EPYC">EPYC</MenuItem>
                <MenuItem value="EPYC-Rome">EPYC-Rome</MenuItem>
                <MenuItem value="EPYC-Milan">EPYC-Milan</MenuItem>
                <MenuItem value="EPYC-Genoa">EPYC-Genoa</MenuItem>
                <MenuItem disabled>───── ARM64 ─────</MenuItem>
                <MenuItem value="cortex-a57">Cortex-A57</MenuItem>
                <MenuItem value="cortex-a72">Cortex-A72</MenuItem>
                <MenuItem value="cortex-a53">Cortex-A53</MenuItem>
                <MenuItem value="max">ARM Max (latest features)</MenuItem>
                <MenuItem disabled>───── IBM Power ─────</MenuItem>
                <MenuItem value="POWER8">POWER8</MenuItem>
                <MenuItem value="POWER9">POWER9</MenuItem>
                <MenuItem value="POWER10">POWER10</MenuItem>
                <MenuItem disabled>───── IBM s390x ─────</MenuItem>
                <MenuItem value="z13">z13</MenuItem>
                <MenuItem value="z14">z14</MenuItem>
                <MenuItem value="z15">z15</MenuItem>
              </Select>
            </FormControl>

            {/* Nested Virtualization */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableNestedVirtualization}
                    onChange={e => handleNestedVirtualizationChange(e.target.checked)}
                  />
                }
                label="Enable Nested Virtualization"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Adds both vmx (Intel) and svm (AMD) CPU features with policy: require
              </Typography>
            </Box>
          </Box>

          {/* ── User Data ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              User Data
            </Typography>

            <FormControl component="fieldset" sx={{ mb: 3 }}>
              <FormLabel component="legend">Mode</FormLabel>
              <RadioGroup
                row
                value={userDataMode}
                onChange={e => handleUserDataModeChange(e.target.value as 'cloudInit' | 'ignition')}
              >
                <FormControlLabel
                  value="cloudInit"
                  control={<Radio />}
                  label={
                    <>
                      Cloud-Init (CloudInitNoCloud) <InfoTooltip text={TOOLTIPS.cloudInitNoCloud} />
                    </>
                  }
                />
                <FormControlLabel
                  value="ignition"
                  control={<Radio />}
                  label={
                    <>
                      Ignition (CloudInitConfigDrive){' '}
                      <InfoTooltip text={TOOLTIPS.cloudInitConfigDrive} />
                    </>
                  }
                />
              </RadioGroup>
            </FormControl>

            {userDataMode === 'cloudInit' && (
              <>
                {/* Cloud-Init User Data */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                    User Data
                  </Typography>
                  <FormControl component="fieldset" sx={{ mb: 1 }}>
                    <RadioGroup
                      row
                      value={cloudInitUserDataType}
                      onChange={e =>
                        setCloudInitUserDataType(e.target.value as 'inline' | 'base64' | 'secret')
                      }
                    >
                      <FormControlLabel value="inline" control={<Radio />} label="Inline" />
                      <FormControlLabel value="base64" control={<Radio />} label="Base64" />
                      <FormControlLabel value="secret" control={<Radio />} label="Secret" />
                    </RadioGroup>
                  </FormControl>

                  {cloudInitUserDataType === 'inline' && (
                    <TextField
                      fullWidth
                      multiline
                      rows={6}
                      value={cloudInitUserData}
                      onChange={e => handleCloudInitUserDataChange('inline', e.target.value)}
                      placeholder="#cloud-config&#10;users:&#10;  - name: admin&#10;    ssh_authorized_keys:&#10;      - ssh-rsa ..."
                      inputProps={{ maxLength: 2000 }}
                      helperText={`${cloudInitUserData.length}/2000 characters`}
                      error={cloudInitUserData.length > 2000}
                    />
                  )}

                  {cloudInitUserDataType === 'base64' && (
                    <TextField
                      fullWidth
                      value={cloudInitUserData}
                      onChange={e => handleCloudInitUserDataChange('base64', e.target.value)}
                      placeholder="Base64-encoded user data"
                      inputProps={{ maxLength: 2000 }}
                      helperText={`${cloudInitUserData.length}/2000 characters`}
                      error={cloudInitUserData.length > 2000}
                    />
                  )}

                  {cloudInitUserDataType === 'secret' && (
                    <Autocomplete
                      fullWidth
                      options={secrets}
                      value={cloudInitUserDataSecret}
                      onChange={(_, newValue) =>
                        handleCloudInitUserDataChange('secret', newValue || '')
                      }
                      renderInput={params => (
                        <TextField {...params} placeholder="Select secret..." />
                      )}
                    />
                  )}
                </Box>

                {/* Cloud-Init Network Data */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                    Network Data (optional)
                  </Typography>
                  <FormControl component="fieldset" sx={{ mb: 1 }}>
                    <RadioGroup
                      row
                      value={cloudInitNetworkDataType}
                      onChange={e =>
                        setCloudInitNetworkDataType(
                          e.target.value as 'inline' | 'base64' | 'secret'
                        )
                      }
                    >
                      <FormControlLabel value="inline" control={<Radio />} label="Inline" />
                      <FormControlLabel value="base64" control={<Radio />} label="Base64" />
                      <FormControlLabel value="secret" control={<Radio />} label="Secret" />
                    </RadioGroup>
                  </FormControl>

                  {cloudInitNetworkDataType === 'inline' && (
                    <TextField
                      fullWidth
                      multiline
                      rows={6}
                      value={cloudInitNetworkData}
                      onChange={e => handleCloudInitNetworkDataChange('inline', e.target.value)}
                      placeholder="network:&#10;  version: 1&#10;  config:&#10;    - type: physical&#10;      name: eth0"
                      inputProps={{ maxLength: 2000 }}
                      helperText={`${cloudInitNetworkData.length}/2000 characters`}
                      error={cloudInitNetworkData.length > 2000}
                    />
                  )}

                  {cloudInitNetworkDataType === 'base64' && (
                    <TextField
                      fullWidth
                      value={cloudInitNetworkData}
                      onChange={e => handleCloudInitNetworkDataChange('base64', e.target.value)}
                      placeholder="Base64-encoded network data"
                      inputProps={{ maxLength: 2000 }}
                      helperText={`${cloudInitNetworkData.length}/2000 characters`}
                      error={cloudInitNetworkData.length > 2000}
                    />
                  )}

                  {cloudInitNetworkDataType === 'secret' && (
                    <Autocomplete
                      fullWidth
                      options={secrets}
                      value={cloudInitNetworkDataSecret}
                      onChange={(_, newValue) =>
                        handleCloudInitNetworkDataChange('secret', newValue || '')
                      }
                      renderInput={params => (
                        <TextField {...params} placeholder="Select secret..." />
                      )}
                    />
                  )}
                </Box>
              </>
            )}

            {userDataMode === 'ignition' && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                  Ignition Config
                </Typography>
                <FormControl component="fieldset" sx={{ mb: 1 }}>
                  <RadioGroup
                    row
                    value={ignitionDataType}
                    onChange={e =>
                      setIgnitionDataType(e.target.value as 'inline' | 'base64' | 'secret')
                    }
                  >
                    <FormControlLabel value="inline" control={<Radio />} label="Inline" />
                    <FormControlLabel value="base64" control={<Radio />} label="Base64" />
                    <FormControlLabel value="secret" control={<Radio />} label="Secret" />
                  </RadioGroup>
                </FormControl>

                {ignitionDataType === 'inline' && (
                  <TextField
                    fullWidth
                    multiline
                    rows={8}
                    value={ignitionData}
                    onChange={e => handleIgnitionDataChange('inline', e.target.value)}
                    placeholder='{"ignition": {"version": "3.3.0"}, "passwd": {"users": [...]}}'
                    inputProps={{ maxLength: 2000 }}
                    helperText={`${ignitionData.length}/2000 characters`}
                    error={ignitionData.length > 2000}
                  />
                )}

                {ignitionDataType === 'base64' && (
                  <TextField
                    fullWidth
                    value={ignitionData}
                    onChange={e => handleIgnitionDataChange('base64', e.target.value)}
                    placeholder="Base64-encoded Ignition config"
                    inputProps={{ maxLength: 2000 }}
                    helperText={`${ignitionData.length}/2000 characters`}
                    error={ignitionData.length > 2000}
                  />
                )}

                {ignitionDataType === 'secret' && (
                  <Autocomplete
                    fullWidth
                    options={secrets}
                    value={ignitionDataSecret}
                    onChange={(_, newValue) => handleIgnitionDataChange('secret', newValue || '')}
                    renderInput={params => <TextField {...params} placeholder="Select secret..." />}
                  />
                )}
              </Box>
            )}
          </Box>

          {/* ── Hardware Configuration ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Hardware Configuration
            </Typography>

            {/* Machine Type */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Machine Type (optional)
              </Typography>
              <Select
                size="small"
                value={machineType}
                onChange={e => handleMachineTypeChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">Default (q35)</MenuItem>
                <MenuItem value="pc-q35-rhel9.2.0">pc-q35-rhel9.2.0</MenuItem>
                <MenuItem value="pc-q35-rhel9.0.0">pc-q35-rhel9.0.0</MenuItem>
                <MenuItem value="q35">q35</MenuItem>
                <MenuItem value="pc-i440fx-rhel7.6.0">pc-i440fx-rhel7.6.0</MenuItem>
                <MenuItem value="pc">pc (i440fx)</MenuItem>
              </Select>
            </FormControl>

            {/* ACPI */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableAcpi}
                    onChange={e => handleAcpiChange(e.target.checked)}
                  />
                }
                label="Enable ACPI"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Advanced Configuration and Power Interface - allows guest OS to communicate with
                virtual hardware for power management (shutdown/reboot/suspend)
              </Typography>
            </Box>

            {/* vTPM (Persistent TPM) */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox checked={enableTPM} onChange={e => handleTPMChange(e.target.checked)} />
                }
                label="Enable vTPM (persistent)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Adds a virtual Trusted Platform Module backed by a persistent volume — required for
                Windows 11, BitLocker, and measured boot. State survives reboots and migrations.
              </Typography>
            </Box>

            {/* Hugepages */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Hugepages (optional)
              </Typography>
              <Select
                size="small"
                value={hugepages}
                onChange={e => handleHugepagesChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">None (default 4Ki pages)</MenuItem>
                <MenuItem value="2Mi">2Mi — standard hugepages, good for most workloads</MenuItem>
                <MenuItem value="1Gi">
                  1Gi — large hugepages, best for memory-intensive VMs
                </MenuItem>
              </Select>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5, display: 'block' }}
              >
                Pre-allocates large memory pages for the VM — reduces TLB misses and improves
                performance. Requires hugepages to be configured on the host nodes.
              </Typography>
            </FormControl>
          </Box>

          {/* ── Performance ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Performance
            </Typography>

            {/* Block Multi-Queue */}
            <Box sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableBlockMultiQueue}
                    onChange={e => handleBlockMultiQueueChange(e.target.checked)}
                  />
                }
                label="Block multi-queue"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Multiple I/O queues for virtio disks — improves throughput on multi-CPU VMs with
                heavy disk I/O
              </Typography>
            </Box>

            {/* Network Interface Multi-Queue */}
            <Box sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableNetMultiQueue}
                    onChange={e => handleNetMultiQueueChange(e.target.checked)}
                  />
                }
                label="Network multi-queue"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Multiple queues for virtio-net — improves network throughput on multi-CPU VMs
              </Typography>
            </Box>

            {/* I/O Threads Policy */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                I/O Threads Policy (optional)
              </Typography>
              <Select
                size="small"
                value={ioThreadsPolicy}
                onChange={e => handleIoThreadsPolicyChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">None (default)</MenuItem>
                <MenuItem value="auto">
                  Auto — one thread per disk, shared when exceeding CPU count
                </MenuItem>
                <MenuItem value="shared">Shared — single thread for all disks</MenuItem>
              </Select>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5, display: 'block' }}
              >
                Dedicates threads for disk I/O, reducing CPU contention with the vCPU threads
              </Typography>
            </FormControl>
          </Box>

          {/* ── Devices ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Devices
            </Typography>

            {/* Sound Device */}
            <Box sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableSound}
                    onChange={e => handleSoundChange(e.target.checked)}
                  />
                }
                label="Sound device (ICH9)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Emulates an Intel HDA sound card — needed for desktop/VDI workloads
              </Typography>
            </Box>

            {/* Watchdog */}
            <Box sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableWatchdog}
                    onChange={e => handleWatchdogChange(e.target.checked)}
                  />
                }
                label="Watchdog (i6300esb)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Hardware watchdog timer — automatically acts if the guest OS stops responding
              </Typography>
            </Box>
            {enableWatchdog && (
              <FormControl fullWidth sx={{ mb: 2, ml: 4, maxWidth: 'calc(100% - 32px)' }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mb: 0.5, display: 'block' }}
                >
                  Watchdog Action
                </Typography>
                <Select
                  size="small"
                  value={watchdogAction}
                  onChange={e => handleWatchdogActionChange(e.target.value)}
                >
                  <MenuItem value="reset">Reset — reboot the VM</MenuItem>
                  <MenuItem value="poweroff">Poweroff — force power off</MenuItem>
                  <MenuItem value="shutdown">Shutdown — graceful ACPI shutdown</MenuItem>
                </Select>
              </FormControl>
            )}

            {/* RNG Device */}
            <Box sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox checked={enableRng} onChange={e => handleRngChange(e.target.checked)} />
                }
                label="Virtio RNG"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Virtual random number generator — provides fast entropy from the host to the guest
              </Typography>
            </Box>

            {/* Downward Metrics */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={enableDownwardMetrics}
                    onChange={e => handleDownwardMetricsChange(e.target.checked)}
                  />
                }
                label="Downward metrics"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Exposes host metrics (CPU load, memory) to the guest via virtio-serial
              </Typography>
            </Box>
          </Box>

          {/* ── Security ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Security
            </Typography>

            {/* SMM */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox checked={enableSmm} onChange={e => handleSmmChange(e.target.checked)} />
                }
                label="System Management Mode (SMM)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Required for UEFI Secure Boot — enables the System Management Mode firmware
                interface
              </Typography>
            </Box>
          </Box>

          {/* ── Auto-Attach ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Auto-Attach Devices
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              These devices are attached by default. Disable to remove them from the VM.
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0, mb: 2 }}>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoGraphics}
                      onChange={e =>
                        handleAutoAttachChange('autoattachGraphicsDevice', e.target.checked)
                      }
                    />
                  }
                  label="Graphics (VNC)"
                />
              </Box>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoSerial}
                      onChange={e =>
                        handleAutoAttachChange('autoattachSerialConsole', e.target.checked)
                      }
                    />
                  }
                  label="Serial console"
                />
              </Box>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoMemBalloon}
                      onChange={e =>
                        handleAutoAttachChange('autoattachMemBalloon', e.target.checked)
                      }
                    />
                  }
                  label={
                    <>
                      Memory balloon <InfoTooltip text={TOOLTIPS.memoryBalloon} />
                    </>
                  }
                />
              </Box>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoPodInterface}
                      onChange={e =>
                        handleAutoAttachChange('autoattachPodInterface', e.target.checked)
                      }
                    />
                  }
                  label={
                    <>
                      Pod network <InfoTooltip text={TOOLTIPS.networkPod} />
                    </>
                  }
                />
              </Box>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoVSOCK}
                      onChange={e => handleAutoAttachChange('autoattachVSOCK', e.target.checked)}
                    />
                  }
                  label={
                    <>
                      VSOCK <InfoTooltip text={TOOLTIPS.vsock} />
                    </>
                  }
                />
              </Box>
              <Box sx={{ minWidth: 220 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={autoInputDevice}
                      onChange={e =>
                        handleAutoAttachChange('autoattachInputDevice', e.target.checked)
                      }
                    />
                  }
                  label={
                    <>
                      Input device <InfoTooltip text={TOOLTIPS.inputDevice} />
                    </>
                  }
                />
              </Box>
            </Box>
          </Box>

          {/* ── Scheduling ── */}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2.5,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
              Scheduling
            </Typography>

            {/* Priority Class */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Priority Class (optional)
              </Typography>
              <Select
                size="small"
                value={priorityClassName}
                onChange={e => handlePriorityClassChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">None (default)</MenuItem>
                <MenuItem value="system-cluster-critical">system-cluster-critical</MenuItem>
                <MenuItem value="system-node-critical">system-node-critical</MenuItem>
              </Select>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5, display: 'block' }}
              >
                Kubernetes scheduling priority — higher priority VMs are scheduled first and less
                likely to be evicted
              </Typography>
            </FormControl>

            {/* Timezone */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Timezone (optional)
              </Typography>
              <Select
                size="small"
                value={timezone}
                onChange={e => handleTimezoneChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">UTC (default)</MenuItem>
                <MenuItem disabled>───── Americas ─────</MenuItem>
                <MenuItem value="America/New_York">America/New_York (EST/EDT)</MenuItem>
                <MenuItem value="America/Chicago">America/Chicago (CST/CDT)</MenuItem>
                <MenuItem value="America/Denver">America/Denver (MST/MDT)</MenuItem>
                <MenuItem value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</MenuItem>
                <MenuItem value="America/Toronto">America/Toronto</MenuItem>
                <MenuItem value="America/Mexico_City">America/Mexico_City</MenuItem>
                <MenuItem value="America/Sao_Paulo">America/Sao_Paulo</MenuItem>
                <MenuItem value="America/Buenos_Aires">America/Buenos_Aires</MenuItem>
                <MenuItem disabled>───── Europe ─────</MenuItem>
                <MenuItem value="Europe/London">Europe/London (GMT/BST)</MenuItem>
                <MenuItem value="Europe/Paris">Europe/Paris (CET/CEST)</MenuItem>
                <MenuItem value="Europe/Berlin">Europe/Berlin</MenuItem>
                <MenuItem value="Europe/Rome">Europe/Rome</MenuItem>
                <MenuItem value="Europe/Madrid">Europe/Madrid</MenuItem>
                <MenuItem value="Europe/Amsterdam">Europe/Amsterdam</MenuItem>
                <MenuItem value="Europe/Brussels">Europe/Brussels</MenuItem>
                <MenuItem value="Europe/Zurich">Europe/Zurich</MenuItem>
                <MenuItem value="Europe/Stockholm">Europe/Stockholm</MenuItem>
                <MenuItem value="Europe/Moscow">Europe/Moscow</MenuItem>
                <MenuItem disabled>───── Asia ─────</MenuItem>
                <MenuItem value="Asia/Dubai">Asia/Dubai</MenuItem>
                <MenuItem value="Asia/Kolkata">Asia/Kolkata</MenuItem>
                <MenuItem value="Asia/Shanghai">Asia/Shanghai</MenuItem>
                <MenuItem value="Asia/Hong_Kong">Asia/Hong_Kong</MenuItem>
                <MenuItem value="Asia/Tokyo">Asia/Tokyo</MenuItem>
                <MenuItem value="Asia/Seoul">Asia/Seoul</MenuItem>
                <MenuItem value="Asia/Singapore">Asia/Singapore</MenuItem>
                <MenuItem value="Asia/Bangkok">Asia/Bangkok</MenuItem>
                <MenuItem disabled>───── Pacific ─────</MenuItem>
                <MenuItem value="Australia/Sydney">Australia/Sydney</MenuItem>
                <MenuItem value="Australia/Melbourne">Australia/Melbourne</MenuItem>
                <MenuItem value="Pacific/Auckland">Pacific/Auckland</MenuItem>
                <MenuItem disabled>───── Africa ─────</MenuItem>
                <MenuItem value="Africa/Cairo">Africa/Cairo</MenuItem>
                <MenuItem value="Africa/Johannesburg">Africa/Johannesburg</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </AccordionDetails>
      </Accordion>

      <ImageCatalogPicker
        open={bootCatalogOpen}
        onClose={() => setBootCatalogOpen(false)}
        onSelect={handleBootCatalogSelect}
      />
    </Box>
  );
}
