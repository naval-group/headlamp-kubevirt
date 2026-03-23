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
import DataSource from '../BootableVolumes/DataSource';
import VirtualMachineClusterInstanceType from '../InstanceTypes/VirtualMachineClusterInstanceType';
import NetworkAttachmentDefinition from '../NetworkAttachmentDefinitions/NetworkAttachmentDefinition';

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
}

export default function VMFormFull({ resource, onChange, editMode = false }: VMFormFullProps) {
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

  // Parse more state from resource
  const bootSourceId = resource.spec?.dataVolumeTemplates?.[0]?.spec?.sourceRef?.name || '';
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
        accessMode: 'ReadWriteOnce' as const,
        size: vol.emptyDisk?.capacity || '10Gi',
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
  const timezone = resource.spec?.template?.spec?.domain?.clock?.timezone || '';

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

  // Local state for complex UI interactions
  const [useAdvancedTopologyState, setUseAdvancedTopologyState] = useState(useAdvancedTopology);

  // Fetch NADs for the selected namespace
  const { items: networkAttachmentDefs } = NetworkAttachmentDefinition.useList({ namespace });

  // Calculate total vCPUs
  const totalVCPUs = useAdvancedTopologyState
    ? parseInt(cpuCores || '1') * parseInt(cpuSockets || '1') * parseInt(cpuThreads || '1')
    : parseInt(customCpu || '1');

  // Get selected boot source
  const selectedBootSource = dataSources?.find(ds => ds.metadata.uid === bootSourceId);

  // Check if pod networking exists
  const hasPodNetworking = currentNetworkInterfaces.some(iface => iface.type === 'pod');

  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const nsList = response?.items?.map(
            (ns: { metadata: { name: string } }) => ns.metadata.name
          ) || ['default'];
          setNamespaces(nsList);
        }
      )
      .catch(err => {
        console.error('Failed to fetch namespaces:', err);
      });
  }, []);

  // Fetch ConfigMaps, Secrets, ServiceAccounts for selected namespace
  React.useEffect(() => {
    if (!namespace) return;

    // Fetch ConfigMaps
    ApiProxy.request(`/api/v1/namespaces/${namespace}/configmaps`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const cmList =
            response?.items?.map((cm: { metadata: { name: string } }) => cm.metadata.name) || [];
          setConfigMaps(cmList);
        }
      )
      .catch(err => console.error('Failed to fetch configmaps:', err));

    // Fetch Secrets
    ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const secretList =
            response?.items?.map((s: { metadata: { name: string } }) => s.metadata.name) || [];
          setSecrets(secretList);
        }
      )
      .catch(err => console.error('Failed to fetch secrets:', err));

    // Fetch ServiceAccounts
    ApiProxy.request(`/api/v1/namespaces/${namespace}/serviceaccounts`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const saList =
            response?.items?.map((sa: { metadata: { name: string } }) => sa.metadata.name) || [];
          setServiceAccounts(saList);
        }
      )
      .catch(err => console.error('Failed to fetch serviceaccounts:', err));

    // Fetch PVCs
    ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const pvcList =
            response?.items?.map((pvc: { metadata: { name: string } }) => pvc.metadata.name) || [];
          setPvcs(pvcList);
        }
      )
      .catch(err => console.error('Failed to fetch pvcs:', err));

    // Fetch VolumeSnapshots
    ApiProxy.request(`/apis/snapshot.storage.k8s.io/v1/namespaces/${namespace}/volumesnapshots`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const vsList =
            response?.items?.map((vs: { metadata: { name: string } }) => vs.metadata.name) || [];
          setVolumeSnapshots(vsList);
        }
      )
      .catch(err => console.error('Failed to fetch volume snapshots:', err));

    // Fetch DataVolumes
    ApiProxy.request(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes`)
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const dvList =
            response?.items?.map((dv: { metadata: { name: string } }) => dv.metadata.name) || [];
          setDataVolumes(dvList);
        }
      )
      .catch(err => console.error('Failed to fetch datavolumes:', err));
  }, [namespace]);

  // Fetch StorageClasses and Nodes (cluster-wide)
  React.useEffect(() => {
    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
          const scList =
            response?.items?.map((sc: { metadata: { name: string } }) => sc.metadata.name) || [];
          setStorageClasses(scList);
        }
      )
      .catch(err => console.error('Failed to fetch storage classes:', err));

    // Fetch nodes and extract unique label keys
    ApiProxy.request('/api/v1/nodes')
      .then(
        (response: {
          items?: Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
        }) => {
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
      .catch(err => console.error('Failed to fetch nodes:', err));
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
  const handleBootSourceChange = (sourceUid: string) => {
    const source = dataSources?.find(ds => ds.metadata.uid === sourceUid);
    if (!source) return;

    // Update dataVolumeTemplates with the selected boot source
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
        storage: {
          resources: {
            requests: {
              storage: source.getSize(),
            },
          },
          storageClassName: source.getStorageClass(),
        },
      },
    };

    updateSpec({ dataVolumeTemplates: [dataVolumeTemplate] });
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
    const needsDVT = ['clone', 'snapshot', 'dataVolume'].includes(diskFormData.sourceType);

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
      case 'containerDisk':
        return { ...base, containerDisk: { image: disk.sourceDetail } };
      case 'persistentVolumeClaim':
        return { ...base, persistentVolumeClaim: { claimName: disk.sourceDetail } };
      case 'dataVolumeExisting':
        return { ...base, dataVolume: { name: disk.sourceDetail } };
      case 'dataVolume':
        // DataVolume import - volume references the DVT by disk name
        return { ...base, dataVolume: { name: disk.name } };
      case 'configMap':
        return { ...base, configMap: { name: disk.sourceDetail } };
      case 'secret':
        return { ...base, secret: { secretName: disk.sourceDetail } };
      case 'serviceAccount':
        return { ...base, serviceAccount: { serviceAccountName: disk.sourceDetail } };
      case 'clone':
      case 'snapshot':
        // These use DataVolumeTemplate, so volume references the DataVolume
        return { ...base, dataVolume: { name: disk.name } };
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

  // Helper to build DataVolumeTemplate for clone/snapshot/ephemeral
  const buildDataVolumeTemplate = (disk: AdditionalDisk): KubeResourceBuilder => {
    const base: KubeResourceBuilder = {
      metadata: { name: disk.name },
      spec: {
        storage: {
          resources: {
            requests: {
              storage: disk.size || '10Gi',
            },
          },
          ...(disk.storageClass && { storageClassName: disk.storageClass }),
          accessModes: [disk.accessMode || 'ReadWriteOnce'],
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

    const newVolumes = volumes.filter((v: KubeResourceBuilder) => v.name !== diskToRemove.name);
    const newDisks = disks.filter((d: KubeResourceBuilder) => d.name !== diskToRemove.name);

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
      const newDomain = { ...resource.spec?.template?.spec?.domain };
      delete newDomain.firmware;
      updateDomain(newDomain);
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
          <TextField
            fullWidth
            label="Name"
            required
            value={name}
            onChange={e => handleNameChange(e.target.value)}
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
                helperText={editMode ? 'Namespace cannot be changed' : 'Namespace for the VM'}
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
            <FormControl fullWidth>
              <Select
                value={bootSourceId}
                onChange={e => handleBootSourceChange(e.target.value)}
                displayEmpty
              >
                <MenuItem value="" disabled>
                  Select a boot source
                </MenuItem>
                {dataSources?.map(ds => (
                  <MenuItem key={ds.metadata.uid} value={ds.metadata.uid}>
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
                <Typography variant="body2">
                  <strong>Storage Class:</strong> {selectedBootSource.getStorageClass()}
                </Typography>
              </Box>
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
              <FormControlLabel value="instanceType" control={<Radio />} label="Instance Type" />
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

              {/* Root Disk (bootable) */}
              <TableRow>
                <TableCell>
                  <Typography variant="body2">rootdisk (bootable)</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">PVC (DataSource)</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{selectedBootSource?.getSize() || '30Gi'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">Disk</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">virtio</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {selectedBootSource?.getStorageClass() || '-'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" disabled>
                    <Icon icon="mdi:dots-vertical" />
                  </IconButton>
                </TableCell>
              </TableRow>

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
                      <MenuItem value="empty">Empty Disk</MenuItem>
                      <MenuItem value="containerDisk">Container Disk</MenuItem>
                      <MenuItem value="persistentVolumeClaim">PVC (Use Existing)</MenuItem>
                      <MenuItem value="snapshot">PVC Snapshot (Restore)</MenuItem>
                      <MenuItem value="clone">Clone PVC (Copy)</MenuItem>
                      <MenuItem value="dataVolume">DataVolume (Import New)</MenuItem>
                      <MenuItem value="dataVolumeExisting">DataVolume (Use Existing)</MenuItem>
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
                          placeholder="docker.io/user/image:tag"
                          helperText="Container image with disk"
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

                {diskFormData.sourceType === 'empty' && (
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
                {['empty', 'snapshot', 'clone', 'dataVolume', 'ephemeral'].includes(
                  diskFormData.sourceType
                ) && (
                  <>
                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Storage Class *
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
                          <TextField {...params} placeholder="Select storage class..." required />
                        )}
                      />
                    </Grid>

                    <Grid item xs={6}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Access Mode
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
                        Volume Mode
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
                        label="Thick Provisioning (Preallocation)"
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
            label="Enable Live Migration on eviction"
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
                <FormLabel component="legend">Start VM after creation</FormLabel>
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

          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Virtual Hardware
          </Typography>

          {/* Firmware/BIOS */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
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

          {/* CPU Model */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
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

          {/* Machine Type */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
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
                <Checkbox checked={enableAcpi} onChange={e => handleAcpiChange(e.target.checked)} />
              }
              label="Enable ACPI"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
              Advanced Configuration and Power Interface - allows guest OS to communicate with
              virtual hardware for power management (shutdown/reboot/suspend)
            </Typography>
          </Box>

          {/* Timezone */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
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

          <Divider sx={{ my: 3 }} />

          <Typography variant="subtitle2" sx={{ mb: 2 }}>
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
                label="Cloud-Init (CloudInitNoCloud)"
              />
              <FormControlLabel
                value="ignition"
                control={<Radio />}
                label="Ignition (CloudInitConfigDrive)"
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
                    renderInput={params => <TextField {...params} placeholder="Select secret..." />}
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
                      setCloudInitNetworkDataType(e.target.value as 'inline' | 'base64' | 'secret')
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
                    renderInput={params => <TextField {...params} placeholder="Select secret..." />}
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
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
