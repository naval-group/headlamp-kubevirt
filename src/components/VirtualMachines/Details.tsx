import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  Resource,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useVMActions from '../../hooks/useVMActions';
import ConfirmDialog from '../common/ConfirmDialog';
import CopyCodeBlock from '../common/CopyCodeBlock';
import { SimpleStyledTooltip, TitledTooltip } from '../common/StyledTooltip';
import VMConsole from '../VMConsole/VMConsole';
import VMDoctorDialog from '../VMDoctor/VMDoctorDialog';
import VirtualMachine from './VirtualMachine';

/** Runtime interface info from VMI status (not the spec-level VMInterface) */
interface VMIStatusInterface {
  name?: string;
  interfaceName?: string;
  mac?: string;
  ipAddress?: string;
  ipAddresses?: string[];
  linkState?: string;
  queueCount?: number;
}

/** Runtime volume status from VMI status */
interface VMIVolumeStatus {
  name: string;
  target?: string;
  size?: number;
  persistentVolumeClaimInfo?: {
    claimName: string;
    capacity?: { storage?: string };
    accessModes?: string[];
  };
}
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../../utils/featureGates';
import DataVolume from '../BootableVolumes/DataVolume';
import CreateResourceDialog from '../common/CreateResourceDialog';
import VirtualMachineExport from '../VirtualMachineExport/VirtualMachineExport';
import VirtualMachineSnapshot from '../VirtualMachineSnapshot/VirtualMachineSnapshot';
import FloatingNav from './FloatingNav';
import VMMetrics from './Metrics';
import VMFormWrapper from './VMFormWrapper';

export interface VirtualMachineDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

export default function VirtualMachineDetails(props: VirtualMachineDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const [showConsole, setShowConsole] = useState(false);
  const [consoleTab, setConsoleTab] = useState<'vnc' | 'terminal'>('vnc');
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDoctor, setShowDoctor] = useState(false);
  const [vmItem] = VirtualMachine.useGet(name, namespace);
  const { actions: vmActions } = useVMActions(vmItem);

  const [podName, setPodName] = useState<string | null>(null);
  const [vmiData, setVmiData] = useState<any>(null);

  const [snapshotEnabled, setSnapshotEnabled] = useState(isFeatureGateEnabled('Snapshot'));
  const [vmExportEnabled, setVmExportEnabled] = useState(isFeatureGateEnabled('VMExport'));
  const [liveMigrationEnabled, setLiveMigrationEnabled] = useState(
    isFeatureGateEnabled('LiveMigration')
  );
  useEffect(() => {
    const update = () => {
      setSnapshotEnabled(isFeatureGateEnabled('Snapshot'));
      setVmExportEnabled(isFeatureGateEnabled('VMExport'));
      setLiveMigrationEnabled(isFeatureGateEnabled('LiveMigration'));
    };
    update();
    return subscribeToFeatureGates(update);
  }, []);

  useEffect(() => {
    const fetchPodName = async () => {
      try {
        const podName = await getPodName(name, namespace);
        setPodName(podName);
      } catch (error) {
        console.error('Failed to get pod name', error);
      }
    };

    fetchPodName();
  }, [name, namespace]);

  useEffect(() => {
    const fetchVMI = async () => {
      try {
        const response = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`,
          { method: 'GET' }
        );
        setVmiData(response);
      } catch (error) {
        // VMI not found — VM may be stopped
        setVmiData(null);
      }
    };

    fetchVMI();
    // Refresh VMI data every 10 seconds
    const interval = setInterval(fetchVMI, 10000);
    return () => clearInterval(interval);
  }, [name, namespace]);

  // Fetch DataVolumes owned by this VM for provisioning status
  const [dvItems] = DataVolume.useList({ namespace });
  const vmDvtNames = (vmItem?.jsonData?.spec?.dataVolumeTemplates || []).map(
    (dvt: { metadata?: { name?: string } }) => dvt.metadata?.name
  );
  const vmDataVolumes = dvItems?.filter(dv => vmDvtNames.includes(dv.getName())) || [];
  const hasProvisioningDvs = vmDataVolumes.some(
    dv => dv.status?.phase && dv.status.phase !== 'Succeeded'
  );

  // Fetch CDI importer/cloner pods related to this VM's DataVolumes
  interface K8sPod {
    metadata: {
      name: string;
      labels?: Record<string, string>;
      ownerReferences?: { name: string }[];
    };
    status?: { phase?: string; containerStatuses?: { ready: boolean }[] };
  }
  const [cdiPods, setCdiPods] = useState<K8sPod[]>([]);
  useEffect(() => {
    if (!vmDvtNames.length || !namespace) return;
    const fetchCdiPods = async () => {
      try {
        const response = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/pods?labelSelector=app=containerized-data-importer`
        );
        const allPods: K8sPod[] = (response as { items?: K8sPod[] })?.items || [];
        // Filter pods whose owner or name matches our DV names
        const relatedPods = allPods.filter(pod => {
          const podName = pod.metadata?.name || '';
          return vmDvtNames.some(
            (dvName: string) =>
              podName.includes(dvName) ||
              // CDI pods are named like "importer-<dv-name>-<hash>"
              podName.startsWith(`importer-${dvName}`) ||
              podName.startsWith(`cdi-upload-${dvName}`) ||
              podName.startsWith(`cdi-clone-${dvName}`)
          );
        });
        setCdiPods(relatedPods);
      } catch {
        setCdiPods([]);
      }
    };
    fetchCdiPods();
    const interval = setInterval(fetchCdiPods, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, vmDvtNames.join(',')]);

  const navSections = [
    { id: 'info', label: 'Info', icon: 'mdi:information' },
    ...(vmDataVolumes.length > 0
      ? [{ id: 'provisioning', label: 'Provisioning', icon: 'mdi:progress-download' }]
      : []),
    { id: 'conditions', label: 'Conditions', icon: 'mdi:alert-circle-outline' },
    { id: 'networks', label: 'Networks', icon: 'mdi:lan' },
    { id: 'disks', label: 'Disks', icon: 'mdi:harddisk' },
    ...(snapshotEnabled ? [{ id: 'snapshots', label: 'Snapshots', icon: 'mdi:camera' }] : []),
    ...(vmExportEnabled ? [{ id: 'exports', label: 'Exports', icon: 'mdi:export' }] : []),
    { id: 'metrics', label: 'Metrics', icon: 'mdi:chart-line' },
    { id: 'doctor', label: 'VM Doctor', icon: 'mdi:stethoscope' },
    { id: 'terminal', label: 'Terminal', icon: 'mdi:console' },
    { id: 'vnc', label: 'VNC', icon: 'mdi:monitor' },
  ];

  return (
    <>
      <FloatingNav
        sections={navSections}
        onDoctorClick={() => setShowDoctor(true)}
        onTerminalClick={() => {
          setConsoleTab('terminal');
          setShowConsole(true);
        }}
        onVNCClick={() => {
          setConsoleTab('vnc');
          setShowConsole(true);
        }}
      />
      <Resource.DetailsGrid
        name={name}
        namespace={namespace}
        resourceType={VirtualMachine}
        extraInfo={item =>
          item && [
            {
              name: t('Status'),
              value: (
                <Box display="flex" alignItems="center" gap={1}>
                  {item?.jsonData.status.printableStatus}
                  {liveMigrationEnabled &&
                    item?.jsonData.status.conditions?.map(condition => {
                      if (condition.type === 'LiveMigratable' && condition.status === 'False') {
                        return (
                          <Chip
                            key="notmigratable"
                            label="Not Migratable"
                            size="small"
                            color="warning"
                            variant="outlined"
                            icon={<Icon icon="mdi:alert" width={14} />}
                            title={condition.message || 'Cannot be live migrated'}
                          />
                        );
                      }
                      return null;
                    })}
                  {item.isDeleteProtected() && (
                    <SimpleStyledTooltip title="Delete protection enabled — cannot be deleted until protection is removed">
                      <Chip
                        key="protected"
                        label="Protected"
                        size="small"
                        color="info"
                        icon={<Icon icon="mdi:lock" width={14} />}
                      />
                    </SimpleStyledTooltip>
                  )}
                </Box>
              ),
            },
            ...(vmiData
              ? [
                  {
                    name: 'CPU',
                    value: vmiData.status?.currentCPUTopology
                      ? (() => {
                          const topo = vmiData.status.currentCPUTopology;
                          const total =
                            (topo.sockets || 1) * (topo.cores || 1) * (topo.threads || 1);
                          return (
                            <TitledTooltip
                              title="CPU Topology"
                              rows={[
                                { label: 'Sockets', value: topo.sockets },
                                { label: 'Cores', value: topo.cores },
                                { label: 'Threads', value: topo.threads },
                              ]}
                            >
                              <span style={{ cursor: 'help' }}>{total} cores</span>
                            </TitledTooltip>
                          );
                        })()
                      : item?.spec?.template?.spec?.domain?.cpu
                      ? (() => {
                          const cpu = item.spec.template.spec.domain.cpu;
                          const total = (cpu.sockets || 1) * (cpu.cores || 1) * (cpu.threads || 1);
                          return `${total} cores`;
                        })()
                      : 'N/A',
                  },
                  {
                    name: 'Memory',
                    value: vmiData.status?.memory
                      ? `${
                          vmiData.status.memory.guestCurrent ||
                          vmiData.status.memory.guestRequested ||
                          'N/A'
                        }`
                      : item?.spec?.template?.spec?.domain?.memory?.guest || 'N/A',
                  },
                  {
                    name: 'Node',
                    value: vmiData.status?.nodeName ? (
                      <Link routeName="node" params={{ name: vmiData.status.nodeName }} tooltip>
                        {vmiData.status.nodeName}
                      </Link>
                    ) : (
                      'N/A'
                    ),
                  },
                  {
                    name: 'Guest OS',
                    value: vmiData.status?.guestOSInfo?.prettyName || (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          Unknown
                        </Typography>
                        <SimpleStyledTooltip title="Install QEMU Guest Agent in the VM to report OS info">
                          <Icon
                            icon="mdi:information-outline"
                            width={16}
                            style={{ cursor: 'help', opacity: 0.6 }}
                          />
                        </SimpleStyledTooltip>
                      </Box>
                    ),
                  },
                  {
                    name: 'Kernel',
                    value: vmiData.status?.guestOSInfo?.kernelRelease || (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          Unknown
                        </Typography>
                        <SimpleStyledTooltip title="Install QEMU Guest Agent in the VM to report kernel info">
                          <Icon
                            icon="mdi:information-outline"
                            width={16}
                            style={{ cursor: 'help', opacity: 0.6 }}
                          />
                        </SimpleStyledTooltip>
                      </Box>
                    ),
                  },
                ]
              : []),
            {
              name: 'VirtualMachineInstance',
              value: (
                <Link
                  routeName="virtualmachineinstance"
                  params={{
                    name: item.getName(),
                    namespace: item.getNamespace(),
                  }}
                >
                  {item.getName()}
                </Link>
              ),
            },
            {
              name: 'Pod',
              value: podName ? (
                <Link
                  routeName="pod"
                  params={{
                    name: podName,
                    namespace: item.getNamespace(),
                  }}
                >
                  {podName}
                </Link>
              ) : (
                'N/A'
              ),
            },
          ]
        }
        extraSections={item =>
          item && [
            ...(vmDataVolumes.length > 0
              ? [
                  {
                    id: 'provisioning',
                    section: (
                      <Box id="section-provisioning">
                        <SectionBox
                          title="Provisioning Status"
                          headerProps={{
                            actions: hasProvisioningDvs
                              ? [
                                  <Chip
                                    key="status"
                                    label="In Progress"
                                    color="info"
                                    size="small"
                                    icon={<Icon icon="mdi:progress-clock" />}
                                  />,
                                ]
                              : [],
                          }}
                        >
                          <SimpleTable
                            data={vmDataVolumes}
                            columns={[
                              {
                                label: 'DataVolume',
                                getter: (dv: InstanceType<typeof DataVolume>) => (
                                  <Link
                                    routeName="datavolume"
                                    params={{
                                      name: dv.getName(),
                                      namespace: dv.getNamespace(),
                                    }}
                                  >
                                    {dv.getName()}
                                  </Link>
                                ),
                              },
                              {
                                label: 'Source',
                                getter: (dv: InstanceType<typeof DataVolume>) => dv.getSourceType(),
                              },
                              {
                                label: 'Size',
                                getter: (dv: InstanceType<typeof DataVolume>) => dv.getSize(),
                              },
                              {
                                label: 'Phase',
                                getter: (dv: InstanceType<typeof DataVolume>) => {
                                  const phase = dv.status?.phase || 'Pending';
                                  const color =
                                    phase === 'Succeeded'
                                      ? 'success'
                                      : phase === 'Failed'
                                      ? 'error'
                                      : phase === 'Paused'
                                      ? 'warning'
                                      : 'info';
                                  return (
                                    <Chip
                                      label={phase}
                                      color={color as 'success' | 'error' | 'warning' | 'info'}
                                      size="small"
                                    />
                                  );
                                },
                              },
                              {
                                label: 'Progress',
                                getter: (dv: InstanceType<typeof DataVolume>) => {
                                  const progress = dv.status?.progress;
                                  const phase = dv.status?.phase || '';
                                  if (phase === 'Succeeded') return '100%';
                                  if (!progress) return '-';
                                  return (
                                    <Box display="flex" alignItems="center" gap={1} minWidth={120}>
                                      <Box
                                        sx={{
                                          flex: 1,
                                          height: 8,
                                          bgcolor: 'action.hover',
                                          borderRadius: 4,
                                          overflow: 'hidden',
                                        }}
                                      >
                                        <Box
                                          sx={{
                                            width: progress,
                                            height: '100%',
                                            bgcolor: 'primary.main',
                                            borderRadius: 4,
                                            transition: 'width 0.5s ease',
                                          }}
                                        />
                                      </Box>
                                      <Typography variant="caption">{progress}</Typography>
                                    </Box>
                                  );
                                },
                              },
                              {
                                label: 'Storage Class',
                                getter: (dv: InstanceType<typeof DataVolume>) =>
                                  dv.getStorageClass(),
                              },
                            ]}
                          />
                          {cdiPods.length > 0 && (
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                CDI Worker Pods
                              </Typography>
                              <SimpleTable
                                data={cdiPods}
                                columns={[
                                  {
                                    label: 'Pod',
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    getter: (pod: any) => (
                                      <Link
                                        routeName="pod"
                                        params={{
                                          name: pod.metadata?.name,
                                          namespace: pod.metadata?.namespace,
                                        }}
                                      >
                                        {pod.metadata?.name}
                                      </Link>
                                    ),
                                  },
                                  {
                                    label: 'Phase',
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    getter: (pod: any) => {
                                      const phase = pod.status?.phase || 'Unknown';
                                      const color =
                                        phase === 'Running'
                                          ? 'primary'
                                          : phase === 'Succeeded'
                                          ? 'success'
                                          : phase === 'Failed'
                                          ? 'error'
                                          : 'default';
                                      return (
                                        <Chip
                                          label={phase}
                                          color={
                                            color as 'primary' | 'success' | 'error' | 'default'
                                          }
                                          size="small"
                                          variant="outlined"
                                        />
                                      );
                                    },
                                  },
                                  {
                                    label: 'Node',
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    getter: (pod: any) => pod.spec?.nodeName || 'Pending',
                                  },
                                  {
                                    label: 'Age',
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    getter: (pod: any) => {
                                      const created = pod.metadata?.creationTimestamp;
                                      if (!created) return '-';
                                      const diff = Date.now() - new Date(created).getTime();
                                      const mins = Math.floor(diff / 60000);
                                      if (mins < 1) return '<1m';
                                      if (mins < 60) return `${mins}m`;
                                      const hours = Math.floor(mins / 60);
                                      if (hours < 24) return `${hours}h${mins % 60}m`;
                                      return `${Math.floor(hours / 24)}d${hours % 24}h`;
                                    },
                                  },
                                ]}
                              />
                            </Box>
                          )}
                          {vmDataVolumes.some(
                            dv =>
                              dv.spec?.source?.upload &&
                              (dv.status?.phase === 'UploadReady' ||
                                dv.status?.phase === 'UploadScheduled')
                          ) && (
                            <Alert severity="info" icon={<Icon icon="mdi:upload" />} sx={{ mt: 2 }}>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                <strong>Ready for Upload:</strong> A DataVolume is waiting for a
                                disk image upload.
                              </Typography>
                              <CopyCodeBlock
                                title="Step 1 — Port-forward the CDI upload proxy"
                                code={`kubectl port-forward -n cdi svc/cdi-uploadproxy 3443:443 &\nPF_PID=$!`}
                              />
                              <CopyCodeBlock
                                title="Step 2 — Upload a local disk image"
                                code={`virtctl image-upload dv ${
                                  vmDataVolumes
                                    .find(
                                      dv =>
                                        dv.spec?.source?.upload &&
                                        (dv.status?.phase === 'UploadReady' ||
                                          dv.status?.phase === 'UploadScheduled')
                                    )
                                    ?.getName() || `${name}-boot-volume`
                                } \\\n  --namespace ${namespace} \\\n  --no-create \\\n  --uploadproxy-url=https://localhost:3443 \\\n  --insecure \\\n  --image-path=/path/to/disk.qcow2`}
                              />
                              <CopyCodeBlock
                                title="Step 3 — Start the VM and stop the port-forward"
                                code={`virtctl start ${name} -n ${namespace}\nkill $PF_PID`}
                              />
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ mt: 1, display: 'block' }}
                              >
                                Supported formats: qcow2, raw, ISO, vmdk (auto-detected). The{' '}
                                <code>--insecure</code> flag is needed because the port-forward uses
                                a self-signed certificate.
                              </Typography>
                            </Alert>
                          )}
                          {vmDataVolumes.some(
                            dv => dv.spec?.source?.upload && dv.status?.phase === 'Succeeded'
                          ) &&
                            item?.status?.printableStatus === 'Stopped' && (
                              <Alert
                                severity="success"
                                icon={<Icon icon="mdi:check-circle" />}
                                sx={{ mt: 2 }}
                              >
                                <Typography variant="body2" sx={{ mb: 1 }}>
                                  <strong>Upload complete!</strong> The disk image has been
                                  successfully uploaded. You can now start the VM.
                                </Typography>
                                <CopyCodeBlock
                                  title="Start the VM and stop the port-forward"
                                  code={`virtctl start ${name} -n ${namespace}\nkill $PF_PID`}
                                />
                              </Alert>
                            )}
                        </SectionBox>
                      </Box>
                    ),
                  },
                ]
              : []),
            {
              id: 'conditions',
              section: (
                <Box id="section-conditions">
                  <Resource.ConditionsSection resource={item?.jsonData} />
                </Box>
              ),
            },
            {
              id: 'networks',
              section: (
                <Box id="section-networks">
                  {vmiData?.status?.interfaces && vmiData.status.interfaces.length > 0 ? (
                    <SectionBox title="Network Interfaces">
                      <SimpleTable
                        data={vmiData.status.interfaces}
                        columns={[
                          {
                            label: 'Name',
                            getter: (iface: VMIStatusInterface) => {
                              const displayName = iface.name || iface.interfaceName || 'N/A';
                              const tooltipRows = [
                                iface.interfaceName
                                  ? { label: 'Interface', value: iface.interfaceName }
                                  : null,
                                { label: 'State', value: iface.linkState || 'N/A' },
                                iface.queueCount
                                  ? { label: 'Queues', value: String(iface.queueCount) }
                                  : null,
                              ].filter(Boolean) as { label: string; value: string }[];

                              return (
                                <TitledTooltip title="Network Interface" rows={tooltipRows}>
                                  <span style={{ cursor: 'help' }}>{displayName}</span>
                                </TitledTooltip>
                              );
                            },
                          },
                          {
                            label: 'MAC',
                            getter: (iface: VMIStatusInterface) => iface.mac || 'N/A',
                          },
                          {
                            label: 'IPs',
                            getter: (iface: VMIStatusInterface) => {
                              const ips =
                                iface.ipAddresses && iface.ipAddresses.length > 0
                                  ? iface.ipAddresses.join(', ')
                                  : iface.ipAddress || 'N/A';
                              return (
                                <TitledTooltip
                                  title="IP Addresses"
                                  rows={ips
                                    .split(', ')
                                    .map((ip: string) => ({ label: '', value: ip }))}
                                >
                                  <span style={{ cursor: 'help' }}>{ips}</span>
                                </TitledTooltip>
                              );
                            },
                          },
                        ]}
                      />
                    </SectionBox>
                  ) : (
                    <SectionBox title="Network Interfaces">
                      <Typography variant="body2" color="text.secondary">
                        No network interfaces available (VM may be stopped)
                      </Typography>
                    </SectionBox>
                  )}
                </Box>
              ),
            },
            {
              id: 'disks',
              section: (
                <Box id="section-disks">
                  {vmiData?.status?.volumeStatus && vmiData.status.volumeStatus.length > 0 ? (
                    <SectionBox title="Disks & Volumes">
                      <SimpleTable
                        data={vmiData.status.volumeStatus}
                        columns={[
                          {
                            label: 'Name',
                            getter: (volume: VMIVolumeStatus) => volume.name,
                          },
                          {
                            label: 'Target',
                            getter: (volume: VMIVolumeStatus) => volume.target || 'N/A',
                          },
                          {
                            label: 'Capacity',
                            getter: (volume: VMIVolumeStatus) => {
                              const pvcInfo = volume.persistentVolumeClaimInfo;
                              return volume.size
                                ? `${(volume.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                                : pvcInfo?.capacity?.storage || 'N/A';
                            },
                          },
                          {
                            label: 'PVC (Access Mode)',
                            getter: (volume: VMIVolumeStatus) => {
                              const pvcInfo = volume.persistentVolumeClaimInfo;
                              if (!pvcInfo) return 'N/A';

                              const accessMode = pvcInfo.accessModes
                                ? pvcInfo.accessModes.includes('ReadWriteMany')
                                  ? 'RWX'
                                  : pvcInfo.accessModes.includes('ReadWriteOnce')
                                  ? 'RWO'
                                  : pvcInfo.accessModes.includes('ReadOnlyMany')
                                  ? 'ROX'
                                  : pvcInfo.accessModes.join(',')
                                : 'N/A';

                              return (
                                <SimpleStyledTooltip title={pvcInfo.claimName}>
                                  <span style={{ cursor: 'help' }}>
                                    {pvcInfo.claimName} ({accessMode})
                                  </span>
                                </SimpleStyledTooltip>
                              );
                            },
                          },
                        ]}
                      />
                    </SectionBox>
                  ) : (
                    <SectionBox title="Disks & Volumes">
                      <Typography variant="body2" color="text.secondary">
                        No disks available (VM may be stopped)
                      </Typography>
                    </SectionBox>
                  )}
                </Box>
              ),
            },
            ...(snapshotEnabled
              ? [
                  {
                    id: 'snapshots',
                    section: (
                      <Box id="section-snapshots">
                        <SectionBox title="Snapshots">
                          <SnapshotsList vmName={name || ''} namespace={namespace || ''} />
                        </SectionBox>
                      </Box>
                    ),
                  },
                ]
              : []),
            ...(vmExportEnabled
              ? [
                  {
                    id: 'exports',
                    section: (
                      <Box id="section-exports">
                        <SectionBox title="Exports">
                          <ExportsList vmName={name || ''} namespace={namespace || ''} />
                        </SectionBox>
                      </Box>
                    ),
                  },
                ]
              : []),
            {
              id: 'metrics',
              section: (
                <Box id="section-metrics">
                  <SectionBox title="Metrics">
                    <VMMetrics
                      vmName={name || ''}
                      namespace={namespace || ''}
                      vmiData={vmiData}
                      vmItem={item}
                    />
                  </SectionBox>
                </Box>
              ),
            },
            {
              id: 'headlamp.vm-console',
              section: (
                <VMConsole
                  open={showConsole}
                  key="console"
                  item={item}
                  vm={vmItem}
                  initialTab={consoleTab}
                  onClose={() => {
                    setShowConsole(false);
                  }}
                />
              ),
            },
          ]
        }
        actions={item =>
          item && [
            ...vmActions
              .filter(a => a.id !== 'migrate' || liveMigrationEnabled)
              .map(a => ({
                id: a.id,
                action: (
                  <ActionButton
                    description={t(a.label)}
                    icon={a.icon}
                    onClick={a.handler}
                    iconButtonProps={{ disabled: a.disabled }}
                  ></ActionButton>
                ),
              })),
            {
              id: 'edit-wizard',
              action: (
                <ActionButton
                  description={t('Edit with Wizard')}
                  icon="mdi:auto-fix"
                  onClick={() => setShowEditDialog(true)}
                ></ActionButton>
              ),
            },
            ...(snapshotEnabled
              ? [
                  {
                    id: 'snapshot',
                    action: (
                      <ActionButton
                        description={t('Take Snapshot')}
                        icon="mdi:camera"
                        onClick={() => setShowSnapshotDialog(true)}
                      ></ActionButton>
                    ),
                  },
                ]
              : []),
            {
              id: 'doctor',
              action: (
                <ActionButton
                  description="VM Doctor"
                  aria-label="vm doctor"
                  icon="mdi:stethoscope"
                  onClick={() => setShowDoctor(true)}
                />
              ),
            },
            {
              id: 'console',
              action: (
                <Resource.AuthVisible item={item} authVerb="get" subresource="exec">
                  <ActionButton
                    description={t('Terminal / Exec')}
                    aria-label={t('terminal')}
                    icon="mdi:console"
                    onClick={() => {
                      setConsoleTab('terminal');
                      setShowConsole(true);
                    }}
                  />
                </Resource.AuthVisible>
              ),
            },
            {
              id: 'vnc',
              action: (
                <Resource.AuthVisible item={item} authVerb="get" subresource="vnc">
                  <ActionButton
                    description={t('VNC Console')}
                    aria-label={t('vnc')}
                    icon="mdi:monitor"
                    onClick={() => {
                      setConsoleTab('vnc');
                      setShowConsole(true);
                    }}
                  />
                </Resource.AuthVisible>
              ),
            },
          ]
        }
      />
      <CreateSnapshotDialog
        open={showSnapshotDialog}
        onClose={() => setShowSnapshotDialog(false)}
        vmName={name || ''}
        namespace={namespace || ''}
      />
      {vmItem && (
        <CreateResourceDialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          title="Edit Virtual Machine"
          resourceClass={VirtualMachine}
          initialResource={vmItem.jsonData}
          editMode
          formComponent={VMFormWrapper}
          validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
        />
      )}
      <VMDoctorDialog
        open={showDoctor}
        onClose={() => setShowDoctor(false)}
        vmName={name || ''}
        namespace={namespace || ''}
        vmiData={vmiData}
        vmItem={vmItem}
        podName={podName || ''}
      />
    </>
  );
}

async function getPodName(name: string, namespace: string): Promise<string> {
  const request = ApiProxy.request;
  const queryParams = new URLSearchParams();
  let response;
  queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
  try {
    response = await request(`/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`, {
      method: 'GET',
    });
  } catch (error) {
    return 'Unknown';
  }
  return response?.items[0]?.metadata?.name || 'Unknown';
}

interface SnapshotsListProps {
  vmName: string;
  namespace: string;
}

function SnapshotsList({ vmName, namespace }: SnapshotsListProps) {
  const [vmExportEnabled, setVmExportEnabled] = useState(isFeatureGateEnabled('VMExport'));
  useEffect(() => {
    setVmExportEnabled(isFeatureGateEnabled('VMExport'));
    return subscribeToFeatureGates(() => setVmExportEnabled(isFeatureGateEnabled('VMExport')));
  }, []);
  const { items: snapshots } = VirtualMachineSnapshot.useList({ namespace });
  const { enqueueSnackbar } = useSnackbar();
  const [currentPage, setCurrentPage] = useState(0);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<VirtualMachineSnapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VirtualMachineSnapshot | null>(null);
  const itemsPerPage = 10;

  // Filter snapshots for this VM and sort by creation time (newest first)
  const vmSnapshots = (
    snapshots?.filter((snapshot: VirtualMachineSnapshot) => snapshot.getSourceName() === vmName) ||
    []
  ).sort((a, b) => {
    const timeA = new Date(a.getCreationTime() || 0).getTime();
    const timeB = new Date(b.getCreationTime() || 0).getTime();
    return timeB - timeA;
  });

  const totalPages = Math.ceil(vmSnapshots.length / itemsPerPage);
  const paginatedSnapshots = vmSnapshots.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.getName();
    setDeleteTarget(null);
    try {
      await deleteTarget.delete();
      enqueueSnackbar(`Snapshot ${name} deleted`, { variant: 'success' });
    } catch (e) {
      console.error('Failed to delete snapshot:', e);
      enqueueSnackbar('Failed to delete snapshot.', { variant: 'error' });
    }
  };

  if (vmSnapshots.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No snapshots available for this VM
      </Typography>
    );
  }

  return (
    <Box>
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (snapshot: VirtualMachineSnapshot) => snapshot.getName(),
          },
          {
            label: 'Status',
            getter: (snapshot: VirtualMachineSnapshot) => {
              const phase = snapshot.getPhase();
              const isReady = snapshot.isReadyToUse();
              let color: 'success' | 'info' | 'error' | 'default' = 'default';
              if (phase === 'Succeeded' && isReady) color = 'success';
              else if (phase === 'InProgress') color = 'info';
              else if (phase === 'Failed') color = 'error';
              return <Chip label={phase} size="small" color={color} />;
            },
          },
          {
            label: 'Created',
            getter: (snapshot: VirtualMachineSnapshot) => {
              const time = snapshot.getCreationTime();
              if (!time) return '-';
              return new Date(time).toLocaleString();
            },
          },
          {
            label: '',
            getter: (snapshot: VirtualMachineSnapshot) => (
              <Box display="flex" gap={0.5}>
                {vmExportEnabled && snapshot.isReadyToUse() && (
                  <SimpleStyledTooltip title="Export snapshot">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => {
                        setSelectedSnapshot(snapshot);
                        setExportDialogOpen(true);
                      }}
                    >
                      <Icon icon="mdi:export" width={18} />
                    </IconButton>
                  </SimpleStyledTooltip>
                )}
                <SimpleStyledTooltip title="Delete snapshot">
                  <IconButton size="small" color="error" onClick={() => setDeleteTarget(snapshot)}>
                    <Icon icon="mdi:delete" width={18} />
                  </IconButton>
                </SimpleStyledTooltip>
              </Box>
            ),
          },
        ]}
        data={paginatedSnapshots}
      />
      {totalPages > 1 && (
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
          <Typography variant="body2" color="text.secondary">
            Showing {currentPage * itemsPerPage + 1}-
            {Math.min((currentPage + 1) * itemsPerPage, vmSnapshots.length)} of {vmSnapshots.length}
          </Typography>
          <Box display="flex" gap={1}>
            <IconButton
              size="small"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage(prev => prev - 1)}
            >
              <Icon icon="mdi:chevron-left" />
            </IconButton>
            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
              {currentPage + 1} / {totalPages}
            </Typography>
            <IconButton
              size="small"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setCurrentPage(prev => prev + 1)}
            >
              <Icon icon="mdi:chevron-right" />
            </IconButton>
          </Box>
        </Box>
      )}
      {selectedSnapshot && (
        <CreateExportDialog
          open={exportDialogOpen}
          onClose={() => {
            setExportDialogOpen(false);
            setSelectedSnapshot(null);
          }}
          snapshotName={selectedSnapshot.getName()}
          namespace={namespace}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Snapshot"
        message={`Are you sure you want to delete snapshot "${deleteTarget?.getName()}"?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

// Export creation modal component
interface CreateExportDialogProps {
  open: boolean;
  onClose: () => void;
  snapshotName: string;
  namespace: string;
}

function CreateExportDialog({ open, onClose, snapshotName, namespace }: CreateExportDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [exportName, setExportName] = useState(`${snapshotName}-export`);
  const [ttlDuration, setTtlDuration] = useState('2h');
  const [creating, setCreating] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setExportName(`${snapshotName}-export`);
      setTtlDuration('2h');
    }
  }, [open, snapshotName]);

  const handleCreate = async () => {
    if (!exportName.trim()) {
      enqueueSnackbar('Export name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    const vmExport: {
      apiVersion: string;
      kind: string;
      metadata: { name: string; namespace: string };
      spec: { source: { apiGroup: string; kind: string; name: string }; ttlDuration?: string };
    } = {
      apiVersion: 'export.kubevirt.io/v1beta1',
      kind: 'VirtualMachineExport',
      metadata: {
        name: exportName.trim(),
        namespace: namespace,
      },
      spec: {
        source: {
          apiGroup: 'snapshot.kubevirt.io',
          kind: 'VirtualMachineSnapshot',
          name: snapshotName,
        },
      },
    };

    if (ttlDuration) {
      vmExport.spec.ttlDuration = ttlDuration;
    }

    try {
      await ApiProxy.request(
        `/apis/export.kubevirt.io/v1beta1/namespaces/${namespace}/virtualmachineexports`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vmExport),
        }
      );
      enqueueSnackbar(`Export ${exportName} created`, { variant: 'success' });
      onClose();
    } catch (e) {
      console.error('export failed', e);
      enqueueSnackbar('Failed to create export.', { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export Snapshot</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            Create an export from snapshot: <strong>{snapshotName}</strong>
          </Typography>
          <TextField
            label="Export Name"
            value={exportName}
            onChange={e => setExportName(e.target.value)}
            fullWidth
            required
            helperText="Unique name for the export"
          />
          <TextField
            label="TTL Duration"
            value={ttlDuration}
            onChange={e => setTtlDuration(e.target.value)}
            fullWidth
            placeholder="e.g., 2h, 24h, 7d"
            helperText="How long the export should be available (e.g., 2h for 2 hours, 24h for 1 day)"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={creating || !exportName.trim()}
          startIcon={<Icon icon="mdi:export" />}
        >
          {creating ? 'Creating...' : 'Create Export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Snapshot creation modal component
interface CreateSnapshotDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  namespace: string;
}

function CreateSnapshotDialog({ open, onClose, vmName, namespace }: CreateSnapshotDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [snapshotName, setSnapshotName] = useState(`${vmName}-snapshot-${Date.now()}`);
  const [deletionPolicy, setDeletionPolicy] = useState('default');
  const [failureDeadline, setFailureDeadline] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSnapshotName(`${vmName}-snapshot-${Date.now()}`);
      setDeletionPolicy('default');
      setFailureDeadline('');
    }
  }, [open, vmName]);

  const handleCreate = async () => {
    if (!snapshotName.trim()) {
      enqueueSnackbar('Snapshot name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    const snapshot: {
      apiVersion: string;
      kind: string;
      metadata: { name: string; namespace: string };
      spec: {
        source: { apiGroup: string; kind: string; name: string };
        deletionPolicy?: string;
        failureDeadline?: string;
      };
    } = {
      apiVersion: 'snapshot.kubevirt.io/v1beta1',
      kind: 'VirtualMachineSnapshot',
      metadata: {
        name: snapshotName.trim(),
        namespace: namespace,
      },
      spec: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: vmName,
        },
      },
    };

    if (deletionPolicy && deletionPolicy !== 'default') {
      snapshot.spec.deletionPolicy = deletionPolicy;
    }
    if (failureDeadline) {
      snapshot.spec.failureDeadline = failureDeadline;
    }

    try {
      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${namespace}/virtualmachinesnapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        }
      );
      enqueueSnackbar(`Snapshot ${snapshotName} created`, { variant: 'success' });
      onClose();
    } catch (e) {
      console.error('snapshot failed', e);
      enqueueSnackbar('Failed to create snapshot.', { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Take Snapshot</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label="Snapshot Name"
            value={snapshotName}
            onChange={e => setSnapshotName(e.target.value)}
            fullWidth
            required
            helperText="Unique name for the snapshot"
          />
          <FormControl fullWidth>
            <InputLabel>Deletion Policy</InputLabel>
            <Select
              value={deletionPolicy}
              label="Deletion Policy"
              onChange={e => setDeletionPolicy(e.target.value)}
            >
              <MenuItem value="default">Default</MenuItem>
              <MenuItem value="Delete">
                Delete - Remove snapshot content when snapshot is deleted
              </MenuItem>
              <MenuItem value="Retain">
                Retain - Keep snapshot content when snapshot is deleted
              </MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Failure Deadline"
            value={failureDeadline}
            onChange={e => setFailureDeadline(e.target.value)}
            fullWidth
            placeholder="e.g., 5m, 1h"
            helperText="Timeout for snapshot creation (e.g., 5m for 5 minutes)"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={creating || !snapshotName.trim()}
          startIcon={<Icon icon="mdi:camera" />}
        >
          {creating ? 'Creating...' : 'Create Snapshot'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Exports list component for VM Details
function ExportsList({ vmName, namespace }: { vmName: string; namespace: string }) {
  const { items: exports } = VirtualMachineExport.useList({ namespace });

  // Filter exports related to this VM (direct VM exports or snapshot exports with virtualMachineName)
  const vmExports = (
    exports?.filter(
      (exp: VirtualMachineExport) =>
        (exp.getSourceKind() === 'VirtualMachine' && exp.getSourceName() === vmName) ||
        exp.getVirtualMachineName() === vmName
    ) || []
  ).sort((a, b) => {
    const timeA = new Date(a.metadata?.creationTimestamp || 0).getTime();
    const timeB = new Date(b.metadata?.creationTimestamp || 0).getTime();
    return timeB - timeA;
  });

  if (vmExports.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No exports for this VM.
      </Typography>
    );
  }

  return (
    <SimpleTable
      columns={[
        {
          label: 'Name',
          getter: (exp: VirtualMachineExport) => (
            <Link
              routeName="export"
              params={{ name: exp.getName(), namespace: exp.getNamespace() }}
            >
              {exp.getName()}
            </Link>
          ),
        },
        {
          label: 'Source',
          getter: (exp: VirtualMachineExport) => `${exp.getSourceKind()} / ${exp.getSourceName()}`,
        },
        {
          label: 'Status',
          getter: (exp: VirtualMachineExport) => {
            const phase = exp.getPhase();
            const color =
              phase === 'Ready'
                ? 'success'
                : phase === 'Pending'
                ? 'warning'
                : phase === 'Terminated'
                ? 'error'
                : 'default';
            return <Chip label={phase} size="small" color={color} />;
          },
        },
        {
          label: 'TTL',
          getter: (exp: VirtualMachineExport) => exp.getTTLDuration() || '-',
        },
        {
          label: 'Created',
          getter: (exp: VirtualMachineExport) =>
            exp.metadata?.creationTimestamp
              ? new Date(exp.metadata.creationTimestamp).toLocaleString()
              : '-',
        },
      ]}
      data={vmExports}
    />
  );
}
