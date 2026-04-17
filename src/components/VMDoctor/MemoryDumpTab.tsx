import './command-tooltip.css';
import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isFeatureGateEnabled } from '../../utils/featureGates';
import { getForensicSettings } from '../../utils/pluginSettings';
import { isValidK8sName, safeError } from '../../utils/sanitize';
import { getDumpPhaseColor, getDumpPhaseIcon, getPVCPhaseColor } from '../../utils/statusColors';
import ConfirmDialog from '../common/ConfirmDialog';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import PodExecTerminal, { PodExecTerminalHandle } from './PodExecTerminal';

/** Minimal K8s PVC shape for API responses */
interface K8sPVC {
  metadata: {
    name: string;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
  };
  spec: { resources?: { requests?: { storage?: string } } };
  status?: { phase?: string };
}

interface MemoryDumpTabProps {
  vmName: string;
  namespace: string;
  vmItem?: VirtualMachine | null;
  vmiData?: Record<string, unknown> | null;
  hasAgent?: boolean;
}

interface MemoryDumpRequest {
  claimName?: string;
  phase?: string;
  startTimestamp?: string;
  endTimestamp?: string;
  fileName?: string;
  message?: string;
}

interface DumpPVC {
  name: string;
  displayName?: string; // user-friendly label from PVC annotation
  size: string;
  created: string;
  phase: string; // Bound, Pending, etc.
  isActive: boolean; // matches current memoryDumpRequest
  activePhase?: string; // InProgress, Completed, Failed
}

function parseMemorySize(mem: string): number {
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  return Math.ceil(value * (units[unit] || 1));
}

function suggestPVCSize(vmMemory: string): string {
  const memBytes = parseMemorySize(vmMemory);
  const overhead = 100 * 1024 * 1024;
  const total = Math.ceil((memBytes + overhead) * 1.05);
  const giB = Math.ceil(total / 1024 ** 3);
  return `${giB}Gi`;
}

function CopyableCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        px: 1,
        py: 0.5,
      }}
    >
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          {label}
        </Typography>
      )}
      <Typography
        variant="body2"
        component="code"
        sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
      >
        {command}
      </Typography>
      <IconButton
        size="small"
        aria-label="Copy command"
        onClick={() => {
          navigator.clipboard?.writeText(command).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        sx={{ p: 0.25, ml: 0.5 }}
      >
        <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={14} />
      </IconButton>
    </Box>
  );
}

interface ForensicCommand {
  label: string;
  command: string;
  description?: string;
}

function getForensicCommands(): Array<{ category: string; commands: ForensicCommand[] }> {
  const dump = '/dump/*.memory.dump';
  return [
    {
      category: 'Info',
      commands: [
        {
          label: 'Scan Dump',
          command: `vol-qemu -f ${dump} --info`,
          description: 'Identify the OS and kernel version from the memory dump',
        },
        {
          label: 'List Plugins',
          command: `vol-qemu -f ${dump} --list`,
          description: 'Show all available Volatility analysis plugins',
        },
        {
          label: 'Banners',
          command: `vol -f ${dump} banners.Banners`,
          description: 'Extract OS identification strings from the dump',
        },
        {
          label: 'VMCoreInfo',
          command: `vol-qemu -f ${dump} linux.vmcoreinfo.VMCoreInfo`,
          description: 'Kernel crash info — symbol table and debug data offsets',
        },
      ],
    },
    {
      category: 'Processes',
      commands: [
        {
          label: 'Process List',
          command: `vol-qemu -f ${dump} linux.pslist.PsList`,
          description: 'Flat list of all running processes at the time of the dump',
        },
        {
          label: 'Process Tree',
          command: `vol-qemu -f ${dump} linux.pstree.PsTree`,
          description: 'Hierarchical parent-child view of all processes',
        },
        {
          label: 'Process Aux',
          command: `vol-qemu -f ${dump} linux.psaux.PsAux`,
          description: 'Detailed process info with command-line arguments (like ps aux)',
        },
        {
          label: 'Bash History',
          command: `vol-qemu -f ${dump} linux.bash.Bash`,
          description: 'In-memory bash command history — may reveal commands not saved to disk',
        },
      ],
    },
    {
      category: 'Kernel',
      commands: [
        {
          label: 'Kernel Modules',
          command: `vol-qemu -f ${dump} linux.lsmod.Lsmod`,
          description: 'List loaded kernel modules — check for unexpected or rootkit modules',
        },
        {
          label: 'Kernel Log',
          command: `vol-qemu -f ${dump} linux.kmsg.Kmsg`,
          description: 'Kernel ring buffer messages (dmesg) captured in the dump',
        },
        {
          label: 'Syscall Check',
          command: `vol-qemu -f ${dump} linux.malware.check_syscall.Check_syscall`,
          description: 'Detect hooked system calls — a common rootkit technique',
        },
      ],
    },
    {
      category: 'Filesystem',
      commands: [
        {
          label: 'Open Files',
          command: `vol-qemu -f ${dump} linux.lsof.Lsof`,
          description: 'All files currently open by any process at dump time',
        },
        {
          label: 'Mount Info',
          command: `vol-qemu -f ${dump} linux.mountinfo.MountInfo`,
          description: 'Mounted filesystems and their options at dump time',
        },
      ],
    },
    {
      category: 'Network',
      commands: [
        {
          label: 'Socket Stats',
          command: `vol-qemu -f ${dump} linux.sockstat.Sockstat`,
          description: 'Active network connections and listening ports at dump time',
        },
      ],
    },
    {
      category: 'Security',
      commands: [
        {
          label: 'Malfind',
          command: `vol-qemu -f ${dump} linux.malware.malfind.Malfind`,
          description:
            'Detect suspicious memory regions: injected code, shellcode, or unpacked malware',
        },
        {
          label: 'Hidden Modules',
          command: `vol-qemu -f ${dump} linux.malware.hidden_modules.Hidden_modules`,
          description: 'Find kernel modules hidden from lsmod — a rootkit detection technique',
        },
        {
          label: 'Module Check',
          command: `vol-qemu -f ${dump} linux.malware.check_modules.Check_modules`,
          description: 'Verify kernel module integrity against known-good state',
        },
      ],
    },
    {
      category: 'Quick & Dirty',
      commands: [
        {
          label: 'Secrets Scan',
          command: `strings ${dump} | grep -i "password\\|secret\\|token" | less`,
          description: "Search raw memory for strings containing 'password', 'secret', or 'token'",
        },
        {
          label: 'Shell History',
          command: `strings ${dump} | grep "COMMAND\\|bash\\|ssh" | less`,
          description: 'Search raw memory for shell commands and SSH-related strings',
        },
        {
          label: 'List Dump Files',
          command: 'ls -lh /dump/',
          description: 'Show the memory dump files and their sizes',
        },
      ],
    },
  ];
}

function ForensicCommandChip({
  cmd,
  onExec,
}: {
  cmd: ForensicCommand;
  onExec: (command: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(cmd.command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chip = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        px: 1,
        py: 0.5,
        cursor: 'pointer',
        transition: 'all 0.15s',
        border: '1px solid transparent',
        '&:hover': {
          bgcolor: 'action.selected',
          borderColor: 'divider',
        },
      }}
      onClick={() => onExec(cmd.command)}
    >
      <Icon icon="mdi:console-line" width={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      <Typography
        variant="caption"
        sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 500, flex: 1 }}
      >
        {cmd.label}
      </Typography>
      <IconButton
        size="small"
        onClick={handleCopy}
        sx={{ p: 0.25, flexShrink: 0 }}
        aria-label="Copy command"
      >
        <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={12} />
      </IconButton>
    </Box>
  );

  if (cmd.description) {
    return (
      <Tooltip
        title={cmd.description}
        arrow
        placement="left"
        classes={{ tooltip: 'command-tooltip' }}
      >
        {chip}
      </Tooltip>
    );
  }
  return chip;
}

export default function MemoryDumpTab({
  vmName,
  namespace,
  vmItem,
  vmiData,
  hasAgent,
}: MemoryDumpTabProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const [selectedSC, setSelectedSC] = useState('');
  const [pvcName, setPvcName] = useState(`${vmName}-memdump-${Date.now().toString(36)}`);
  const [dumpDisplayName, setDumpDisplayName] = useState('');
  const [dumpStatus, setDumpStatus] = useState<MemoryDumpRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  // Dump PVC list
  const [dumpPVCs, setDumpPVCs] = useState<DumpPVC[]>([]);
  const [selectedDump, setSelectedDump] = useState<string | null>(null);
  const [showNewDumpForm, setShowNewDumpForm] = useState(false);
  const [deletingPVC, setDeletingPVC] = useState<string | null>(null);
  const [deleteConfirmPVC, setDeleteConfirmPVC] = useState<string | null>(null);

  // Analysis pod state
  const [analysisPodName, setAnalysisPodName] = useState<string | null>(null);
  const [analysisPodContainer, setAnalysisPodContainer] = useState<string>('vol3');
  const [analysisPodStatus, setAnalysisPodStatus] = useState<
    'none' | 'creating' | 'waiting' | 'running' | 'failed' | 'deleting'
  >('none');
  const [analysisPodDetail, setAnalysisPodDetail] = useState<string>('');
  const [showAnalysisTerminal, setShowAnalysisTerminal] = useState(false);
  const [showCmdRef, setShowCmdRef] = useState(false);
  const [showDeletePodConfirm, setShowDeletePodConfirm] = useState(false);
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initialSelectionDone = useRef(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const terminalRef = useRef<PodExecTerminalHandle>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deletionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deletionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    'disconnected'
  );

  const hotplugEnabled = isFeatureGateEnabled('HotplugVolumes');
  const vmiStatusObj = vmiData?.status as
    | { phase?: string; guestOSInfo?: { kernelRelease?: string } }
    | undefined;
  const vmiPhase = vmiStatusObj?.phase;
  const isRunning = vmiPhase === 'Running';

  const kernelRelease = vmiStatusObj?.guestOSInfo?.kernelRelease;
  const hasKernelInfo = hasAgent && !!kernelRelease;

  const vmMemory =
    vmItem?.jsonData?.spec?.template?.spec?.domain?.memory?.guest ||
    vmItem?.jsonData?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
    '0';
  const suggestedSize = suggestPVCSize(vmMemory);

  // Fetch storage classes
  useEffect(() => {
    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then((res: { items?: Array<{ metadata: { name: string } }> }) => {
        const classes = (res?.items || []).map(
          (sc: { metadata: { name: string } }) => sc.metadata.name
        );
        setStorageClasses(classes);
        const virtSC = classes.find((c: string) => c.includes('virtualization'));
        setSelectedSC(virtSC || classes[0] || '');
      })
      .catch(() => setStorageClasses([]));
  }, []);

  // Fetch dump PVCs in namespace matching vmName-memdump-*
  const fetchDumpPVCs = useCallback(
    async (currentDumpStatus?: MemoryDumpRequest | null) => {
      try {
        const res = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/persistentvolumeclaims`
        );
        const items: K8sPVC[] = res?.items || [];
        const prefix = `${vmName}-memdump-`;
        const dumps: DumpPVC[] = items
          .filter(pvc => pvc.metadata.name.startsWith(prefix))
          .map(pvc => {
            const name = pvc.metadata.name;
            const req = currentDumpStatus || dumpStatus;
            const isActive = req?.claimName === name;
            return {
              name,
              displayName: pvc.metadata.annotations?.['kubevirt.io/dump-name'] || undefined,
              size: pvc.spec.resources?.requests?.storage || '?',
              created: pvc.metadata.creationTimestamp || '',
              phase: pvc.status?.phase || 'Unknown',
              isActive,
              activePhase: isActive ? req?.phase : undefined,
            };
          })
          .sort(
            (a: DumpPVC, b: DumpPVC) =>
              new Date(b.created).getTime() - new Date(a.created).getTime()
          );
        setDumpPVCs(dumps);
        return dumps;
      } catch {
        return [];
      }
    },
    [vmName, namespace, dumpStatus]
  );

  // Poll VM status for memoryDumpRequest
  const fetchDumpStatus = useCallback(async () => {
    try {
      const vm = await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vmName}`
      );
      const req = vm?.status?.memoryDumpRequest || null;
      setDumpStatus(req);
      return req;
    } catch {
      return null;
    }
  }, [vmName, namespace]);

  useEffect(() => {
    (async () => {
      const req = await fetchDumpStatus();
      const pvcs = await fetchDumpPVCs(req);
      // Auto-select on first load only
      if (!initialSelectionDone.current) {
        initialSelectionDone.current = true;
        if (req?.claimName) {
          setSelectedDump(req.claimName);
        } else if (pvcs.length > 0) {
          setSelectedDump(pvcs[0].name);
        }
      }
    })();
  }, [fetchDumpStatus, fetchDumpPVCs]);

  // Poll while in progress
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const req = await fetchDumpStatus();
      if (req?.phase === 'Completed' || req?.phase === 'Failed' || !req) {
        setPolling(false);
        setLoading(false);
        await fetchDumpPVCs(req);
        if (req?.phase === 'Completed') {
          enqueueSnackbar('Memory dump completed', { variant: 'success' });
          setSelectedDump(req.claimName || null);
        } else if (req?.phase === 'Failed') {
          enqueueSnackbar(`Memory dump failed: ${req?.message || 'unknown error'}`, {
            variant: 'error',
          });
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [polling, fetchDumpStatus, fetchDumpPVCs, enqueueSnackbar]);

  // Check if analysis pod exists for selected dump — detect actual container name for reconnect
  useEffect(() => {
    if (!selectedDump) {
      setAnalysisPodName(null);
      setAnalysisPodStatus('none');
      setShowAnalysisTerminal(false);
      return;
    }
    const podName = `vol3-${selectedDump}`;
    ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`)
      .then(
        (pod: { status?: { phase?: string }; spec?: { containers?: Array<{ name: string }> } }) => {
          const phase = pod?.status?.phase;
          const containers = pod?.spec?.containers || [];
          const mainContainer = containers[0]?.name || 'vol3';
          setAnalysisPodName(podName);
          setAnalysisPodContainer(mainContainer);
          if (phase === 'Running') {
            setAnalysisPodStatus('running');
            setShowAnalysisTerminal(true);
          } else if (phase === 'Pending') {
            setAnalysisPodStatus('waiting');
            pollAnalysisPod(podName);
          } else if (phase === 'Succeeded' || phase === 'Failed') {
            setAnalysisPodStatus('failed');
          }
        }
      )
      .catch(() => {
        setAnalysisPodName(null);
        setAnalysisPodContainer('vol3');
        setAnalysisPodStatus('none');
        setShowAnalysisTerminal(false);
      });
  }, [selectedDump, namespace]);

  // Poll analysis pod until running
  const pollAnalysisPod = useCallback(
    (name: string) => {
      setAnalysisPodStatus('waiting');
      setAnalysisPodDetail('');
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      const interval = setInterval(async () => {
        try {
          const pod = await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${name}`);
          const phase = pod?.status?.phase;

          const initStatuses = pod?.status?.initContainerStatuses || [];
          const containerStatuses = pod?.status?.containerStatuses || [];
          const allStatuses = [...initStatuses, ...containerStatuses];
          type ContainerStatus = {
            state?: {
              waiting?: { reason?: string };
              terminated?: { exitCode?: number; reason?: string };
            };
          };
          const waitingReason = (allStatuses as ContainerStatus[]).find(
            (s: ContainerStatus) => s?.state?.waiting
          )?.state?.waiting?.reason;
          const readyInit = (initStatuses as ContainerStatus[]).filter(
            (s: ContainerStatus) => s?.state?.terminated?.exitCode === 0
          ).length;
          const totalInit = initStatuses.length;

          let detail = '';
          if (phase === 'Pending' && totalInit > 0 && readyInit < totalInit) {
            detail = `Init:${readyInit}/${totalInit}`;
            if (waitingReason) detail += ` (${waitingReason})`;
          } else if (waitingReason) {
            detail = waitingReason;
          } else if (phase === 'Pending') {
            detail = 'Pending';
          }
          setAnalysisPodDetail(detail);

          if (phase === 'Running') {
            clearInterval(interval);
            pollIntervalRef.current = null;
            setAnalysisPodStatus('running');
            setAnalysisPodDetail('');
            setShowAnalysisTerminal(true);
            enqueueSnackbar('Volatility3 analysis pod is ready', { variant: 'success' });
          } else if (phase === 'Failed' || phase === 'Succeeded') {
            clearInterval(interval);
            pollIntervalRef.current = null;
            setAnalysisPodStatus('failed');
            const reason =
              containerStatuses?.[0]?.state?.waiting?.reason ||
              containerStatuses?.[0]?.state?.terminated?.reason ||
              phase;
            setAnalysisPodDetail(reason);
            enqueueSnackbar(`Analysis pod failed: ${reason}`, { variant: 'error' });
          }
        } catch {
          clearInterval(interval);
          pollIntervalRef.current = null;
          setAnalysisPodStatus('failed');
          setAnalysisPodDetail('Pod not found');
        }
      }, 2000);
      pollIntervalRef.current = interval;
      // Timeout after 5 minutes
      setTimeout(() => {
        if (pollIntervalRef.current === interval) {
          clearInterval(interval);
          pollIntervalRef.current = null;
          setAnalysisPodStatus(prev => {
            if (prev === 'waiting') {
              setAnalysisPodDetail('Timed out waiting for pod');
              return 'failed';
            }
            return prev;
          });
        }
      }, 300000);
    },
    [namespace, enqueueSnackbar]
  );

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const triggerDump = async () => {
    if (!pvcName.trim()) {
      enqueueSnackbar('PVC name is required', { variant: 'warning' });
      return;
    }
    if (!isValidK8sName(pvcName.trim())) {
      enqueueSnackbar('PVC name must be lowercase alphanumeric with hyphens/dots only', {
        variant: 'warning',
      });
      return;
    }

    setLoading(true);

    try {
      const pvc = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: pvcName, namespace },
        spec: {
          accessModes: ['ReadWriteOnce'],
          volumeMode: 'Filesystem',
          resources: { requests: { storage: suggestedSize } },
          ...(selectedSC ? { storageClassName: selectedSC } : {}),
        },
      };

      await ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims`, {
        method: 'POST',
        body: JSON.stringify(pvc),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('409') && !msg.includes('already exists')) {
        enqueueSnackbar(`Failed to create PVC: ${safeError(e, 'createPVC')}`, { variant: 'error' });
        setLoading(false);
        return;
      }
    }

    try {
      await ApiProxy.request(
        `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vmName}/memorydump`,
        {
          method: 'PUT',
          body: JSON.stringify({
            apiVersion: 'subresources.kubevirt.io/v1',
            kind: 'VirtualMachineMemoryDump',
            claimName: pvcName,
          }),
          headers: { 'Content-Type': 'application/json' },
          isJSON: false,
        }
      );
      enqueueSnackbar('Memory dump initiated', { variant: 'info' });
      // Save display name as annotation on the PVC
      if (dumpDisplayName.trim()) {
        ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims/${pvcName}`, {
          method: 'PATCH',
          body: JSON.stringify({
            metadata: {
              annotations: { 'kubevirt.io/dump-name': dumpDisplayName.trim() },
            },
          }),
          headers: { 'Content-Type': 'application/merge-patch+json' },
        }).catch(() => {}); // best-effort
      }
      setPolling(true);
      setShowNewDumpForm(false);
      setSelectedDump(pvcName);
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to trigger memory dump: ${safeError(e, 'triggerDump')}`, {
        variant: 'error',
      });
      setLoading(false);
    }
  };

  const removeDump = async () => {
    try {
      await ApiProxy.request(
        `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vmName}/removememorydump`,
        { method: 'PUT', isJSON: false }
      );
      enqueueSnackbar('Memory dump association removed', { variant: 'success' });
      setDumpStatus(null);
      await fetchDumpPVCs(null);
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to remove dump association: ${safeError(e, 'removeDumpAssoc')}`, {
        variant: 'error',
      });
    }
  };

  const saveDumpName = async (pvc: string, name: string) => {
    try {
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims/${pvc}`, {
        method: 'PATCH',
        body: JSON.stringify({
          metadata: {
            annotations: { 'kubevirt.io/dump-name': name || null },
          },
        }),
        headers: { 'Content-Type': 'application/merge-patch+json' },
      });
      await fetchDumpPVCs();
      setEditingName(false);
    } catch (e) {
      enqueueSnackbar(`Failed to rename: ${safeError(e, 'renameDump')}`, { variant: 'error' });
    }
  };

  // Helper: wait for a resource to be fully gone (404)
  const waitForDeletion = (url: string, timeoutMs = 120000): Promise<void> => {
    return new Promise(resolve => {
      const interval = setInterval(async () => {
        try {
          await ApiProxy.request(url);
          // Still exists — keep waiting
        } catch {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 2000);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, timeoutMs);
    });
  };

  const deletePVC = async (pvcToDelete: string) => {
    setDeletingPVC(pvcToDelete);
    enqueueSnackbar(`Deleting ${pvcToDelete}...`, { variant: 'info' });
    try {
      // Also delete any analysis pod for this PVC — wait for it to be gone
      const podName = `vol3-${pvcToDelete}`;
      try {
        await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`, {
          method: 'DELETE',
          isJSON: false,
        });
        await waitForDeletion(`/api/v1/namespaces/${namespace}/pods/${podName}`);
      } catch {
        /* pod may not exist */
      }

      await ApiProxy.request(
        `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${pvcToDelete}`,
        {
          method: 'DELETE',
          isJSON: false,
        }
      );
      await waitForDeletion(
        `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${pvcToDelete}`
      );

      enqueueSnackbar(`Deleted ${pvcToDelete}`, { variant: 'success' });

      if (selectedDump === pvcToDelete) {
        setSelectedDump(null);
        setAnalysisPodName(null);
        setAnalysisPodStatus('none');
        setShowAnalysisTerminal(false);
      }

      // If this was the active dump, remove association
      if (dumpStatus?.claimName === pvcToDelete) {
        try {
          await removeDump();
        } catch {
          /* ignore */
        }
      }

      await fetchDumpPVCs();
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to delete PVC: ${safeError(e, 'deletePVC')}`, { variant: 'error' });
    } finally {
      setDeletingPVC(null);
    }
  };

  const launchAnalysisPod = async () => {
    if (!selectedDump) return;

    const podName = `vol3-${selectedDump}`;
    setAnalysisPodStatus('creating');

    // Build pod spec matching vol3-poc pattern
    const forensic = getForensicSettings();
    const initContainers: Array<{
      name: string;
      image: string;
      imagePullPolicy: string;
      command: string[];
      volumeMounts: Array<{ name: string; mountPath: string }>;
    }> = [];
    const volumes: Array<{
      name: string;
      persistentVolumeClaim?: { claimName: string; readOnly?: boolean };
      emptyDir?: Record<string, never>;
    }> = [
      {
        name: 'memdump',
        persistentVolumeClaim: {
          claimName: selectedDump,
          readOnly: true,
        },
      },
      {
        name: 'symbols',
        emptyDir: {},
      },
    ];
    const volumeMounts: Array<{ name: string; mountPath: string; readOnly?: boolean }> = [
      {
        name: 'memdump',
        mountPath: '/dump',
        readOnly: true,
      },
      {
        name: 'symbols',
        mountPath: '/usr/local/lib/python3.12/site-packages/volatility3/symbols/linux',
      },
    ];

    if (hasKernelInfo) {
      // Kernel detected via guest agent — add ISF init container to copy pre-built symbols
      const isfImage = `${forensic.isfRegistry}/${forensic.isfRepo}:${kernelRelease}${forensic.isfSuffix}`;
      const isfPullPolicy = forensic.isfRegistry.startsWith('localhost') ? 'Never' : 'IfNotPresent';
      initContainers.push({
        name: 'isf-init',
        image: isfImage,
        imagePullPolicy: isfPullPolicy,
        command: ['sh', '-c', 'cp /symbols/linux/*.json /vol3-symbols/'],
        volumeMounts: [{ name: 'symbols', mountPath: '/vol3-symbols' }],
      });
    }

    try {
      const pod = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: podName,
          namespace,
          labels: {
            app: 'volatility3-analysis',
            'kubevirt.io/vm': vmName,
            'kubevirt.io/memory-dump': selectedDump,
          },
        },
        spec: {
          ...(initContainers.length > 0 ? { initContainers } : {}),
          containers: [
            {
              name: 'vol3',
              image: forensic.toolboxImage,
              imagePullPolicy: forensic.toolboxImage.startsWith('localhost')
                ? 'Never'
                : 'IfNotPresent',
              command: ['sleep', 'infinity'],
              volumeMounts,
              securityContext: { runAsUser: 0 },
              env: [...(hasKernelInfo ? [{ name: 'KERNEL_RELEASE', value: kernelRelease }] : [])],
              resources: {
                requests: { cpu: '500m', memory: '4Gi' },
                limits: { cpu: '2', memory: '12Gi' },
              },
            },
          ],
          volumes,
          securityContext: { fsGroup: 107 },
          restartPolicy: 'Never',
        },
      };

      await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods`, {
        method: 'POST',
        body: JSON.stringify(pod),
        headers: { 'Content-Type': 'application/json' },
      });

      setAnalysisPodName(podName);
      setAnalysisPodContainer('vol3');
      enqueueSnackbar('Analysis pod created, waiting for it to start...', { variant: 'info' });
      pollAnalysisPod(podName);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('409') || errMsg.includes('already exists')) {
        setAnalysisPodName(podName);
        try {
          const existing = await ApiProxy.request(
            `/api/v1/namespaces/${namespace}/pods/${podName}`
          );
          setAnalysisPodContainer(existing?.spec?.containers?.[0]?.name || 'vol3');
        } catch {
          /* use default */
        }
        pollAnalysisPod(podName);
      } else {
        enqueueSnackbar(`Failed to create analysis pod: ${safeError(e, 'createAnalysisPod')}`, {
          variant: 'error',
        });
        setAnalysisPodStatus('failed');
      }
    }
  };

  const deleteAnalysisPod = async () => {
    if (!analysisPodName) return;
    const podToDelete = analysisPodName;
    setAnalysisPodStatus('deleting');
    setShowAnalysisTerminal(false);
    setTerminalEverOpened(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    try {
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podToDelete}`, {
        method: 'DELETE',
        isJSON: false,
      });
      enqueueSnackbar('Deleting analysis pod...', { variant: 'info' });

      // Clear any previous deletion poll
      if (deletionPollRef.current) clearInterval(deletionPollRef.current);
      if (deletionTimeoutRef.current) clearTimeout(deletionTimeoutRef.current);

      // Poll until pod is actually gone
      deletionPollRef.current = setInterval(async () => {
        try {
          const pod = await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podToDelete}`);
          const phase = pod?.status?.phase;
          if (phase === 'Terminating' || pod?.metadata?.deletionTimestamp) {
            // Still terminating — keep waiting
            return;
          }
        } catch {
          // 404 — pod is gone
          if (deletionPollRef.current) clearInterval(deletionPollRef.current);
          deletionPollRef.current = null;
          if (deletionTimeoutRef.current) clearTimeout(deletionTimeoutRef.current);
          deletionTimeoutRef.current = null;
          enqueueSnackbar('Analysis pod deleted', { variant: 'success' });
          setAnalysisPodName(null);
          setAnalysisPodStatus('none');
        }
      }, 2000);

      // Timeout after 2 minutes
      deletionTimeoutRef.current = setTimeout(() => {
        if (deletionPollRef.current) clearInterval(deletionPollRef.current);
        deletionPollRef.current = null;
        deletionTimeoutRef.current = null;
        setAnalysisPodStatus(prev => {
          if (prev === 'deleting') {
            setAnalysisPodName(null);
            enqueueSnackbar('Pod deletion timed out — it may still be terminating', {
              variant: 'warning',
            });
            return 'none';
          }
          return prev;
        });
      }, 120000);
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to delete analysis pod: ${safeError(e, 'deleteAnalysisPod')}`, {
        variant: 'error',
      });
      setAnalysisPodStatus('failed');
    }
  };

  // Cleanup deletion poll on unmount
  useEffect(() => {
    return () => {
      if (deletionPollRef.current) clearInterval(deletionPollRef.current);
      if (deletionTimeoutRef.current) clearTimeout(deletionTimeoutRef.current);
    };
  }, []);

  if (!hotplugEnabled) {
    return (
      <Alert severity="warning" icon={<Icon icon="mdi:memory" />}>
        Memory Dump requires the <strong>HotplugVolumes</strong> feature gate to be enabled in
        KubeVirt configuration.
      </Alert>
    );
  }

  const isInProgress = dumpStatus?.phase === 'InProgress';
  const selectedDumpPVC = dumpPVCs.find(d => d.name === selectedDump);
  const selectedIsCompleted = selectedDumpPVC?.isActive
    ? selectedDumpPVC.activePhase === 'Completed'
    : selectedDumpPVC?.phase === 'Bound'; // non-active PVCs with data are Bound
  const showTerminal = analysisPodStatus === 'running' && showAnalysisTerminal && !!analysisPodName;
  // Keep terminal mounted (display:none) once opened, so session survives tab switches
  const terminalMounted =
    terminalEverOpened && analysisPodStatus === 'running' && !!analysisPodName;
  useEffect(() => {
    if (showTerminal && !terminalEverOpened) setTerminalEverOpened(true);
  }, [showTerminal, terminalEverOpened]);

  // ─── Sidebar: Dump PVC item ──────────────────────────────────────
  const renderDumpItem = (dump: DumpPVC) => {
    const isSelected = selectedDump === dump.name;
    const isDeleting = deletingPVC === dump.name;
    // Resolve effective status
    const effectivePhase =
      dump.isActive && dump.activePhase
        ? dump.activePhase
        : dump.phase === 'Bound'
        ? 'Completed'
        : dump.phase;
    const effectiveIcon =
      dump.isActive && dump.activePhase
        ? getDumpPhaseIcon(dump.activePhase)
        : dump.phase === 'Bound'
        ? 'mdi:check-circle'
        : dump.phase === 'Pending'
        ? 'mdi:clock-outline'
        : 'mdi:help-circle-outline';
    const effectiveColor =
      dump.isActive && dump.activePhase
        ? getDumpPhaseColor(dump.activePhase)
        : dump.phase === 'Bound'
        ? getDumpPhaseColor('Completed')
        : getPVCPhaseColor(dump.phase);

    return (
      <Box
        key={dump.name}
        onClick={() => !isDeleting && setSelectedDump(dump.name)}
        sx={{
          p: 0.75,
          borderRadius: 1,
          cursor: isDeleting ? 'default' : 'pointer',
          border: '1px solid',
          borderColor: isSelected ? 'primary.main' : 'divider',
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          opacity: isDeleting ? 0.5 : 1,
          transition: 'all 0.15s',
          '&:hover': !isDeleting
            ? {
                bgcolor: isSelected ? 'action.selected' : 'action.hover',
                borderColor: isSelected ? 'primary.main' : 'text.secondary',
              }
            : undefined,
        }}
      >
        <Box display="flex" alignItems="center" gap={0.5}>
          <Tooltip title={effectivePhase} arrow placement="left">
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              <Icon icon={effectiveIcon} width={16} color={effectiveColor} />
            </Box>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {dump.displayName && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.7rem',
                  fontWeight: isSelected ? 600 : 500,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {dump.displayName}
              </Typography>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: '0.6rem',
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {dump.size} &middot; {dump.created ? new Date(dump.created).toLocaleString() : ''}
            </Typography>
          </Box>
          {isDeleting ? (
            <CircularProgress size={14} />
          ) : (
            <IconButton
              size="small"
              aria-label="Delete dump"
              onClick={e => {
                e.stopPropagation();
                setDeleteConfirmPVC(dump.name);
              }}
              sx={{ p: 0.25, flexShrink: 0 }}
            >
              <Icon icon="mdi:delete-outline" width={14} />
            </IconButton>
          )}
        </Box>
      </Box>
    );
  };

  // ─── Onboarding CTA: first dump creation ─────────────────────────
  const renderFirstDumpCTA = () => (
    <Box display="flex" alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ maxWidth: 520, textAlign: 'center' }}>
        <Icon icon="mdi:memory" width={56} style={{ opacity: 0.6 }} />
        <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
          Memory Forensics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
          Capture a full memory dump of the running VM and analyze it with{' '}
          <Tooltip title={`Image: ${getForensicSettings().toolboxImage}`} arrow placement="top">
            <span
              style={{
                fontWeight: 600,
                cursor: 'help',
                borderBottom: '1px dotted',
              }}
            >
              Volatility3
            </span>
          </Tooltip>{' '}
          directly inside the cluster. Detect rootkits, inspect processes, recover credentials, and
          audit kernel modules — all from a live or post-mortem dump.
        </Typography>

        <Box
          sx={{
            display: 'flex',
            gap: 2,
            mt: 2.5,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {[
            { icon: 'mdi:harddisk', text: `PVC: ${suggestedSize} (auto-sized)` },
            {
              icon: hasKernelInfo ? 'mdi:check-decagram' : 'mdi:alert-outline',
              text: hasKernelInfo
                ? `Kernel: ${kernelRelease}`
                : 'No guest agent — manual symbols needed',
              color: hasKernelInfo ? '#3e8635' : '#f0ab00',
            },
            { icon: 'mdi:shield-search', text: 'Process, network & malware analysis' },
            { icon: 'mdi:label-outline', text: 'Label dumps with friendly names' },
          ].map((item, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                bgcolor: 'action.hover',
                borderRadius: 1,
                px: 1.5,
                py: 0.75,
              }}
            >
              <Icon icon={item.icon} width={16} color={item.color} />
              <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                {item.text}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 3 }}>
          {isRunning ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Create your first memory dump using <strong>New Dump</strong> in the sidebar.
            </Typography>
          ) : (
            <Alert
              severity="info"
              icon={<Icon icon="mdi:information" width={18} />}
              sx={{ textAlign: 'left', justifyContent: 'center' }}
            >
              VM must be running to create a memory dump.
            </Alert>
          )}
        </Box>
      </Box>
    </Box>
  );

  // ─── Main content: selected dump details ─────────────────────────
  const renderMainContent = () => {
    if (!selectedDump || !selectedDumpPVC) {
      if (dumpPVCs.length === 0) {
        return renderFirstDumpCTA();
      }
      return (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, minHeight: 0 }}
        >
          <Box textAlign="center" sx={{ opacity: 0.5 }}>
            <Icon icon="mdi:cursor-default-click" width={48} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Select a dump from the sidebar to view details.
            </Typography>
          </Box>
        </Box>
      );
    }

    const dumpIsInProgress =
      selectedDumpPVC.isActive && selectedDumpPVC.activePhase === 'InProgress';
    const dumpIsCompleted = selectedIsCompleted;
    const dumpIsFailed = selectedDumpPVC.isActive && selectedDumpPVC.activePhase === 'Failed';

    return (
      <Box display="flex" flexDirection="column" gap={1.5} sx={{ flex: 1, minHeight: 0 }}>
        {/* Dump header — compact single line */}
        <Box display="flex" alignItems="center" gap={0.75} flexShrink={0}>
          <Tooltip
            title={
              selectedDumpPVC.isActive && selectedDumpPVC.activePhase
                ? selectedDumpPVC.activePhase
                : selectedDumpPVC.phase === 'Bound'
                ? 'Completed'
                : selectedDumpPVC.phase
            }
            arrow
          >
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              <Icon
                icon={
                  selectedDumpPVC.isActive
                    ? getDumpPhaseIcon(selectedDumpPVC.activePhase)
                    : selectedDumpPVC.phase === 'Bound'
                    ? 'mdi:check-circle'
                    : 'mdi:harddisk'
                }
                width={18}
                color={
                  selectedDumpPVC.isActive
                    ? getDumpPhaseColor(selectedDumpPVC.activePhase)
                    : selectedDumpPVC.phase === 'Bound'
                    ? getDumpPhaseColor('Completed')
                    : undefined
                }
              />
            </Box>
          </Tooltip>
          {editingName ? (
            <TextField
              size="small"
              value={editNameValue}
              onChange={e => setEditNameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveDumpName(selectedDump!, editNameValue);
                if (e.key === 'Escape') setEditingName(false);
              }}
              onBlur={() => saveDumpName(selectedDump!, editNameValue)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Display name..."
              InputProps={{ sx: { fontSize: '0.75rem', py: 0 } }}
              sx={{ width: 200 }}
            />
          ) : (
            <>
              <Typography
                variant="caption"
                fontWeight={600}
                sx={{ fontSize: '0.8rem', cursor: 'pointer' }}
                noWrap
                onClick={() => {
                  setEditNameValue(selectedDumpPVC.displayName || '');
                  setEditingName(true);
                }}
              >
                {selectedDumpPVC.displayName || selectedDump}
              </Typography>
              <Tooltip title="Rename" arrow>
                <IconButton
                  size="small"
                  aria-label="Rename dump"
                  onClick={() => {
                    setEditNameValue(selectedDumpPVC.displayName || '');
                    setEditingName(true);
                  }}
                  sx={{ p: 0.25 }}
                >
                  <Icon icon="mdi:pencil-outline" width={14} />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
            {selectedDumpPVC.size}
          </Typography>
          {selectedDumpPVC.created && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {new Date(selectedDumpPVC.created).toLocaleString()}
            </Typography>
          )}
          <Box flex={1} />
          {dumpIsCompleted && (
            <CopyableCommand
              command={`virtctl memory-dump download ${vmName} -n ${namespace} --output=dump.gz`}
            />
          )}
          {selectedDumpPVC.isActive && (dumpIsCompleted || dumpIsFailed) && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={removeDump}
              startIcon={<Icon icon="mdi:close-circle-outline" width={14} />}
              sx={{ fontSize: '0.7rem', py: 0.25 }}
            >
              Deselect
            </Button>
          )}
        </Box>

        {dumpIsInProgress && <LinearProgress sx={{ borderRadius: 1, flexShrink: 0 }} />}

        {dumpStatus?.message && selectedDumpPVC.isActive && (
          <Alert severity={dumpIsFailed ? 'error' : 'info'} sx={{ flexShrink: 0 }}>
            {dumpStatus.message}
          </Alert>
        )}

        {/* Forensic Analysis section */}
        {dumpIsCompleted && (
          <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
            {/* Pre-launch landing page */}
            {analysisPodStatus === 'none' && (
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                sx={{ flex: 1, minHeight: 0 }}
              >
                <Box sx={{ maxWidth: 540, textAlign: 'center' }}>
                  <Icon icon="mdi:flask" width={48} style={{ opacity: 0.6 }} />
                  <Typography variant="h6" sx={{ mt: 1, fontWeight: 700, fontSize: '1rem' }}>
                    Forensic Analysis Pod
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.75, lineHeight: 1.6 }}
                  >
                    Launch a{' '}
                    <Tooltip title={getForensicSettings().toolboxImage} arrow placement="top">
                      <span style={{ fontWeight: 600, cursor: 'help', borderBottom: '1px dotted' }}>
                        Volatility3
                      </span>
                    </Tooltip>{' '}
                    pod with the dump volume mounted at <code>/dump</code>.
                    {hasKernelInfo
                      ? ` ISF symbols for ${kernelRelease} will be auto-mounted via init container.`
                      : ' Symbols will need to be provided manually (no guest agent).'}
                  </Typography>

                  {/* Kernel status inline */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      mt: 2,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      px: 2,
                      py: 1,
                    }}
                  >
                    <Icon
                      icon={hasKernelInfo ? 'mdi:check-decagram' : 'mdi:alert-outline'}
                      width={18}
                      color={hasKernelInfo ? '#3e8635' : '#f0ab00'}
                    />
                    <Typography variant="caption" sx={{ fontSize: '0.8rem' }}>
                      {hasKernelInfo ? (
                        <>
                          Kernel: <strong>{kernelRelease}</strong> — ISF image:{' '}
                          <code style={{ fontSize: '0.7rem' }}>
                            {getForensicSettings().isfRegistry}/{getForensicSettings().isfRepo}:
                            {kernelRelease}
                            {getForensicSettings().isfSuffix}
                          </code>
                        </>
                      ) : (
                        <Tooltip
                          title="QEMU Guest Agent is not connected. Kernel cannot be detected automatically — you will need to provide vmlinux or ISF symbols manually."
                          arrow
                          placement="top"
                        >
                          <span style={{ cursor: 'help' }}>
                            Kernel: <strong>N/A</strong>{' '}
                            <Icon
                              icon="mdi:information-outline"
                              width={14}
                              style={{ verticalAlign: 'middle', opacity: 0.7 }}
                            />
                          </span>
                        </Tooltip>
                      )}
                    </Typography>
                  </Box>

                  {/* Feature hints */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 1.5,
                      mt: 2.5,
                      textAlign: 'left',
                    }}
                  >
                    {[
                      { icon: 'mdi:console', text: 'Interactive shell with vol-qemu wrapper' },
                      {
                        icon: 'mdi:book-open-variant',
                        text: 'Command reference sidebar with click-to-run',
                      },
                      { icon: 'mdi:rename', text: 'Rename dumps with friendly labels' },
                      {
                        icon: 'mdi:delete-clock',
                        text: 'Cleanup prompt on close — or keep pod for later',
                      },
                    ].map((hint, i) => (
                      <Box
                        key={i}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75 }}
                      >
                        <Icon icon={hint.icon} width={18} style={{ opacity: 0.6, flexShrink: 0 }} />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontSize: '0.85rem' }}
                        >
                          {hint.text}
                        </Typography>
                      </Box>
                    ))}
                  </Box>

                  <Button
                    variant="contained"
                    onClick={launchAnalysisPod}
                    startIcon={<Icon icon="mdi:flask-outline" width={20} />}
                    sx={{ mt: 3, px: 4, py: 1 }}
                  >
                    Launch Analysis Pod
                  </Button>
                </Box>
              </Box>
            )}

            {analysisPodStatus === 'creating' && (
              <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
                <CircularProgress size={16} />
                <Typography variant="body2">Creating analysis pod...</Typography>
                <Box flex={1} />
                {analysisPodName && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={deleteAnalysisPod}
                    startIcon={<Icon icon="mdi:cancel" width={14} />}
                    sx={{ fontSize: '0.75rem' }}
                  >
                    Cancel
                  </Button>
                )}
              </Box>
            )}

            {analysisPodStatus === 'waiting' && (
              <Box display="flex" flexDirection="column" gap={1} flexShrink={0}>
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">Waiting for analysis pod...</Typography>
                  {analysisPodDetail && (
                    <Chip
                      label={analysisPodDetail}
                      size="small"
                      variant="outlined"
                      color="warning"
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                    />
                  )}
                  <Box flex={1} />
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={deleteAnalysisPod}
                    startIcon={<Icon icon="mdi:cancel" width={14} />}
                    sx={{ fontSize: '0.75rem' }}
                  >
                    Cancel
                  </Button>
                </Box>
                <LinearProgress sx={{ borderRadius: 1 }} />
              </Box>
            )}

            {analysisPodStatus === 'failed' && (
              <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
                <Alert severity="error" sx={{ py: 0.5, flex: 1 }}>
                  Analysis pod failed or was terminated.
                  {analysisPodDetail ? ` (${analysisPodDetail})` : ''}
                </Alert>
                <Button
                  size="small"
                  variant="contained"
                  onClick={launchAnalysisPod}
                  startIcon={<Icon icon="mdi:restart" width={16} />}
                >
                  Retry
                </Button>
                {analysisPodName && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    onClick={deleteAnalysisPod}
                    startIcon={<Icon icon="mdi:delete" width={16} />}
                  >
                    Cleanup
                  </Button>
                )}
              </Box>
            )}

            {analysisPodStatus === 'deleting' && (
              <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
                <CircularProgress size={16} />
                <Typography variant="body2">Deleting analysis pod...</Typography>
              </Box>
            )}

            {analysisPodStatus === 'running' && !showAnalysisTerminal && (
              <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowAnalysisTerminal(true)}
                  startIcon={<Icon icon="mdi:console" width={16} />}
                >
                  Open Terminal
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={() => setShowDeletePodConfirm(true)}
                  startIcon={<Icon icon="mdi:delete" width={14} />}
                >
                  Delete Pod
                </Button>
              </Box>
            )}

            {terminalMounted && (
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: showTerminal ? 'flex' : 'none',
                  flexDirection: 'column',
                  gap: 0,
                }}
              >
                {/* Unified title bar */}
                <Box
                  display="flex"
                  alignItems="center"
                  gap={0.75}
                  sx={{
                    px: 1.5,
                    py: 0.5,
                    bgcolor: 'action.hover',
                    borderRadius: '4px 4px 0 0',
                    flexShrink: 0,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    minHeight: 32,
                  }}
                >
                  {/* Left: kernel info */}
                  <Tooltip
                    title={
                      hasKernelInfo
                        ? `ISF: ${getForensicSettings().isfRegistry}/${
                            getForensicSettings().isfRepo
                          }:${kernelRelease}${getForensicSettings().isfSuffix}`
                        : 'QEMU Guest Agent not available — kernel not detected'
                    }
                    arrow
                    placement="top"
                  >
                    <Box display="flex" alignItems="center" gap={0.5} sx={{ cursor: 'help' }}>
                      <Icon
                        icon={hasKernelInfo ? 'mdi:check-circle' : 'mdi:alert-outline'}
                        width={13}
                        color={hasKernelInfo ? '#3e8635' : '#f0ab00'}
                      />
                      <Typography
                        variant="caption"
                        sx={{ fontSize: '0.7rem', fontFamily: 'monospace' }}
                      >
                        {hasKernelInfo ? kernelRelease : 'N/A'}
                      </Typography>
                    </Box>
                  </Tooltip>

                  {/* Center: status + pod identity */}
                  <Box flex={1} />
                  <Box display="flex" alignItems="center" gap={0.75}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor:
                          terminalStatus === 'connected'
                            ? '#3e8635'
                            : terminalStatus === 'connecting'
                            ? '#f0ab00'
                            : '#c9190b',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 500 }}
                    >
                      {terminalStatus}
                    </Typography>
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
                    <Icon icon="mdi:flask" width={14} style={{ opacity: 0.7 }} />
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 600 }}
                    >
                      vol3 @ {analysisPodName}
                    </Typography>
                    {terminalStatus === 'disconnected' && (
                      <Tooltip title="Reconnect" arrow>
                        <IconButton
                          size="small"
                          aria-label="Reconnect"
                          onClick={() => terminalRef.current?.reconnect()}
                          sx={{ p: 0.25 }}
                        >
                          <Icon icon="mdi:refresh" width={14} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  <Box flex={1} />

                  {/* Right: window controls */}
                  {analysisPodDetail && (
                    <Chip
                      label={analysisPodDetail}
                      size="small"
                      variant="outlined"
                      color="warning"
                      sx={{ fontFamily: 'monospace', fontSize: '0.6rem', height: 18 }}
                    />
                  )}
                  <Tooltip title="Command Reference" arrow>
                    <IconButton
                      size="small"
                      aria-label="Toggle command reference"
                      onClick={() => setShowCmdRef(!showCmdRef)}
                      sx={{
                        p: 0.25,
                        bgcolor: showCmdRef ? 'action.selected' : undefined,
                        borderRadius: 0.5,
                      }}
                    >
                      <Icon icon="mdi:help-circle-outline" width={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Fullscreen" arrow>
                    <IconButton
                      size="small"
                      aria-label="Toggle fullscreen"
                      onClick={() => terminalRef.current?.toggleFullscreen()}
                      sx={{ p: 0.25, borderRadius: 0.5 }}
                    >
                      <Icon icon="mdi:fullscreen" width={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Close & delete pod" arrow>
                    <IconButton
                      size="small"
                      aria-label="Close and delete analysis pod"
                      onClick={() => setShowDeletePodConfirm(true)}
                      sx={{ p: 0.25, borderRadius: 0.5, color: 'error.main' }}
                    >
                      <Icon icon="mdi:close" width={16} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Terminal + sidebar */}
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1.5 }}>
                  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <PodExecTerminal
                      ref={terminalRef}
                      podName={analysisPodName!}
                      namespace={namespace}
                      container={analysisPodContainer}
                      connectMessage="Connecting to Volatility3 analysis pod... Dump is at /dump/"
                      hideToolbar
                      onStatusChange={setTerminalStatus}
                    />
                  </Box>

                  {/* Command Reference sidebar */}
                  {showCmdRef && (
                    <Box
                      sx={{
                        width: 280,
                        flexShrink: 0,
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                        zIndex: 2,
                      }}
                    >
                      <Box
                        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
                      >
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <Icon icon="mdi:flask" width={16} />
                          <Typography
                            variant="subtitle2"
                            fontWeight={700}
                            sx={{ fontSize: '0.8rem' }}
                          >
                            Forensic Commands
                          </Typography>
                          <Box flex={1} />
                          <IconButton
                            size="small"
                            aria-label="Close forensic commands"
                            onClick={() => setShowCmdRef(false)}
                            sx={{ p: 0.25 }}
                          >
                            <Icon icon="mdi:close" width={16} />
                          </IconButton>
                        </Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontSize: '0.7rem' }}
                        >
                          Click to execute, copy icon to clipboard
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                        {getForensicCommands().map((group, idx) => (
                          <Box key={group.category}>
                            {idx > 0 && <Divider sx={{ my: 0.75 }} />}
                            <Typography
                              variant="caption"
                              fontWeight={700}
                              color="text.secondary"
                              sx={{
                                textTransform: 'uppercase',
                                fontSize: '0.6rem',
                                letterSpacing: 0.5,
                                display: 'block',
                                mb: 0.5,
                              }}
                            >
                              {group.category}
                            </Typography>
                            <Box display="flex" flexDirection="column" gap={0.5}>
                              {group.commands.map(cmd => (
                                <ForensicCommandChip
                                  key={cmd.label}
                                  cmd={cmd}
                                  onExec={command => {
                                    terminalRef.current?.inject(command + '\n');
                                  }}
                                />
                              ))}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
                {/* close Terminal + sidebar flex row */}
              </Box>
            )}
          </Box>
        )}

        {/* Not completed — show waiting state for non-active dumps */}
        {!dumpIsCompleted && !dumpIsInProgress && !dumpIsFailed && !selectedDumpPVC.isActive && (
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            sx={{ flex: 1, opacity: 0.5 }}
          >
            <Icon icon="mdi:harddisk" width={40} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              This PVC exists but has no active dump association.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              You can delete it from the sidebar or reuse its name for a new dump.
            </Typography>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box display="flex" gap={1.5} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* ─── Main content area ─── */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: showTerminal ? 'hidden' : 'auto',
        }}
      >
        {renderMainContent()}
      </Box>

      {/* ─── Right sidebar ─── */}
      <Box
        sx={{
          width: sidebarOpen ? 280 : 40,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          transition: 'width 0.2s ease',
        }}
      >
        {/* Sidebar header */}
        <Box
          sx={{
            px: sidebarOpen ? 1.5 : 0.5,
            py: 0.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarOpen ? 'flex-start' : 'center',
            gap: 0.5,
          }}
        >
          <Tooltip title={sidebarOpen ? 'Collapse' : 'Memory Dumps'} arrow placement="left">
            <IconButton
              size="small"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              sx={{ p: 0.25 }}
              aria-label="Toggle sidebar"
            >
              <Icon icon={sidebarOpen ? 'mdi:chevron-right' : 'mdi:memory'} width={18} />
            </IconButton>
          </Tooltip>
          {sidebarOpen && (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.8rem' }}>
                Memory Dumps
              </Typography>
              <Box flex={1} />
              <Chip
                label={dumpPVCs.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
              <Tooltip title="Refresh" arrow>
                <IconButton
                  size="small"
                  onClick={() => fetchDumpPVCs()}
                  sx={{ p: 0.25 }}
                  aria-label="Refresh dumps"
                >
                  <Icon icon="mdi:refresh" width={16} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>

        {/* Dump list */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            p: sidebarOpen ? 1 : 0,
            display: sidebarOpen ? 'flex' : 'none',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          {dumpPVCs.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 3, opacity: 0.5 }}>
              <Icon icon="mdi:package-variant" width={32} />
              <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                No dumps found
              </Typography>
            </Box>
          )}
          {dumpPVCs.map(dump => renderDumpItem(dump))}
        </Box>

        {sidebarOpen && <Divider />}

        {/* New dump section */}
        <Box sx={{ p: 1.5, display: sidebarOpen ? 'block' : 'none' }}>
          {!showNewDumpForm ? (
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {
                setPvcName(`${vmName}-memdump-${Date.now().toString(36)}`);
                setDumpDisplayName('');
                setShowNewDumpForm(true);
              }}
              disabled={!isRunning || isInProgress}
              startIcon={<Icon icon="mdi:plus" width={16} />}
              sx={{ fontSize: '0.8rem' }}
            >
              New Dump
            </Button>
          ) : (
            <Box display="flex" flexDirection="column" gap={1}>
              <Box display="flex" alignItems="center" gap={0.5}>
                <Icon icon="mdi:plus-circle" width={16} />
                <Typography variant="caption" fontWeight={700}>
                  New Memory Dump
                </Typography>
                <Box flex={1} />
                <IconButton
                  size="small"
                  onClick={() => setShowNewDumpForm(false)}
                  sx={{ p: 0.25 }}
                  aria-label="Close new dump form"
                >
                  <Icon icon="mdi:close" width={14} />
                </IconButton>
              </Box>
              <Box display="flex" alignItems="center" gap={0.5}>
                <Chip
                  icon={<Icon icon="mdi:memory" width={12} />}
                  label={vmMemory}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.5 } }}
                />
                <Chip
                  icon={<Icon icon="mdi:harddisk" width={12} />}
                  label={`PVC: ${suggestedSize}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.5 } }}
                />
              </Box>
              <TextField
                label="Display Name (optional)"
                value={dumpDisplayName}
                onChange={e => setDumpDisplayName(e.target.value)}
                size="small"
                fullWidth
                placeholder="e.g. Pre-upgrade snapshot"
                InputProps={{ sx: { fontSize: '0.75rem' } }}
                InputLabelProps={{ sx: { fontSize: '0.8rem' } }}
              />
              <TextField
                label="PVC Name"
                value={pvcName}
                onChange={e => setPvcName(e.target.value)}
                size="small"
                fullWidth
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                InputLabelProps={{ sx: { fontSize: '0.8rem' } }}
              />
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontSize: '0.8rem' }}>Storage Class</InputLabel>
                <Select
                  value={selectedSC}
                  onChange={e => setSelectedSC(e.target.value)}
                  label="Storage Class"
                  sx={{ fontSize: '0.8rem' }}
                >
                  {storageClasses.map(sc => (
                    <MenuItem key={sc} value={sc} sx={{ fontSize: '0.8rem' }}>
                      {sc}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={triggerDump}
                disabled={loading || !pvcName.trim() || !isRunning}
                startIcon={
                  loading ? (
                    <CircularProgress size={14} />
                  ) : (
                    <Icon icon="mdi:download-circle" width={16} />
                  )
                }
                fullWidth
                sx={{ fontSize: '0.8rem' }}
              >
                {loading ? 'Dumping...' : 'Dump'}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Delete PVC confirmation */}
      <ConfirmDialog
        open={!!deleteConfirmPVC}
        title={`Delete ${deleteConfirmPVC}?`}
        message={`This will permanently delete the PVC "${deleteConfirmPVC}" and any associated analysis pod. This action cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteConfirmPVC(null)}
        onConfirm={async () => {
          const pvc = deleteConfirmPVC;
          setDeleteConfirmPVC(null);
          if (pvc) await deletePVC(pvc);
        }}
      />

      {/* Delete analysis pod confirmation */}
      <ConfirmDialog
        open={showDeletePodConfirm}
        title="Delete analysis pod?"
        message={`This will delete the Volatility3 analysis pod "${
          analysisPodName || ''
        }". Any running forensic commands will be terminated.`}
        confirmLabel="Delete Pod"
        onCancel={() => setShowDeletePodConfirm(false)}
        onConfirm={() => {
          setShowDeletePodConfirm(false);
          deleteAnalysisPod();
        }}
      />
    </Box>
  );
}
