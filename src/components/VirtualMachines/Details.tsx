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
  CircularProgress,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useFeatureGate from '../../hooks/useFeatureGate';
import useVMActions from '../../hooks/useVMActions';
import { formatDuration } from '../../utils/formatDuration';
import { safeError } from '../../utils/sanitize';
import { shortAccessModes } from '../../utils/volumeDialog';
import DataVolume from '../BootableVolumes/DataVolume';
import ConfirmDialog from '../common/ConfirmDialog';
import CopyCodeBlock from '../common/CopyCodeBlock';
import CreateResourceDialog from '../common/CreateResourceDialog';
import { SimpleStyledTooltip, TitledTooltip } from '../common/StyledTooltip';
import VirtualMachineInstanceMigration from '../Migrations/VirtualMachineInstanceMigration';
import CreateExportDialog from '../VirtualMachineExport/CreateExportDialog';
import VirtualMachineExport from '../VirtualMachineExport/VirtualMachineExport';
import CreateSnapshotDialog from '../VirtualMachineSnapshot/CreateSnapshotDialog';
import RestoreDialog from '../VirtualMachineSnapshot/RestoreDialog';
import VirtualMachineSnapshot from '../VirtualMachineSnapshot/VirtualMachineSnapshot';
import VMConsole from '../VMConsole/VMConsole';
import VMDoctorDialog from '../VMDoctor/VMDoctorDialog';
import CloneDialog from './CloneDialog';
import CloneVolumeDialog from './CloneVolumeDialog';
import FloatingNav from './FloatingNav';
import VMMetrics from './Metrics';
import MigrateVolumeDialog from './MigrateVolumeDialog';
import ResolveVolumeMigrationDialog from './ResolveVolumeMigrationDialog';
import VirtualMachine from './VirtualMachine';
import VMFormWrapper from './VMFormWrapper';
import { getVMStatusConfig } from './VMStatusChip';

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

/** Subset of VirtualMachineInstance used in the details view */
interface VMIData {
  spec?: {
    domain?: {
      cpu?: { sockets?: number; cores?: number; threads?: number };
      resources?: { requests?: { memory?: string }; limits?: { memory?: string } };
    };
    volumes?: Array<{
      name: string;
      dataVolume?: { name: string };
      persistentVolumeClaim?: { claimName: string };
    }>;
  };
  status?: {
    phase?: string;
    nodeName?: string;
    currentCPUTopology?: {
      sockets?: number;
      cores?: number;
      threads?: number;
    };
    memory?: {
      guestCurrent?: string;
      guestRequested?: string;
    };
    guestOSInfo?: {
      prettyName?: string;
      kernelRelease?: string;
    };
    interfaces?: VMIStatusInterface[];
    volumeStatus?: VMIVolumeStatus[];
    migrationState?: {
      completed?: boolean;
      migrationUid?: string;
      mode?: string;
      startTimestamp?: string;
      endTimestamp?: string;
      sourceNode?: string;
      targetNode?: string;
    };
  };
}

/**
 * Compare VM spec (desired) vs running VMI (actual) and return
 * user-friendly labels for pending changes.
 */
function getPendingChanges(
  vm: InstanceType<typeof VirtualMachine> | null,
  vmi: VMIData | null
): string[] {
  if (!vm || !vmi?.spec) return [];
  const changes: string[] = [];

  // CPU
  const vmCpu = vm.spec?.template?.spec?.domain?.cpu;
  const vmiCpu = vmi.spec.domain?.cpu;
  if (vmCpu && vmiCpu) {
    if (
      vmCpu.cores !== vmiCpu.cores ||
      vmCpu.sockets !== vmiCpu.sockets ||
      vmCpu.threads !== vmiCpu.threads
    ) {
      const desired = (vmCpu.sockets || 1) * (vmCpu.cores || 1) * (vmCpu.threads || 1);
      const current = (vmiCpu.sockets || 1) * (vmiCpu.cores || 1) * (vmiCpu.threads || 1);
      changes.push(`CPU: ${current} → ${desired} vCPUs`);
    }
  }

  // Memory
  const vmMem =
    vm.spec?.template?.spec?.domain?.resources?.requests?.memory ||
    vm.spec?.template?.spec?.domain?.memory?.guest;
  const vmiMem =
    vmi.spec.domain?.resources?.requests?.memory || vmi.spec.domain?.resources?.limits?.memory;
  if (vmMem && vmiMem && vmMem !== vmiMem) {
    changes.push(`Memory: ${vmiMem} → ${vmMem}`);
  }

  // Volumes
  const vmVols = (vm.spec?.template?.spec?.volumes || []).map(
    (v: {
      name: string;
      dataVolume?: { name: string };
      persistentVolumeClaim?: { claimName: string };
    }) => v.dataVolume?.name || v.persistentVolumeClaim?.claimName || v.name
  );
  const vmiVols = (vmi.spec.volumes || []).map(
    v => v.dataVolume?.name || v.persistentVolumeClaim?.claimName || v.name
  );
  const added = vmVols.filter((v: string) => !vmiVols.includes(v));
  const removed = vmiVols.filter(v => !vmVols.includes(v));
  if (added.length || removed.length) {
    changes.push('Volumes');
  }

  return changes;
}

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
  const [showDoctor, setShowDoctor] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [migrateVolumeName, setMigrateVolumeName] = useState<string | undefined>(undefined);
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [vmItem] = VirtualMachine.useGet(name, namespace);
  const { actions: vmActions } = useVMActions(vmItem);

  const [podName, setPodName] = useState<string | null>(null);
  const [vmiData, setVmiData] = useState<VMIData | null>(null);
  const [podDeleteConfirm, setPodDeleteConfirm] = useState<'delete' | 'force' | null>(null);

  // Fetch migrations for this VM to find active migration
  const { items: allMigrations } = VirtualMachineInstanceMigration.useList({ namespace });
  const activeMigration = allMigrations?.find(
    (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
      const matches =
        m.metadata?.labels?.['kubevirt.io/vmi-name'] === name || m.getVMIName() === name;
      return matches && !m.isCompleted();
    }
  );

  const snapshotEnabled = useFeatureGate('Snapshot');
  const vmExportEnabled = useFeatureGate('VMExport');
  const liveMigrationEnabled = useFeatureGate('LiveMigration');
  const volumeMigrationEnabled = useFeatureGate('VolumeMigration');

  const handleDeletePod = async (force: boolean) => {
    setPodDeleteConfirm(null);
    if (!podName) return;
    try {
      const opts = force
        ? {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gracePeriodSeconds: 0 }),
            isJSON: false,
          }
        : { method: 'DELETE', isJSON: false };
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`, opts);
      enqueueSnackbar(`${force ? 'Force deleted' : 'Deleted'} pod ${podName}`, {
        variant: 'success',
      });
    } catch (e) {
      enqueueSnackbar(`Failed to delete pod: ${safeError(e, 'deletePod')}`, { variant: 'error' });
    }
  };

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
    const interval = setInterval(fetchPodName, 10000);
    return () => clearInterval(interval);
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

  // Fetch PVC details for spec-only disk view (when VM is stopped / no VMI)
  const [pvcInfoMap, setPvcInfoMap] = useState<
    Record<string, { accessModes?: string[]; volumeMode?: string; capacity?: string }>
  >({});
  useEffect(() => {
    if (!vmItem || vmiData?.status?.volumeStatus?.length) return;
    const specVolumes: Array<{
      name: string;
      dataVolume?: { name: string };
      persistentVolumeClaim?: { claimName: string };
    }> = vmItem.spec?.template?.spec?.volumes || [];
    const pvcNames = specVolumes
      .map(v => v.dataVolume?.name || v.persistentVolumeClaim?.claimName)
      .filter(Boolean) as string[];
    if (pvcNames.length === 0) return;

    let cancelled = false;
    Promise.all(
      pvcNames.map(async pvcName => {
        try {
          const pvc = await ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(
              namespace!
            )}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`
          );
          return [
            pvcName,
            {
              accessModes: pvc?.spec?.accessModes,
              volumeMode: pvc?.spec?.volumeMode,
              capacity: pvc?.status?.capacity?.storage || pvc?.spec?.resources?.requests?.storage,
            },
          ] as const;
        } catch {
          return [pvcName, {}] as const;
        }
      })
    ).then(results => {
      if (cancelled) return;
      const map: Record<
        string,
        { accessModes?: string[]; volumeMode?: string; capacity?: string }
      > = {};
      for (const [k, v] of results) map[k] = v;
      setPvcInfoMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [vmItem, vmiData, namespace]);

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

  // Sticky header: track scroll to show compact bar when title scrolls out of view
  const [stickyVisible, setStickyVisible] = useState(false);
  const [stickyLeft, setStickyLeft] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
      let current = el;
      while (current) {
        const overflow = getComputedStyle(current).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return current;
        current = current.parentElement;
      }
      return null;
    };

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const scrollParent = findScrollParent(sentinel);
    if (!scrollParent) return;

    // Detect content area left offset (accounts for sidebar width)
    const updateLeft = () => setStickyLeft(scrollParent.getBoundingClientRect().left);
    updateLeft();

    let lastVisible = false;
    const handleScroll = () => {
      const visible = sentinel.getBoundingClientRect().top < 64;
      if (visible !== lastVisible) {
        lastVisible = visible;
        setStickyVisible(visible);
      }
    };

    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateLeft);
    handleScroll();
    return () => {
      scrollParent.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateLeft);
    };
  }, []);

  const handleStickyAction = useCallback((handler: () => Promise<void> | void) => {
    return () => {
      handler();
    };
  }, []);

  const navSections = [
    { id: 'info', label: 'Info', icon: 'mdi:information' },
    { id: 'provisioning', label: 'Provisioning', icon: 'mdi:progress-download' },
    { id: 'conditions', label: 'Conditions', icon: 'mdi:alert-circle-outline' },
    { id: 'networks', label: 'Networks', icon: 'mdi:lan' },
    { id: 'disks', label: 'Disks', icon: 'mdi:harddisk' },
    ...(snapshotEnabled ? [{ id: 'snapshots', label: 'Snapshots', icon: 'mdi:camera' }] : []),
    ...(vmExportEnabled ? [{ id: 'exports', label: 'Exports', icon: 'mdi:export' }] : []),
    { id: 'migrations', label: 'Migrations', icon: 'mdi:swap-horizontal' },
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
      {/* Sentinel: placed before DetailsGrid — sticky bar appears when this leaves viewport */}
      <div ref={sentinelRef} style={{ height: 1, marginBottom: -1 }} />

      {/* Sticky compact bar — slides in when title is scrolled away */}
      <Box
        sx={{
          position: 'fixed',
          top: 64,
          left: stickyLeft,
          right: 0,
          zIndex: 1100,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          px: 2,
          py: 0.75,
          gap: 1,
          boxShadow: stickyVisible ? '0 2px 12px rgba(0,0,0,0.4)' : 'none',
          transform: stickyVisible ? 'translateY(0)' : 'translateY(-100%)',
          opacity: stickyVisible ? 1 : 0,
          transition:
            'transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, box-shadow 0.3s ease',
          pointerEvents: stickyVisible ? 'auto' : 'none',
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 300,
          }}
        >
          {name}
        </Typography>
        {vmItem &&
          (() => {
            const status = vmItem.status?.printableStatus || 'Unknown';
            const sc = getVMStatusConfig(status);
            return (
              <Chip
                label={status}
                size="small"
                icon={sc.icon}
                sx={{
                  bgcolor: sc.bgcolor,
                  color: sc.color,
                  fontWeight: 600,
                  height: 22,
                  fontSize: '0.7rem',
                  '& .MuiChip-icon': { color: sc.color },
                }}
              />
            );
          })()}
        <Box sx={{ flex: 1 }} />
        {vmActions
          .filter(a => a.id !== 'migrate' || liveMigrationEnabled)
          .map(a => (
            <SimpleStyledTooltip key={a.id} title={a.label}>
              <span>
                <IconButton
                  size="small"
                  disabled={a.disabled}
                  onClick={handleStickyAction(a.handler)}
                  sx={{ p: 0.5 }}
                >
                  <Icon icon={a.icon} width={18} />
                </IconButton>
              </span>
            </SimpleStyledTooltip>
          ))}
        <SimpleStyledTooltip title="Edit with Wizard">
          <IconButton size="small" onClick={() => setShowEditDialog(true)} sx={{ p: 0.5 }}>
            <Icon icon="mdi:auto-fix" width={18} />
          </IconButton>
        </SimpleStyledTooltip>
        {snapshotEnabled && (
          <>
            <SimpleStyledTooltip title="Take Snapshot">
              <IconButton size="small" onClick={() => setShowSnapshotDialog(true)} sx={{ p: 0.5 }}>
                <Icon icon="mdi:camera" width={18} />
              </IconButton>
            </SimpleStyledTooltip>
            <SimpleStyledTooltip title="Clone VM">
              <IconButton size="small" onClick={() => setShowCloneDialog(true)} sx={{ p: 0.5 }}>
                <Icon icon="mdi:content-copy" width={18} />
              </IconButton>
            </SimpleStyledTooltip>
          </>
        )}
        <SimpleStyledTooltip title="VM Doctor">
          <IconButton size="small" onClick={() => setShowDoctor(true)} sx={{ p: 0.5 }}>
            <Icon icon="mdi:stethoscope" width={18} />
          </IconButton>
        </SimpleStyledTooltip>
        <SimpleStyledTooltip title="Terminal">
          <IconButton
            size="small"
            onClick={() => {
              setConsoleTab('terminal');
              setShowConsole(true);
            }}
            sx={{ p: 0.5 }}
          >
            <Icon icon="mdi:console" width={18} />
          </IconButton>
        </SimpleStyledTooltip>
        <SimpleStyledTooltip title="VNC">
          <IconButton
            size="small"
            onClick={() => {
              setConsoleTab('vnc');
              setShowConsole(true);
            }}
            sx={{ p: 0.5 }}
          >
            <Icon icon="mdi:monitor" width={18} />
          </IconButton>
        </SimpleStyledTooltip>
      </Box>

      <Resource.DetailsGrid
        name={name}
        namespace={namespace}
        resourceType={VirtualMachine}
        extraInfo={item =>
          item && [
            {
              name: t('Status'),
              value: (() => {
                const status = item?.jsonData.status?.printableStatus || 'Unknown';
                const statusConfig = getVMStatusConfig(status);
                return (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      label={status}
                      size="small"
                      icon={statusConfig.icon}
                      sx={{
                        bgcolor: statusConfig.bgcolor,
                        color: statusConfig.color,
                        fontWeight: 600,
                        height: 26,
                        '& .MuiChip-icon': { color: statusConfig.color },
                      }}
                    />
                    {liveMigrationEnabled &&
                      item?.jsonData.status.conditions?.map(condition => {
                        if (condition.type === 'LiveMigratable' && condition.status === 'False') {
                          return (
                            <SimpleStyledTooltip
                              key="notmigratable"
                              title={condition.message || 'Cannot be live migrated'}
                            >
                              <Chip
                                label="Not Migratable"
                                size="small"
                                variant="outlined"
                                icon={
                                  <Icon
                                    icon="mdi:alert"
                                    width={14}
                                    style={{ verticalAlign: 'middle', marginTop: -2 }}
                                  />
                                }
                                sx={{
                                  borderColor: '#ffb74d',
                                  color: '#ffb74d',
                                  borderRadius: '16px',
                                  height: 26,
                                  '& .MuiChip-icon': { color: '#ffb74d' },
                                }}
                              />
                            </SimpleStyledTooltip>
                          );
                        }
                        return null;
                      })}
                    {status === 'Migrating' && activeMigration && (
                      <Link
                        routeName="migration"
                        params={{
                          name: activeMigration.getName(),
                          namespace: activeMigration.getNamespace(),
                        }}
                        style={{ textDecoration: 'none' }}
                      >
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<Icon icon="mdi:open-in-new" width={14} />}
                          sx={{ fontSize: '0.75rem', textTransform: 'none', py: 0, minHeight: 24 }}
                        >
                          View migration
                        </Button>
                      </Link>
                    )}
                    {status === 'Migrating' && !activeMigration && (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<Icon icon="mdi:arrow-down" width={14} />}
                        onClick={() => {
                          document
                            .getElementById('section-migrations')
                            ?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        sx={{ fontSize: '0.75rem', textTransform: 'none', py: 0, minHeight: 24 }}
                      >
                        View migrations
                      </Button>
                    )}
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
                );
              })(),
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
                <Box display="flex" alignItems="center" gap={1}>
                  <Link
                    routeName="pod"
                    params={{
                      name: podName,
                      namespace: item.getNamespace(),
                    }}
                  >
                    {podName}
                  </Link>
                  <SimpleStyledTooltip title="Delete pod">
                    <IconButton
                      size="small"
                      onClick={() => setPodDeleteConfirm('delete')}
                      aria-label="Delete pod"
                    >
                      <Icon icon="mdi:delete-outline" width={16} />
                    </IconButton>
                  </SimpleStyledTooltip>
                  <SimpleStyledTooltip title="Force delete pod (gracePeriodSeconds=0)">
                    <IconButton
                      size="small"
                      onClick={() => setPodDeleteConfirm('force')}
                      aria-label="Force delete pod"
                      sx={{ color: '#ef5350' }}
                    >
                      <Icon icon="mdi:delete-alert" width={16} />
                    </IconButton>
                  </SimpleStyledTooltip>
                </Box>
              ) : (
                'N/A'
              ),
            },
          ]
        }
        extraSections={item =>
          item && [
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
                    {vmDataVolumes.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                        No provisioning activity for this VM.
                      </Typography>
                    ) : (
                      <>
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
                              getter: (dv: InstanceType<typeof DataVolume>) => dv.getStorageClass(),
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
                                        color={color as 'primary' | 'success' | 'error' | 'default'}
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
                              <strong>Ready for Upload:</strong> A DataVolume is waiting for a disk
                              image upload.
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
                              <code>--insecure</code> flag is needed because the port-forward uses a
                              self-signed certificate.
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
                      </>
                    )}
                  </SectionBox>
                </Box>
              ),
            },
            {
              id: 'conditions',
              section: (
                <Box id="section-conditions">
                  <Resource.ConditionsSection
                    resource={
                      item
                        ? {
                            ...item.jsonData,
                            status: {
                              ...item.jsonData.status,
                              conditions: (item.jsonData.status?.conditions || []).map(
                                (c: { lastTransitionTime?: string; [key: string]: unknown }) => {
                                  const ts = c.lastTransitionTime;
                                  const isEpoch =
                                    !ts ||
                                    ts === '0001-01-01T00:00:00Z' ||
                                    new Date(ts).getTime() <= 0;
                                  return isEpoch
                                    ? {
                                        ...c,
                                        lastTransitionTime:
                                          item.jsonData.metadata?.creationTimestamp,
                                      }
                                    : c;
                                }
                              ),
                            },
                          }
                        : undefined
                    }
                  />
                  {vmItem?.hasManualRecoveryRequired() && (
                    <Alert
                      severity="error"
                      sx={{ mt: 1, mx: 2 }}
                      icon={<Icon icon="mdi:alert-circle" />}
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          startIcon={<Icon icon="mdi:auto-fix" />}
                          onClick={() => setShowResolveDialog(true)}
                        >
                          Resolve
                        </Button>
                      }
                    >
                      Manual recovery required — the VM was stopped during volume migration. Revert
                      volumes to their original state before starting.
                    </Alert>
                  )}
                  {!vmItem?.hasManualRecoveryRequired() && vmItem?.getVolumesUpdateError() && (
                    <Alert
                      severity="error"
                      sx={{ mt: 1, mx: 2 }}
                      icon={<Icon icon="mdi:alert-circle" />}
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          startIcon={<Icon icon="mdi:auto-fix" />}
                          onClick={() => setShowResolveDialog(true)}
                        >
                          Resolve
                        </Button>
                      }
                    >
                      Volume migration failed — revert to the previous state to restore stability.
                    </Alert>
                  )}
                  {!vmItem?.getVolumesUpdateError() &&
                    (() => {
                      const restartCond = (vmItem?.status?.conditions || []).find(
                        (c: { type: string; status: string }) =>
                          c.type === 'RestartRequired' && c.status === 'True'
                      );
                      if (!restartCond) return null;
                      const pending = getPendingChanges(vmItem, vmiData);
                      return (
                        <Alert
                          severity="warning"
                          variant="filled"
                          sx={{ mt: 1, mx: 2 }}
                          icon={<Icon icon="mdi:restart-alert" />}
                          action={
                            <Button
                              color="inherit"
                              size="small"
                              startIcon={<Icon icon="mdi:auto-fix" />}
                              onClick={() => setShowResolveDialog(true)}
                            >
                              Restart
                            </Button>
                          }
                        >
                          A configuration change is pending and requires a restart to take effect.
                          {pending.length > 0 && (
                            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5, opacity: 0.9 }}>
                              {pending.map(change => (
                                <Typography key={change} component="li" variant="body2">
                                  {change}
                                </Typography>
                              ))}
                            </Box>
                          )}
                        </Alert>
                      );
                    })()}
                </Box>
              ),
            },
            {
              id: 'networks',
              section: (
                <Box id="section-networks">
                  {(() => {
                    const specNetworks: Array<{
                      name: string;
                      pod?: unknown;
                      multus?: { networkName?: string };
                    }> = vmItem?.spec?.template?.spec?.networks || [];
                    const specInterfaces: Array<{
                      name: string;
                      bridge?: unknown;
                      masquerade?: unknown;
                      sriov?: unknown;
                      macAddress?: string;
                    }> = vmItem?.spec?.template?.spec?.domain?.devices?.interfaces || [];
                    const autoAttachPod =
                      vmItem?.spec?.template?.spec?.domain?.devices?.autoattachPodInterface;

                    const getNadForInterface = (
                      ifaceName: string
                    ): { nadName: string; nadNamespace: string } | null => {
                      const net = specNetworks.find(n => n.name === ifaceName);
                      if (!net?.multus?.networkName) return null;
                      const parts = net.multus.networkName.split('/');
                      if (parts.length === 2) return { nadName: parts[1], nadNamespace: parts[0] };
                      return { nadName: parts[0], nadNamespace: namespace || '' };
                    };

                    // Detect implicit default pod network
                    const hasImplicitPodNetwork =
                      specNetworks.length === 0 && autoAttachPod !== false;

                    // Unified row shape for both running and stopped
                    interface NetRow {
                      name: string;
                      network: React.ReactNode;
                      mac: string;
                      ips: string;
                      tooltipRows?: { label: string; value: string }[];
                      ipList?: string[];
                      implicit?: boolean;
                    }

                    const hasVmiInterfaces =
                      vmiData?.status?.interfaces && vmiData.status.interfaces.length > 0;

                    let netRows: NetRow[] = [];

                    if (hasVmiInterfaces) {
                      // Running: use VMI status interfaces (includes guest agent data)
                      netRows = vmiData.status.interfaces.map((iface: VMIStatusInterface) => {
                        const ifaceName = iface.name || '';
                        const nad = getNadForInterface(ifaceName);
                        const net = specNetworks.find(n => n.name === ifaceName);
                        // Implicit if no matching spec network and autoattach is not disabled
                        const isImplicit = !net && hasImplicitPodNetwork;
                        let network: React.ReactNode = '-';
                        if (net?.pod || isImplicit) network = 'Pod network';
                        else if (nad) {
                          network = (
                            <Link
                              routeName="nad"
                              params={{ name: nad.nadName, namespace: nad.nadNamespace }}
                            >
                              {nad.nadName}
                            </Link>
                          );
                        }

                        const ips =
                          iface.ipAddresses && iface.ipAddresses.length > 0
                            ? iface.ipAddresses.join(', ')
                            : iface.ipAddress || 'N/A';

                        return {
                          name: iface.name || iface.interfaceName || 'N/A',
                          network,
                          mac: iface.mac || 'N/A',
                          ips,
                          ipList: ips !== 'N/A' ? ips.split(', ') : undefined,
                          implicit: isImplicit,
                          tooltipRows: [
                            iface.interfaceName
                              ? { label: 'Interface', value: iface.interfaceName }
                              : null,
                            { label: 'State', value: iface.linkState || 'N/A' },
                            iface.queueCount
                              ? { label: 'Queues', value: String(iface.queueCount) }
                              : null,
                          ].filter(Boolean) as { label: string; value: string }[],
                        };
                      });
                    } else {
                      // Stopped or no VMI: build from spec
                      netRows = specInterfaces.map(iface => {
                        const nad = getNadForInterface(iface.name);
                        const net = specNetworks.find(n => n.name === iface.name);
                        let network: React.ReactNode = '-';
                        if (net?.pod) network = 'Pod network';
                        else if (nad) {
                          network = (
                            <Link
                              routeName="nad"
                              params={{ name: nad.nadName, namespace: nad.nadNamespace }}
                            >
                              {nad.nadName}
                            </Link>
                          );
                        }

                        const binding = iface.bridge
                          ? 'bridge'
                          : iface.masquerade
                          ? 'masquerade'
                          : iface.sriov
                          ? 'sriov'
                          : '';

                        return {
                          name: iface.name,
                          network,
                          mac: iface.macAddress || 'N/A',
                          ips: 'N/A',
                          tooltipRows: binding ? [{ label: 'Binding', value: binding }] : undefined,
                        };
                      });

                      // Add implicit default pod network row
                      if (hasImplicitPodNetwork && netRows.length === 0) {
                        netRows.push({
                          name: 'default',
                          network: 'Pod network',
                          mac: 'N/A',
                          ips: 'N/A',
                          implicit: true,
                          tooltipRows: [{ label: 'Binding', value: 'masquerade' }],
                        });
                      }
                    }

                    // Also add implicit default if running but not in specNetworks and autoattach
                    if (hasVmiInterfaces && hasImplicitPodNetwork) {
                      // The VMI already includes it in status.interfaces, nothing to add
                    }

                    return (
                      <SectionBox title="Network Interfaces">
                        {netRows.length > 0 ? (
                          <SimpleTable
                            data={netRows}
                            columns={[
                              {
                                label: 'Name',
                                getter: (row: NetRow) => {
                                  const displayName = row.implicit ? (
                                    <span style={{ fontStyle: 'italic' }}>
                                      {row.name} (implicit)
                                    </span>
                                  ) : (
                                    <>{row.name}</>
                                  );

                                  // For implicit interfaces, combine runtime info with the implicit explanation
                                  const tooltipRows = [
                                    ...(row.tooltipRows || []),
                                    ...(row.implicit
                                      ? [
                                          {
                                            label: 'Note',
                                            value:
                                              'No network is explicitly defined. KubeVirt auto-attaches a default pod network with masquerade binding when autoattachPodInterface is not set to false.',
                                          },
                                        ]
                                      : []),
                                  ];

                                  if (tooltipRows.length > 0) {
                                    return (
                                      <TitledTooltip title="Network Interface" rows={tooltipRows}>
                                        <span style={{ cursor: 'help' }}>{displayName}</span>
                                      </TitledTooltip>
                                    );
                                  }
                                  return displayName;
                                },
                              },
                              {
                                label: 'Network',
                                getter: (row: NetRow) => row.network,
                              },
                              {
                                label: 'MAC',
                                getter: (row: NetRow) => row.mac,
                              },
                              {
                                label: 'IPs',
                                getter: (row: NetRow) => {
                                  if (row.ips === 'N/A') return 'N/A';
                                  const ipArr = row.ipList || row.ips.split(', ');
                                  return (
                                    <TitledTooltip
                                      title="IP Addresses"
                                      rows={ipArr.map(ip => ({ label: '', value: ip }))}
                                    >
                                      <span style={{ cursor: 'help' }}>{row.ips}</span>
                                    </TitledTooltip>
                                  );
                                },
                              },
                            ]}
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No network interfaces defined
                          </Typography>
                        )}
                      </SectionBox>
                    );
                  })()}
                </Box>
              ),
            },
            {
              id: 'disks',
              section: (
                <Box id="section-disks">
                  {(() => {
                    const hasVmiVolumes =
                      vmiData?.status?.volumeStatus && vmiData.status.volumeStatus.length > 0;
                    const specVolumes: Array<{
                      name: string;
                      dataVolume?: { name: string };
                      persistentVolumeClaim?: { claimName: string };
                      cloudInitNoCloud?: unknown;
                      cloudInitConfigDrive?: unknown;
                    }> = vmItem?.spec?.template?.spec?.volumes || [];
                    const specDisks: Array<{
                      name: string;
                      disk?: { bus?: string };
                      lun?: unknown;
                      cdrom?: unknown;
                    }> = vmItem?.spec?.template?.spec?.domain?.devices?.disks || [];
                    const hasSpecVolumes = specVolumes.length > 0;

                    // Build unified row data — same shape for both VMI and spec-only views
                    interface DiskRow {
                      name: string;
                      target: string;
                      capacity: string;
                      pvcDisplay: React.ReactNode;
                      volumeMode: string;
                      hasPvc: boolean;
                    }

                    let diskRows: DiskRow[] = [];

                    if (hasVmiVolumes) {
                      diskRows = vmiData.status.volumeStatus.map((volume: VMIVolumeStatus) => {
                        const specDisk = specDisks.find(d => d.name === volume.name);
                        const bus = specDisk?.disk?.bus || '';
                        const targetStr = volume.target
                          ? bus
                            ? `${volume.target} (${bus})`
                            : volume.target
                          : bus
                          ? `N/A (${bus})`
                          : 'N/A';
                        const pvcInfo = volume.persistentVolumeClaimInfo;
                        const capacity = volume.size
                          ? `${(volume.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                          : pvcInfo?.capacity?.storage || 'N/A';
                        let pvcDisplay: React.ReactNode = 'N/A';
                        if (pvcInfo) {
                          const accessMode = pvcInfo.accessModes
                            ? shortAccessModes(pvcInfo.accessModes)
                            : 'N/A';
                          pvcDisplay = (
                            <span>
                              <Link
                                routeName="persistentVolumeClaim"
                                params={{ name: pvcInfo.claimName, namespace: namespace || '' }}
                              >
                                {pvcInfo.claimName}
                              </Link>{' '}
                              ({accessMode})
                            </span>
                          );
                        }
                        // Volume mode from DVT spec or default
                        const dvt = vmItem?.spec?.dataVolumeTemplates?.find(
                          (d: { metadata?: { name?: string } }) =>
                            d.metadata?.name === (pvcInfo?.claimName || '')
                        );
                        const volMode =
                          dvt?.spec?.storage?.volumeMode || dvt?.spec?.pvc?.volumeMode || '-';
                        return {
                          name: volume.name,
                          target: targetStr,
                          capacity,
                          pvcDisplay,
                          volumeMode: volMode,
                          hasPvc: !!pvcInfo,
                        };
                      });
                    } else if (hasSpecVolumes) {
                      diskRows = specVolumes.map(vol => {
                        const specDisk = specDisks.find(d => d.name === vol.name);
                        const bus = specDisk?.disk?.bus || '';
                        const targetStr = bus ? `N/A (${bus})` : 'N/A';
                        const pvcName =
                          vol.dataVolume?.name || vol.persistentVolumeClaim?.claimName;
                        const pvcInfo = pvcName ? pvcInfoMap[pvcName] : undefined;
                        const accessMode = pvcInfo?.accessModes
                          ? shortAccessModes(pvcInfo.accessModes)
                          : '';
                        const pvcDisplay: React.ReactNode = pvcName ? (
                          <span>
                            <Link
                              routeName="persistentVolumeClaim"
                              params={{ name: pvcName, namespace: namespace || '' }}
                            >
                              {pvcName}
                            </Link>
                            {accessMode ? ` (${accessMode})` : ''}
                          </span>
                        ) : (
                          'N/A'
                        );
                        const dvt = vmItem?.spec?.dataVolumeTemplates?.find(
                          (d: { metadata?: { name?: string } }) => d.metadata?.name === pvcName
                        );
                        const volMode =
                          pvcInfo?.volumeMode ||
                          dvt?.spec?.storage?.volumeMode ||
                          dvt?.spec?.pvc?.volumeMode ||
                          '-';
                        const capacity = pvcInfo?.capacity || '-';
                        return {
                          name: vol.name,
                          target: targetStr,
                          capacity,
                          pvcDisplay,
                          volumeMode: volMode,
                          hasPvc: !!pvcName,
                        };
                      });
                    }

                    const migrateChip = volumeMigrationEnabled
                      ? [
                          <Chip
                            key="migrate"
                            label="Migrate"
                            size="small"
                            icon={<Icon icon="mdi:swap-horizontal" width={16} />}
                            disabled={vmItem?.isVolumeMigrationInProgress()}
                            onClick={() => {
                              setMigrateVolumeName(undefined);
                              setShowMigrateDialog(true);
                            }}
                            sx={{
                              bgcolor: '#fff',
                              color: '#222',
                              fontWeight: 600,
                              cursor: 'pointer',
                              '& .MuiChip-icon': { color: '#222' },
                              '&:hover': { bgcolor: '#e0e0e0' },
                            }}
                          />,
                        ]
                      : [];

                    if (diskRows.length === 0) {
                      return (
                        <SectionBox
                          title="Disks & Volumes"
                          headerProps={{ titleSideActions: migrateChip }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No disks configured for this VM.
                          </Typography>
                        </SectionBox>
                      );
                    }

                    return (
                      <SectionBox
                        title="Disks & Volumes"
                        headerProps={{ titleSideActions: migrateChip }}
                      >
                        {vmItem?.isVolumeMigrationInProgress() && (
                          <Box sx={{ mb: 1 }}>
                            <Chip
                              size="small"
                              color="info"
                              icon={<CircularProgress size={12} />}
                              label="Volume migration in progress"
                            />
                          </Box>
                        )}
                        <SimpleTable
                          data={diskRows}
                          columns={[
                            { label: 'Name', getter: (row: DiskRow) => row.name },
                            { label: 'Target', getter: (row: DiskRow) => row.target },
                            { label: 'Capacity', getter: (row: DiskRow) => row.capacity },
                            {
                              label: 'PVC (Access Mode)',
                              getter: (row: DiskRow) => row.pvcDisplay,
                            },
                            { label: 'Volume Mode', getter: (row: DiskRow) => row.volumeMode },
                            ...(volumeMigrationEnabled
                              ? [
                                  {
                                    label: '',
                                    getter: (row: DiskRow) => (
                                      <SimpleStyledTooltip title="Migrate volume to different storage">
                                        <span>
                                          <IconButton
                                            size="small"
                                            disabled={
                                              !row.hasPvc || vmItem?.isVolumeMigrationInProgress()
                                            }
                                            onClick={() => {
                                              setMigrateVolumeName(row.name);
                                              setShowMigrateDialog(true);
                                            }}
                                          >
                                            <Icon icon="mdi:swap-horizontal" />
                                          </IconButton>
                                        </span>
                                      </SimpleStyledTooltip>
                                    ),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </SectionBox>
                    );
                  })()}
                </Box>
              ),
            },
            ...(snapshotEnabled
              ? [
                  {
                    id: 'snapshots',
                    section: (
                      <Box id="section-snapshots">
                        <SectionBox
                          title="Snapshots"
                          headerProps={{
                            titleSideActions: [
                              <Chip
                                key="snapshot"
                                label="Take snapshot"
                                size="small"
                                icon={<Icon icon="mdi:camera" width={16} />}
                                onClick={() => setShowSnapshotDialog(true)}
                                sx={{
                                  bgcolor: '#fff',
                                  color: '#222',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  '& .MuiChip-icon': { color: '#222' },
                                  '&:hover': { bgcolor: '#e0e0e0' },
                                }}
                              />,
                            ],
                          }}
                        >
                          <SnapshotsList
                            vmName={name || ''}
                            namespace={namespace || ''}
                            vmExportEnabled={vmExportEnabled}
                          />
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
              id: 'migrations',
              section: (
                <Box id="section-migrations">
                  <SectionBox title="Migrations">
                    <MigrationsList
                      vmName={name || ''}
                      namespace={namespace || ''}
                      vmiData={vmiData}
                    />
                  </SectionBox>
                </Box>
              ),
            },
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
                  {
                    id: 'clone',
                    action: (
                      <ActionButton
                        description={t('Clone VM')}
                        icon="mdi:content-copy"
                        onClick={() => setShowCloneDialog(true)}
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
      <CloneDialog
        open={showCloneDialog}
        onClose={() => setShowCloneDialog(false)}
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
      {vmItem && vmItem.status?.printableStatus === 'Stopped' ? (
        <CloneVolumeDialog
          open={showMigrateDialog}
          onClose={() => {
            setShowMigrateDialog(false);
            setMigrateVolumeName(undefined);
          }}
          vm={vmItem}
          volumeName={migrateVolumeName}
        />
      ) : vmItem ? (
        <MigrateVolumeDialog
          open={showMigrateDialog}
          onClose={() => {
            setShowMigrateDialog(false);
            setMigrateVolumeName(undefined);
          }}
          vm={vmItem}
          volumeName={migrateVolumeName}
        />
      ) : null}
      {vmItem && (
        <ResolveVolumeMigrationDialog
          open={showResolveDialog}
          onClose={() => setShowResolveDialog(false)}
          vm={vmItem}
          pendingChanges={getPendingChanges(vmItem, vmiData)}
        />
      )}
      <ConfirmDialog
        open={!!podDeleteConfirm}
        title={podDeleteConfirm === 'force' ? 'Force Delete Pod' : 'Delete Pod'}
        message={
          podDeleteConfirm === 'force'
            ? `Force delete pod "${podName}"? This sets gracePeriodSeconds=0, immediately killing the pod. The VM will be rescheduled by KubeVirt.`
            : `Delete pod "${podName}"? KubeVirt will attempt to gracefully shut down and reschedule the VM.`
        }
        confirmLabel={podDeleteConfirm === 'force' ? 'Force Delete' : 'Delete'}
        onConfirm={() => handleDeletePod(podDeleteConfirm === 'force')}
        onCancel={() => setPodDeleteConfirm(null)}
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
  vmExportEnabled: boolean;
}

function SnapshotsList({ vmName, namespace, vmExportEnabled }: SnapshotsListProps) {
  const { items: snapshots } = VirtualMachineSnapshot.useList({ namespace });
  const { enqueueSnackbar } = useSnackbar();
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSnapshot, setSelectedSnapshot] = useState<VirtualMachineSnapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VirtualMachineSnapshot | null>(null);
  const [restoreSnapshot, setRestoreSnapshot] = useState<VirtualMachineSnapshot | null>(null);
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
            getter: (snapshot: VirtualMachineSnapshot) => (
              <Link
                routeName="snapshot"
                params={{ name: snapshot.getName(), namespace: snapshot.getNamespace() }}
              >
                {snapshot.getName()}
              </Link>
            ),
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
                {snapshot.isReadyToUse() && (
                  <SimpleStyledTooltip title="Restore snapshot">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => setRestoreSnapshot(snapshot)}
                    >
                      <Icon icon="mdi:restore" width={18} />
                    </IconButton>
                  </SimpleStyledTooltip>
                )}
                {vmExportEnabled && snapshot.isReadyToUse() && (
                  <SimpleStyledTooltip title="Export snapshot">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => setSelectedSnapshot(snapshot)}
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
          open={!!selectedSnapshot}
          onClose={() => setSelectedSnapshot(null)}
          snapshotName={selectedSnapshot.getName()}
          snapshotNamespace={namespace}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Snapshot"
        message={`Are you sure you want to delete snapshot "${deleteTarget?.getName()}"?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      {restoreSnapshot && (
        <RestoreDialog
          open={!!restoreSnapshot}
          onClose={() => setRestoreSnapshot(null)}
          snapshotName={restoreSnapshot.getName()}
          vmName={vmName}
          namespace={namespace}
        />
      )}
    </Box>
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

function MigrationsList({
  vmName,
  namespace,
  vmiData,
}: {
  vmName: string;
  namespace: string;
  vmiData: VMIData | null;
}) {
  const { items: migrations } = VirtualMachineInstanceMigration.useList({ namespace });

  // Filter migrations for this VM by label kubevirt.io/vmi-name or spec.vmiName
  const vmMigrations = (
    migrations?.filter((m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
      const labelMatch = m.metadata?.labels?.['kubevirt.io/vmi-name'] === vmName;
      const specMatch = m.getVMIName() === vmName;
      return labelMatch || specMatch;
    }) || []
  ).sort((a, b) => {
    const timeA = new Date(a.metadata?.creationTimestamp || 0).getTime();
    const timeB = new Date(b.metadata?.creationTimestamp || 0).getTime();
    return timeB - timeA;
  });

  // Live migration state from VMI (for active migrations)
  const vmiMigrationState = vmiData?.status?.migrationState as
    | {
        completed?: boolean;
        migrationUid?: string;
        mode?: string;
        startTimestamp?: string;
        endTimestamp?: string;
        sourceNode?: string;
        targetNode?: string;
      }
    | undefined;

  if (vmMigrations.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No migrations for this VM.
      </Typography>
    );
  }

  return (
    <SimpleTable
      data={vmMigrations}
      columns={[
        {
          label: 'Name',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => (
            <Link routeName="migration" params={{ name: m.getName(), namespace: m.getNamespace() }}>
              {m.getName()}
            </Link>
          ),
        },
        {
          label: 'Status',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
            const phase = m.getPhase();
            const isActive =
              phase === 'Running' ||
              phase === 'Scheduling' ||
              phase === 'PreparingTarget' ||
              phase === 'TargetReady';
            let color: 'default' | 'primary' | 'success' | 'error' | 'warning' = 'default';
            if (phase === 'Succeeded') color = 'success';
            else if (phase === 'Failed') color = 'error';
            else if (isActive) color = 'primary';
            else if (phase === 'Pending') color = 'warning';

            if (isActive) {
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={phase}
                    color={color}
                    size="small"
                    icon={<CircularProgress size={12} color="inherit" />}
                  />
                </Box>
              );
            }
            return <Chip label={phase} color={color} size="small" />;
          },
        },
        {
          label: 'Mode',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
            const migState = m.status?.migrationState;
            const mode =
              migState?.mode ||
              // For active migration, check VMI state
              (!m.isCompleted() && vmiMigrationState?.migrationUid === m.metadata?.uid
                ? vmiMigrationState.mode
                : undefined);
            return mode || '-';
          },
        },
        {
          label: 'Source → Target',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
            const source = m.getSourceNode();
            const target = m.getTargetNode();
            if (source === '-' && target === '-') return '-';
            return `${source} → ${target}`;
          },
        },
        {
          label: 'Duration',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
            const startTs = m.getStartTime();
            if (!startTs || startTs === '-') return '-';
            const endTs = m.getCompletionTime();
            const isActive = !m.isCompleted();

            const duration = formatDuration(startTs, endTs !== '-' ? endTs : undefined);

            if (isActive) {
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
                  <LinearProgress
                    variant="indeterminate"
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  />
                  <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                    {duration}
                  </Typography>
                </Box>
              );
            }

            return duration;
          },
        },
        {
          label: 'Started',
          getter: (m: InstanceType<typeof VirtualMachineInstanceMigration>) => {
            const ts = m.getStartTime();
            return ts && ts !== '-' ? new Date(ts).toLocaleString() : '-';
          },
        },
      ]}
    />
  );
}
