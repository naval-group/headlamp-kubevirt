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
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import VMConsole from '../VMConsole/VMConsole';
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
  const { enqueueSnackbar } = useSnackbar();
  const [showConsole, setShowConsole] = useState(false);
  const [consoleTab, setConsoleTab] = useState<'vnc' | 'terminal'>('vnc');
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [vmItem] = VirtualMachine.useGet(name, namespace);

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

  const navSections = [
    { id: 'info', label: 'Info', icon: 'mdi:information' },
    { id: 'conditions', label: 'Conditions', icon: 'mdi:alert-circle-outline' },
    { id: 'networks', label: 'Networks', icon: 'mdi:lan' },
    { id: 'disks', label: 'Disks', icon: 'mdi:harddisk' },
    ...(snapshotEnabled ? [{ id: 'snapshots', label: 'Snapshots', icon: 'mdi:camera' }] : []),
    ...(vmExportEnabled ? [{ id: 'exports', label: 'Exports', icon: 'mdi:export' }] : []),
    { id: 'metrics', label: 'Metrics', icon: 'mdi:chart-line' },
    { id: 'terminal', label: 'Terminal', icon: 'mdi:console' },
    { id: 'vnc', label: 'VNC', icon: 'mdi:monitor' },
  ];

  return (
    <>
      <FloatingNav
        sections={navSections}
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
                    <Tooltip
                      title={
                        <div style={{ fontSize: '0.875rem' }}>
                          Delete protection enabled - cannot be deleted until protection is removed
                        </div>
                      }
                    >
                      <Chip
                        key="protected"
                        label="Protected"
                        size="small"
                        color="info"
                        icon={<Icon icon="mdi:lock" width={14} />}
                      />
                    </Tooltip>
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
                            <Tooltip
                              title={
                                <div style={{ fontSize: '0.875rem' }}>
                                  <div>{topo.sockets} Socket(s)</div>
                                  <div>{topo.cores} Core(s)</div>
                                  <div>{topo.threads} Thread(s)</div>
                                </div>
                              }
                            >
                              <span style={{ cursor: 'help' }}>{total} cores</span>
                            </Tooltip>
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
                        <Tooltip title="Install QEMU Guest Agent in the VM to report OS info" arrow>
                          <Icon
                            icon="mdi:information-outline"
                            width={16}
                            style={{ cursor: 'help', opacity: 0.6 }}
                          />
                        </Tooltip>
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
                        <Tooltip
                          title="Install QEMU Guest Agent in the VM to report kernel info"
                          arrow
                        >
                          <Icon
                            icon="mdi:information-outline"
                            width={16}
                            style={{ cursor: 'help', opacity: 0.6 }}
                          />
                        </Tooltip>
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
                              const tooltipParts = [
                                iface.interfaceName ? `Interface: ${iface.interfaceName}` : null,
                                `State: ${iface.linkState || 'N/A'}`,
                                iface.queueCount ? `Queues: ${iface.queueCount}` : null,
                              ].filter(Boolean);

                              return (
                                <Tooltip
                                  title={
                                    <div style={{ fontSize: '0.875rem' }}>
                                      {tooltipParts.map((part, idx) => (
                                        <div key={idx}>{part}</div>
                                      ))}
                                    </div>
                                  }
                                >
                                  <span style={{ cursor: 'help' }}>{displayName}</span>
                                </Tooltip>
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
                                <Tooltip
                                  title={
                                    <div style={{ fontSize: '0.875rem' }}>
                                      {ips.split(', ').map((ip: string, idx: number) => (
                                        <div key={idx}>{ip}</div>
                                      ))}
                                    </div>
                                  }
                                >
                                  <span style={{ cursor: 'help' }}>{ips}</span>
                                </Tooltip>
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
                                <Tooltip
                                  title={
                                    <div style={{ fontSize: '0.875rem' }}>{pvcInfo.claimName}</div>
                                  }
                                >
                                  <span style={{ cursor: 'help' }}>
                                    {pvcInfo.claimName} ({accessMode})
                                  </span>
                                </Tooltip>
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
        actions={item => {
          const status = item?.status?.printableStatus || 'Unknown';
          return (
            item && [
              {
                id: 'start',
                action: (
                  <ActionButton
                    description={t('Start')}
                    icon="mdi:play"
                    onClick={async () => {
                      try {
                        await item.start();
                        enqueueSnackbar('Virtual Machine started', { variant: 'success' });
                      } catch (e) {
                        console.error('start failed', e);
                        enqueueSnackbar('Failed to start Virtual Machine: ' + e, {
                          variant: 'error',
                        });
                      }
                    }}
                    iconButtonProps={{ disabled: status !== 'Stopped' }}
                  ></ActionButton>
                ),
              },
              {
                id: 'stop',
                action: (
                  <ActionButton
                    description={t('Stop')}
                    icon="mdi:stop"
                    onClick={async () => {
                      try {
                        await item.stop();
                        enqueueSnackbar('Virtual Machine stopped', { variant: 'success' });
                      } catch (e) {
                        console.error('stop failed', e);
                        enqueueSnackbar('Failed to stop Virtual Machine: ' + e, {
                          variant: 'error',
                        });
                      }
                    }}
                    iconButtonProps={{ disabled: status === 'Stopped' || status === 'Stopping' }}
                  ></ActionButton>
                ),
              },
              {
                id: 'restart',
                action: (
                  <ActionButton
                    description={t('Restart')}
                    icon="mdi:restart"
                    onClick={async () => {
                      try {
                        await item.restart();
                        enqueueSnackbar('Virtual Machine restarting', { variant: 'success' });
                      } catch (e) {
                        console.error('restart failed', e);
                        enqueueSnackbar('Failed to restart Virtual Machine: ' + e, {
                          variant: 'error',
                        });
                      }
                    }}
                    iconButtonProps={{ disabled: status !== 'Running' }}
                  ></ActionButton>
                ),
              },
              {
                id: 'pause',
                action: (
                  <ActionButton
                    description={item.isPaused() ? t('Unpause') : t('Pause')}
                    icon={item.isPaused() ? 'mdi:play-pause' : 'mdi:pause'}
                    onClick={async () => {
                      try {
                        if (item.isPaused()) {
                          await item.unpause();
                          enqueueSnackbar('Virtual Machine unpaused', { variant: 'success' });
                        } else {
                          await item.pause();
                          enqueueSnackbar('Virtual Machine paused', { variant: 'success' });
                        }
                      } catch (e) {
                        console.error('pause/unpause failed', e);
                        enqueueSnackbar(
                          `Failed to ${
                            item.isPaused() ? 'unpause' : 'pause'
                          } Virtual Machine: ${e}`,
                          { variant: 'error' }
                        );
                      }
                    }}
                    iconButtonProps={{ disabled: status !== 'Running' }}
                  ></ActionButton>
                ),
              },
              {
                id: 'force-stop',
                action: (
                  <ActionButton
                    description={t('Force Stop')}
                    icon="mdi:stop-circle"
                    onClick={async () => {
                      try {
                        await item.forceStop();
                        enqueueSnackbar('Virtual Machine force stopped', { variant: 'success' });
                      } catch (e) {
                        console.error('force stop failed', e);
                        enqueueSnackbar('Failed to force stop Virtual Machine: ' + e, {
                          variant: 'error',
                        });
                      }
                    }}
                    iconButtonProps={{ disabled: status === 'Stopped' }}
                  ></ActionButton>
                ),
              },
              ...(liveMigrationEnabled
                ? [
                    {
                      id: 'migrate',
                      action: (
                        <ActionButton
                          description={t('Migrate')}
                          icon="mdi:arrow-decision"
                          onClick={async () => {
                            try {
                              await item.migrate();
                              enqueueSnackbar('Virtual Machine migration initiated', {
                                variant: 'success',
                              });
                            } catch (e) {
                              console.error('migration failed', e);
                              enqueueSnackbar(`Failed to migrate Virtual Machine: ${e}`, {
                                variant: 'error',
                              });
                            }
                          }}
                          iconButtonProps={{
                            disabled: status !== 'Running' || !item.isLiveMigratable(),
                          }}
                        ></ActionButton>
                      ),
                    },
                  ]
                : []),
              {
                id: 'protect',
                action: (
                  <ActionButton
                    description={item.isDeleteProtected() ? t('Unprotect') : t('Protect')}
                    icon={item.isDeleteProtected() ? 'mdi:lock-open' : 'mdi:lock'}
                    onClick={async () => {
                      const isProtected = item.isDeleteProtected();

                      try {
                        await item.setDeleteProtection(!isProtected);
                        enqueueSnackbar(
                          `Virtual Machine ${
                            isProtected ? 'unprotected' : 'protected'
                          } from deletion`,
                          { variant: 'success' }
                        );
                      } catch (e) {
                        console.error('protection toggle failed', e);
                        enqueueSnackbar(
                          `Failed to ${
                            isProtected ? 'unprotect' : 'protect'
                          } Virtual Machine: ${e}`,
                          { variant: 'error' }
                        );
                      }
                    }}
                  ></ActionButton>
                ),
              },
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
          );
        }}
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

  const handleDelete = async (snapshot: VirtualMachineSnapshot) => {
    if (!confirm(`Are you sure you want to delete snapshot "${snapshot.getName()}"?`)) {
      return;
    }
    try {
      await snapshot.delete();
      enqueueSnackbar(`Snapshot ${snapshot.getName()} deleted`, { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(`Failed to delete snapshot: ${e}`, { variant: 'error' });
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
                  <Tooltip title="Export snapshot">
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
                  </Tooltip>
                )}
                <Tooltip title="Delete snapshot">
                  <IconButton size="small" color="error" onClick={() => handleDelete(snapshot)}>
                    <Icon icon="mdi:delete" width={18} />
                  </IconButton>
                </Tooltip>
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
      enqueueSnackbar(`Failed to create export: ${e}`, { variant: 'error' });
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
      enqueueSnackbar(`Failed to create snapshot: ${e}`, { variant: 'error' });
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
