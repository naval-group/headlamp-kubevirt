import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  alpha,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataVolumeTemplate, KubeCondition, VMVolume } from '../../types';
import { getGuestfsSettings } from '../../utils/pluginSettings';
import { safeError } from '../../utils/sanitize';
import { humanSize } from '../../utils/size';
import { findCondition, getInspectorStatusColor } from '../../utils/statusColors';
import ConfirmDialog from '../common/ConfirmDialog';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import { TerminalPanel, TerminalPanelHandle } from '../VMConsole/VMConsole';
import CommandChip, { CommandDef } from './CommandChip';
import { GUESTFS_LABEL, INSPECTOR_IMAGE } from './constants';

interface GuestfsTabProps {
  vmName: string;
  namespace: string;
  vmItem?: VirtualMachine | null;
}

interface VMDisk {
  name: string;
  pvcName: string;
  type: 'pvc' | 'dataVolume';
  size?: string;
  volumeMode?: string;
}

type InspectorStatus = 'idle' | 'creating' | 'pending' | 'running' | 'failed' | 'deleting';

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 300000;

/** Map index to device letter: 0→vdb, 1→vdc, ..., max 24 (vdz). */
function devLetter(i: number): string {
  if (i < 0 || i > 24) return '?';
  return String.fromCharCode(98 + i); // 98 = 'b'
}

// ── Command reference ──────────────────────────────────────────

function getInspectorCommands(
  attachedDisks: Array<{ pvcName: string; dev: string; serial: string }>,
  rootPart: string,
  vmName?: string
): Array<{ category: string; hint?: string; commands: CommandDef[] }> {
  const p = rootPart || (attachedDisks.length > 0 ? `/dev/${attachedDisks[0].dev}4` : '/dev/vdb4');
  // Strip VM name prefix from PVC names for shorter labels
  const shortName = (pvc: string) => {
    if (vmName && pvc.startsWith(vmName + '-')) return pvc.slice(vmName.length + 1);
    return pvc;
  };

  return [
    {
      category: 'Discover',
      hint: 'Identify partitions, then set root partition above',
      commands: [
        {
          label: 'All devices',
          command: 'lsblk',
          description: 'List all block devices and partitions visible to the inspector pod',
        },
        ...attachedDisks.map(d => ({
          label: `Partitions (${shortName(d.pvcName)})`,
          command: `fdisk -l /dev/${d.dev}`,
          description: 'Partition table: sizes, types, and sector layout for this disk',
        })),
        ...attachedDisks.map(d => ({
          label: `Block IDs (${shortName(d.pvcName)})`,
          command: `blkid /dev/${d.dev}*`,
          description: 'Filesystem UUIDs, labels, and types for all partitions on this disk',
        })),
        {
          label: 'Partition labels',
          command: 'ls -la /dev/disk/by-partlabel/ 2>/dev/null',
          description: 'GPT partition labels — useful for identifying partitions by name',
        },
        {
          label: 'Disk by-id',
          command: 'ls -la /dev/disk/by-id/',
          description: 'Persistent device identifiers — stable names that survive reboots',
        },
      ],
    },
    {
      category: 'Mount',
      hint: 'Mount a partition from the attached disk',
      commands: [
        {
          label: 'Mount (RO)',
          command: `mount -o ro ${p} /mnt/disk && echo "Mounted ${p} at /mnt/disk"`,
          description:
            'Mount the selected partition read-only at /mnt/disk — safe, no changes to data',
        },
        {
          label: 'Mount (RW)',
          command: `mount ${p} /mnt/disk && echo "Mounted ${p} at /mnt/disk"`,
          description:
            'Mount the selected partition read-write at /mnt/disk — allows modifications',
        },
        {
          label: 'List btrfs subvols',
          command: `d=$(mktemp -d); mount -o ro ${p} $d 2>/dev/null && for e in $d/*/; do i=$(stat -c %i "$e" 2>/dev/null); [ "$i" = "256" ] && echo "  subvol: $(basename $e)"; done; umount $d 2>/dev/null; rmdir $d`,
          description: 'Detect btrfs subvolumes on the partition (Fedora CoreOS, openSUSE)',
        },
        {
          label: 'Mount subvol=root',
          command: `mount -o subvol=root ${p} /mnt/disk && echo "Mounted ${p} subvol=root at /mnt/disk"`,
          description: "Mount the 'root' btrfs subvolume — needed for Fedora CoreOS and similar",
        },
        {
          label: 'Unmount',
          command: 'umount /mnt/disk',
          description: 'Unmount /mnt/disk before switching partitions or detaching',
        },
        {
          label: 'Chroot',
          command: 'chroot /mnt/disk /bin/sh',
          description: 'Enter the mounted filesystem as root — run commands as if booted from it',
        },
      ],
    },
    {
      category: 'Browse',
      hint: 'After mounting — standard shell commands',
      commands: [
        {
          label: 'List /',
          command: 'ls -la /mnt/disk/',
          description: 'Show all top-level directories on the mounted filesystem',
        },
        {
          label: 'List /etc',
          command: 'ls -la /mnt/disk/etc/',
          description: 'Show configuration files — useful for checking system settings',
        },
        {
          label: 'Cat passwd',
          command: 'cat /mnt/disk/etc/passwd',
          description: 'Show user accounts defined in the guest OS',
        },
        {
          label: 'OS Release',
          command: 'cat /mnt/disk/etc/os-release',
          description: 'Show the OS name, version, and variant',
        },
        {
          label: 'Find configs',
          command: 'find /mnt/disk/etc -name "*.conf" | head -50',
          description: 'Search for all .conf files in /etc — find configuration files quickly',
        },
        {
          label: 'Disk usage',
          command: 'du -sh /mnt/disk/*',
          description: 'Show how much space each top-level directory uses',
        },
      ],
    },
    {
      category: 'Inspect',
      commands: [
        {
          label: 'SSH Keys',
          command: 'cat /mnt/disk/root/.ssh/authorized_keys',
          description: 'Show authorized SSH public keys for root — verify access configuration',
        },
        {
          label: 'Bash History',
          command: 'cat /mnt/disk/root/.bash_history',
          description: "Show root's command history — useful for debugging and auditing",
        },
        {
          label: 'Shadow File',
          command: 'cat /mnt/disk/etc/shadow',
          description: 'Show password hashes — verify accounts have passwords set (or locked)',
        },
        {
          label: 'Auth Log',
          command: 'tail -200 /mnt/disk/var/log/auth.log',
          description: 'Recent authentication events: logins, failures, sudo usage',
        },
        {
          label: 'Crontabs',
          command: 'ls -laR /mnt/disk/var/spool/cron/',
          description: 'Scheduled tasks — check for unexpected or malicious cron jobs',
        },
        {
          label: 'Last logins',
          command: 'last -f /mnt/disk/var/log/wtmp 2>/dev/null || echo "No wtmp"',
          description: 'Login history from wtmp — who logged in, when, and from where',
        },
      ],
    },
  ];
}

// ── Main component ─────────────────────────────────────────────

export default function GuestfsTab({ vmName, namespace, vmItem }: GuestfsTabProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [disks, setDisks] = useState<VMDisk[]>([]);
  const [selectedDisks, setSelectedDisks] = useState<string[]>([]);
  const [vmiName, setVmiName] = useState<string | null>(null);
  const [vmiStatus, setVmiStatus] = useState<InspectorStatus>('idle');
  const [vmiDetail, setVmiDetail] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [terminalStatus, setTerminalStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    'disconnected'
  );
  const [showCmdRef, setShowCmdRef] = useState(false);
  const [rootPartition, setRootPartition] = useState('');
  const [copyVmScheduling, setCopyVmScheduling] = useState(false);
  const [vmiItem, setVmiItem] = useState<InstanceType<typeof VirtualMachineInstance> | null>(null);

  const terminalRef = useRef<TerminalPanelHandle>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the disk→device mapping for attached disks
  const attachedDisks = selectedDisks.map((pvcName, i) => ({
    pvcName,
    dev: `vd${devLetter(i)}`,
    serial: `DISK_${i}`,
  }));

  // Memoize validation regexes for root partition input
  const partitionValidation = useMemo(() => {
    const devNames = attachedDisks.map(d => d.dev).join('|');
    return {
      partial: new RegExp(`^/dev/(${devNames})[0-9]*$`),
      complete: new RegExp(`^/dev/(${devNames})[0-9]+$`),
      devNames,
    };
  }, [attachedDisks.map(d => d.dev).join(',')]);

  // Extract PVC-backed disks
  useEffect(() => {
    if (!vmItem) return;
    const spec = vmItem.jsonData?.spec?.template?.spec;
    const volumes: VMVolume[] = spec?.volumes || [];
    const dvTemplates: DataVolumeTemplate[] = vmItem.jsonData?.spec?.dataVolumeTemplates || [];
    const extracted: VMDisk[] = [];

    for (const vol of volumes) {
      if (vol.persistentVolumeClaim?.claimName) {
        extracted.push({
          name: vol.name,
          pvcName: vol.persistentVolumeClaim.claimName,
          type: 'pvc',
        });
      } else if (vol.dataVolume?.name) {
        extracted.push({ name: vol.name, pvcName: vol.dataVolume.name, type: 'dataVolume' });
      }
    }
    for (const dvt of dvTemplates) {
      const dvName = dvt.metadata?.name;
      if (dvName && !extracted.some(d => d.pvcName === dvName)) {
        extracted.push({ name: dvName, pvcName: dvName, type: 'dataVolume' });
      }
    }

    const abortController = new AbortController();

    (async () => {
      await Promise.all(
        extracted.map(async d => {
          try {
            const pvc = await ApiProxy.request(
              `/api/v1/namespaces/${encodeURIComponent(
                namespace
              )}/persistentvolumeclaims/${encodeURIComponent(d.pvcName)}`
            );
            d.size = humanSize(pvc?.spec?.resources?.requests?.storage) || '?';
            d.volumeMode = pvc?.spec?.volumeMode || 'Filesystem';
          } catch {
            d.size = '?';
            d.volumeMode = 'Filesystem';
          }
        })
      );
      if (abortController.signal.aborted) return;
      setDisks([...extracted]);
      // Select all disks by default
      if (extracted.length > 0) {
        setSelectedDisks(prev => (prev.length > 0 ? prev : extracted.map(d => d.pvcName)));
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [vmItem, namespace]);

  const pollVMI = useCallback(
    (name: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      setVmiDetail('');

      pollRef.current = setInterval(async () => {
        try {
          const vmi = await ApiProxy.request(
            `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
              namespace
            )}/virtualmachineinstances/${encodeURIComponent(name)}`
          );
          const phase = vmi?.status?.phase;
          setVmiDetail(phase === 'Scheduling' || phase === 'Scheduled' ? phase : '');

          if (phase === 'Running') {
            setVmiStatus('running');
            setVmiDetail('');
            const vmiObj = new VirtualMachineInstance(vmi);
            setVmiItem(vmiObj);

            if (pollRef.current) clearInterval(pollRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          } else if (phase === 'Failed' || phase === 'Unknown') {
            const reason =
              findCondition<KubeCondition>(vmi?.status?.conditions, 'Ready')?.message || phase;
            setVmiStatus('failed');
            setVmiDetail(reason || '');
            if (pollRef.current) clearInterval(pollRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
            enqueueSnackbar(`Inspector VM failed: ${reason}`, { variant: 'error' });
          }
        } catch {
          setVmiStatus('idle');
          setVmiName(null);
          setVmiDetail('');
          if (pollRef.current) clearInterval(pollRef.current);
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        }
      }, POLL_INTERVAL);

      pollTimeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        setVmiStatus(prev => {
          if (prev === 'pending' || prev === 'creating') {
            setVmiDetail('Timed out');
            return 'failed';
          }
          return prev;
        });
      }, POLL_TIMEOUT);
    },
    [namespace, enqueueSnackbar]
  );

  // Check for existing VMI
  useEffect(() => {
    const abortController = new AbortController();

    (async () => {
      try {
        const vmiRes = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
            namespace
          )}/virtualmachineinstances?labelSelector=app%3D${GUESTFS_LABEL}%2Ckubevirt.io%2Fvm%3D${encodeURIComponent(
            vmName
          )}`
        );
        if (abortController.signal.aborted) return;
        const vmis = (vmiRes?.items || []).filter(
          (v: {
            metadata: { name: string; deletionTimestamp?: string };
            status?: { phase?: string };
          }) => !v.metadata.deletionTimestamp
        );
        if (vmis.length > 0) {
          const existing = vmis[0];
          setVmiName(existing.metadata.name);
          const phase = existing.status?.phase;
          if (phase === 'Running') {
            setVmiStatus('running');
            setVmiItem(new VirtualMachineInstance(existing));
          } else if (phase === 'Scheduling' || phase === 'Scheduled' || phase === 'Pending') {
            setVmiStatus('pending');
            pollVMI(existing.metadata.name);
          } else {
            setVmiStatus('failed');
          }
          return;
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      abortController.abort();
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (deletePollRef.current) clearInterval(deletePollRef.current);
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    };
  }, [namespace, vmName, pollVMI]);

  const createInspectorVMI = async () => {
    if (selectedDisks.length === 0) return;

    const name = `inspector-vm-${vmName}`
      .substring(0, 63)
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+$/, '');
    setVmiStatus('creating');
    setVmiDetail('');

    let nodeSelector;
    let tolerations;
    let affinity;
    if (copyVmScheduling && vmItem) {
      const ts = vmItem.jsonData?.spec?.template?.spec;
      nodeSelector = ts?.nodeSelector;
      tolerations = ts?.tolerations;
      affinity = ts?.affinity;
    }

    // Build disk and volume arrays for all selected PVCs
    const diskSpecs: Array<{ name: string; disk?: { bus: string }; serial?: string }> = [
      { name: 'boot', disk: { bus: 'virtio' } },
    ];
    const inspectorImage = getGuestfsSettings().image || INSPECTOR_IMAGE;
    const volumeSpecs: Array<{
      name: string;
      containerDisk?: { image: string };
      persistentVolumeClaim?: { claimName: string };
      cloudInitNoCloud?: { userData: string };
    }> = [{ name: 'boot', containerDisk: { image: inspectorImage } }];

    selectedDisks.forEach((pvcName, i) => {
      const diskName = `disk-${i}`;
      const serial = `DISK_${i}`;
      diskSpecs.push({ name: diskName, disk: { bus: 'virtio' }, serial });
      volumeSpecs.push({ name: diskName, persistentVolumeClaim: { claimName: pvcName } });
    });

    diskSpecs.push({ name: 'cloudinitdisk', disk: { bus: 'virtio' } });

    // Build cloud-init with multi-disk motd
    const diskMapping = selectedDisks
      .map((pvcName, i) => `      /dev/vd${devLetter(i)} -- ${pvcName} (serial: DISK_${i})`)
      .join('\n');

    const profileDiskInfo = selectedDisks
      .map((pvcName, i) => {
        const serial = `DISK_${i}`;
        const dev = `vd${devLetter(i)}`;
        return [
          `    BYID="/dev/disk/by-id/virtio-${serial}"`,
          `    if [ -e "$BYID" ]; then`,
          `      REAL=$(readlink -f "$BYID")`,
          `      echo "  /dev/${dev} -- ${pvcName}:"`,
          `      lsblk "$REAL" 2>/dev/null`,
          `      echo ""`,
          `    fi`,
        ].join('\n');
      })
      .join('\n');

    const cloudInitUserData = [
      '#cloud-config',
      'password: inspector',
      'chpasswd: { expire: false }',
      'ssh_pwauth: false',
      'runcmd:',
      '  - mkdir -p /mnt/disk',
      '  - sed -i "s|^ttyS0:.*|ttyS0::respawn:/sbin/agetty --autologin root -s 115200 ttyS0 vt100|" /etc/inittab',
      '  - sed -i "s|^tty1:.*|tty1::respawn:/sbin/agetty --autologin root 38400 tty1|" /etc/inittab',
      `  - |`,
      `    cat > /etc/motd << 'MOTD'`,
      `    `,
      `      Disk Inspector -- ${vmName}`,
      `      ${selectedDisks.length} disk(s) attached:`,
      diskMapping,
      `    `,
      `    MOTD`,
      `  - |`,
      `    cat >> /root/.profile << 'PROF'`,
      `    clear`,
      `    export TERM=xterm-256color LANG=C.UTF-8`,
      `    stty cols 200 rows 50 2>/dev/null`,
      profileDiskInfo,
      `    if [ -d /dev/disk/by-partlabel ]; then`,
      `      echo "  Partition labels:"`,
      `      ls -1 /dev/disk/by-partlabel/ 2>/dev/null | while read l; do`,
      `        echo "    $l -> $(readlink -f /dev/disk/by-partlabel/$l)"`,
      `      done`,
      `      echo ""`,
      `    fi`,
      `    PROF`,
      '  - kill -HUP 1',
    ].join('\n');

    volumeSpecs.push({ name: 'cloudinitdisk', cloudInitNoCloud: { userData: cloudInitUserData } });

    const vmiSpec = {
      apiVersion: 'kubevirt.io/v1',
      kind: 'VirtualMachineInstance',
      metadata: {
        name,
        namespace,
        labels: { app: GUESTFS_LABEL, 'kubevirt.io/vm': vmName },
      },
      spec: {
        domain: {
          devices: { disks: diskSpecs },
          resources: { requests: { memory: '256Mi' } },
        },
        volumes: volumeSpecs,
        ...(nodeSelector ? { nodeSelector } : {}),
        ...(tolerations ? { tolerations } : {}),
        ...(affinity ? { affinity } : {}),
      },
    };

    try {
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances`,
        {
          method: 'POST',
          body: JSON.stringify(vmiSpec),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      setVmiName(name);
      setVmiStatus('pending');
      enqueueSnackbar('Inspector VM created, waiting for it to start...', { variant: 'info' });
      pollVMI(name);
    } catch (e: unknown) {
      const errObj = e as { status?: number; message?: string };
      if (errObj?.status === 409 || errObj?.message?.includes('already exists')) {
        setVmiName(name);
        setVmiStatus('pending');
        pollVMI(name);
      } else {
        enqueueSnackbar(`Failed to create inspector VM: ${safeError(e, 'vmi-create')}`, {
          variant: 'error',
        });
        setVmiStatus('failed');
        setVmiDetail(safeError(e, 'vmi-create'));
      }
    }
  };

  const deleteInspectorVMI = async () => {
    if (!vmiName) return;
    const toDelete = vmiName;
    setVmiStatus('deleting');
    setVmiDetail('');

    setVmiItem(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    const apiPath = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
      namespace
    )}/virtualmachineinstances/${encodeURIComponent(toDelete)}`;

    try {
      await ApiProxy.request(apiPath, { method: 'DELETE', isJSON: false });
      enqueueSnackbar('Deleting inspector VM...', { variant: 'info' });
      if (deletePollRef.current) clearInterval(deletePollRef.current);
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
      deletePollRef.current = setInterval(async () => {
        try {
          const res = await ApiProxy.request(apiPath);
          const phase = res?.status?.phase;
          if (phase) setVmiDetail(`Terminating (${phase})`);
        } catch {
          if (deletePollRef.current) clearInterval(deletePollRef.current);
          deletePollRef.current = null;
          if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
          deleteTimeoutRef.current = null;
          setVmiName(null);
          setVmiStatus('idle');
          setVmiDetail('');
          enqueueSnackbar('Inspector VM deleted', { variant: 'success' });
        }
      }, 2000);
      deleteTimeoutRef.current = setTimeout(() => {
        if (deletePollRef.current) clearInterval(deletePollRef.current);
        deletePollRef.current = null;
        deleteTimeoutRef.current = null;
        setVmiName(null);
        setVmiStatus('idle');
        setVmiDetail('');
      }, 30000);
    } catch (e) {
      enqueueSnackbar(`Failed to delete inspector VM: ${safeError(e, 'vmi-delete')}`, {
        variant: 'error',
      });
      setVmiStatus('failed');
    }
  };

  const isStopped =
    !vmItem?.jsonData?.status?.printableStatus ||
    vmItem?.jsonData?.status?.printableStatus === 'Stopped';
  const statusColor = getInspectorStatusColor(vmiStatus);

  const toggleDisk = (pvcName: string) => {
    setSelectedDisks(prev =>
      prev.includes(pvcName) ? prev.filter(d => d !== pvcName) : [...prev, pvcName]
    );
  };

  const allSelected = disks.length > 0 && selectedDisks.length === disks.length;

  // ── Render ──────────────────────────────────────────────────────

  const handleSerialStatus = useCallback((status: 'connecting' | 'connected') => {
    setTerminalStatus(status);
  }, []);

  // Terminal view — inline serial console
  if (vmiItem && vmiStatus === 'running') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 0 }}>
        {/* Title bar */}
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
          <Icon icon="mdi:harddisk" width={14} style={{ opacity: 0.7 }} />
          {attachedDisks.length === 1 ? (
            <>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}
              >
                {attachedDisks[0].pvcName}
              </Typography>
              <Chip
                label={`→ /dev/${attachedDisks[0].dev}`}
                size="small"
                sx={{ fontFamily: 'monospace', fontSize: '0.65rem', height: 18 }}
              />
            </>
          ) : (
            <Tooltip
              title={
                <Box sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {attachedDisks.map(d => (
                    <div key={d.serial}>
                      {d.pvcName} → /dev/{d.dev}
                    </div>
                  ))}
                </Box>
              }
              arrow
              placement="bottom"
            >
              <Chip
                label={`${attachedDisks.length} disks attached`}
                size="small"
                sx={{ fontFamily: 'monospace', fontSize: '0.65rem', height: 18, cursor: 'help' }}
              />
            </Tooltip>
          )}

          {/* Center: status */}
          <Box flex={1} />
          <Icon icon="mdi:console" width={14} style={{ opacity: 0.7 }} />
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 600 }}
          >
            Serial Console
          </Typography>
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
          </Box>

          <Box flex={1} />

          {/* Right: controls */}
          <Tooltip title="Command Reference" arrow>
            <IconButton
              size="small"
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
          <Tooltip title="Stop & delete inspector VM" arrow>
            <IconButton
              size="small"
              onClick={() => setShowDeleteConfirm(true)}
              sx={{ p: 0.25, borderRadius: 0.5, color: 'error.main' }}
            >
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Console + command sidebar */}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1.5 }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              borderRadius: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <TerminalPanel
              ref={terminalRef}
              item={vmiItem}
              active
              compact
              onStatusChange={handleSerialStatus}
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
              <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Icon icon="mdi:harddisk" width={16} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.8rem' }}>
                    Disk Inspector
                  </Typography>
                  <Box flex={1} />
                  <IconButton size="small" onClick={() => setShowCmdRef(false)} sx={{ p: 0.25 }}>
                    <Icon icon="mdi:close" width={16} />
                  </IconButton>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                  Click to execute, copy icon to clipboard
                </Typography>
                {/* Disk mapping table */}
                <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {attachedDisks.map(d => (
                    <Typography
                      key={d.serial}
                      variant="body2"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
                    >
                      /dev/{d.dev} → {d.pvcName.substring(0, 28)}
                    </Typography>
                  ))}
                </Box>
                <Box display="flex" alignItems="center" gap={0.5} mt={0.75}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  >
                    Root partition:
                  </Typography>
                  <TextField
                    size="small"
                    value={rootPartition}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') {
                        setRootPartition('');
                        return;
                      }
                      // Allow partial typing: accept prefixes of valid paths
                      if (
                        partitionValidation.partial.test(v) ||
                        '/dev/'.startsWith(v) ||
                        attachedDisks.some(d => `/dev/${d.dev}`.startsWith(v))
                      ) {
                        setRootPartition(v);
                      }
                    }}
                    error={(() => {
                      if (rootPartition === '') return false;
                      if (partitionValidation.complete.test(rootPartition)) return false;
                      const isPrefix =
                        '/dev/'.startsWith(rootPartition) ||
                        attachedDisks.some(d => `/dev/${d.dev}`.startsWith(rootPartition)) ||
                        partitionValidation.partial.test(rootPartition);
                      return !isPrefix;
                    })()}
                    helperText={(() => {
                      if (rootPartition === '') return '';
                      if (partitionValidation.complete.test(rootPartition)) return '';
                      const isPrefix =
                        '/dev/'.startsWith(rootPartition) ||
                        attachedDisks.some(d => `/dev/${d.dev}`.startsWith(rootPartition)) ||
                        partitionValidation.partial.test(rootPartition);
                      return isPrefix
                        ? ''
                        : `Valid: ${attachedDisks.map(d => `/dev/${d.dev}[N]`).join(', ')}`;
                    })()}
                    placeholder={
                      attachedDisks.length > 0 ? `/dev/${attachedDisks[0].dev}4` : '/dev/vdb4'
                    }
                    variant="outlined"
                    sx={{
                      flex: 1,
                      '& .MuiInputBase-root': {
                        height: 24,
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                      },
                      '& .MuiInputBase-input': { px: 0.75, py: 0 },
                      '& .MuiFormHelperText-root': {
                        color: 'text.secondary !important',
                        fontSize: '0.75rem',
                        mt: 0.25,
                        mx: 0.5,
                      },
                    }}
                  />
                </Box>
              </Box>
              <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                {getInspectorCommands(attachedDisks, rootPartition, vmName).map((group, idx) => (
                  <Box key={group.category}>
                    {idx > 0 && <Divider sx={{ my: 0.75 }} />}
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      color="text.secondary"
                      sx={{
                        textTransform: 'uppercase',
                        fontSize: '0.7rem',
                        letterSpacing: 0.5,
                        display: 'block',
                        mb: group.hint ? 0 : 0.5,
                      }}
                    >
                      {group.category}
                    </Typography>
                    {group.hint && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          fontSize: '0.7rem',
                          fontStyle: 'italic',
                          display: 'block',
                          mb: 0.5,
                          opacity: 0.8,
                        }}
                      >
                        {group.hint}
                      </Typography>
                    )}
                    <Box display="flex" flexDirection="column" gap={0.5}>
                      {group.commands.map(cmd => (
                        <CommandChip
                          key={cmd.label}
                          cmd={cmd}
                          onExec={() => {
                            terminalRef.current?.sendText(cmd.command + '\n');
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
        <ConfirmDialog
          open={showDeleteConfirm}
          title="Stop Disk Inspector"
          message="This will stop and delete the inspector VM. Any unsaved changes to mounted filesystems will be lost."
          confirmLabel="Stop & Delete"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            deleteInspectorVMI();
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </Box>
    );
  }

  // ── Status bar (creating/pending/failed/deleting) ──

  if (vmiStatus !== 'idle') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            position: 'relative',
          }}
        >
          {(vmiStatus === 'creating' || vmiStatus === 'pending' || vmiStatus === 'deleting') && (
            <LinearProgress
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                '& .MuiLinearProgress-bar': { bgcolor: statusColor },
                bgcolor: alpha(statusColor, 0.15),
              }}
            />
          )}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 1.5,
              bgcolor: alpha(statusColor, 0.1),
              flexShrink: 0,
            }}
          >
            {vmiStatus === 'creating' || vmiStatus === 'pending' || vmiStatus === 'deleting' ? (
              <CircularProgress size={18} sx={{ color: statusColor }} />
            ) : (
              <Icon
                icon={vmiStatus === 'running' ? 'mdi:check-circle' : 'mdi:alert-circle'}
                width={20}
                color={statusColor}
              />
            )}
          </Box>
          <Box flex={1} minWidth={0}>
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="body2" fontWeight={600}>
                {vmiStatus === 'creating' && 'Creating inspector VM...'}
                {vmiStatus === 'pending' && 'VM starting...'}
                {vmiStatus === 'running' && 'Inspector running'}
                {vmiStatus === 'failed' && 'Inspector failed'}
                {vmiStatus === 'deleting' && 'Stopping inspector...'}
              </Typography>
              {vmiDetail && (
                <Chip
                  label={vmiDetail}
                  size="small"
                  variant="outlined"
                  color={vmiStatus === 'failed' ? 'error' : 'warning'}
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 22 }}
                />
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {vmiStatus === 'creating' && 'Submitting VMI to KubeVirt...'}
              {vmiStatus === 'pending' &&
                `Booting alpine VM with ${selectedDisks.length} disk(s) attached...`}
              {vmiStatus === 'running' && (
                <>
                  {selectedDisks.length} disk(s) &middot;{' '}
                  <code style={{ fontSize: '0.8rem' }}>{vmiName}</code>
                </>
              )}
              {vmiStatus === 'failed' &&
                'Check that the PVCs are not in use and the image is available'}
              {vmiStatus === 'deleting' && 'Waiting for VM termination...'}
            </Typography>
          </Box>
          <Box display="flex" gap={1} flexShrink={0}>
            {(vmiStatus === 'creating' || vmiStatus === 'pending') && (
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={deleteInspectorVMI}
                startIcon={<Icon icon="mdi:cancel" width={16} />}
                sx={{ textTransform: 'none' }}
              >
                Cancel
              </Button>
            )}
            {vmiStatus === 'failed' && (
              <>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Icon icon="mdi:restart" width={18} />}
                  onClick={createInspectorVMI}
                  disabled={!isStopped || selectedDisks.length === 0}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Retry
                </Button>
                {vmiName && (
                  <Button
                    variant="outlined"
                    size="small"
                    color="inherit"
                    onClick={deleteInspectorVMI}
                    startIcon={<Icon icon="mdi:delete" width={16} />}
                    sx={{ textTransform: 'none' }}
                  >
                    Cleanup
                  </Button>
                )}
              </>
            )}
            {vmiStatus === 'deleting' && <CircularProgress size={20} />}
          </Box>
        </Box>
        {/* Empty area below status bar */}
        <Box sx={{ flex: 1 }} />
      </Box>
    );
  }

  // ── CTA / onboarding (idle state) ──────────────────────────────

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{ flex: 1, minHeight: 0 }}
      >
        <Box sx={{ maxWidth: 580, textAlign: 'center', py: 3 }}>
          <Icon icon="mdi:harddisk" width={56} style={{ opacity: 0.6 }} />
          <Typography variant="h5" sx={{ mt: 1.5, fontWeight: 700 }}>
            Disk Inspector
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
            Boot a lightweight{' '}
            <Tooltip title={`Image: ${INSPECTOR_IMAGE}`} arrow placement="top">
              <span style={{ fontWeight: 600, cursor: 'help', borderBottom: '1px dotted' }}>
                alpine VM
              </span>
            </Tooltip>{' '}
            with the selected disk(s) attached as secondary block devices. Access via serial console
            to inspect partitions, mount filesystems, and explore disk contents.
          </Typography>

          <Box
            sx={{ display: 'flex', gap: 2, mt: 2.5, justifyContent: 'center', flexWrap: 'wrap' }}
          >
            {[
              { icon: 'mdi:folder-search', text: 'Browse & extract files' },
              { icon: 'mdi:tools', text: 'Repair bootloaders & fstab' },
              { icon: 'mdi:harddisk', text: 'Inspect partitions & filesystems' },
              { icon: 'mdi:package-variant', text: 'Inspect installed packages' },
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
                <Icon icon={item.icon} width={18} />
                <Typography variant="body2">{item.text}</Typography>
              </Box>
            ))}
          </Box>

          {/* Disk selection */}
          {disks.length > 0 && (
            <Box sx={{ mt: 3, textAlign: 'left' }}>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
                  Select disks
                </Typography>
                <Box flex={1} />
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setSelectedDisks(allSelected ? [] : disks.map(d => d.pvcName))}
                  sx={{ textTransform: 'none', fontSize: '0.75rem', minWidth: 'auto', py: 0 }}
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </Button>
              </Box>
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                {disks.map((d, i) => {
                  const sel = selectedDisks.includes(d.pvcName);
                  const diskIdx = selectedDisks.indexOf(d.pvcName);
                  return (
                    <Box
                      key={d.pvcName}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 1,
                        py: 0.75,
                        borderBottom: i < disks.length - 1 ? 1 : 0,
                        borderColor: 'divider',
                        bgcolor: sel
                          ? theme => alpha(theme.palette.primary.main, 0.04)
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => toggleDisk(d.pvcName)}
                    >
                      <Checkbox checked={sel} size="small" sx={{ p: 0.25 }} tabIndex={-1} />
                      <Icon
                        icon={d.type === 'dataVolume' ? 'mdi:database' : 'mdi:harddisk'}
                        width={18}
                        color={sel ? '#1976d2' : '#78909c'}
                      />
                      <Typography
                        variant="body2"
                        fontWeight={sel ? 600 : 400}
                        sx={{ flex: 1 }}
                        noWrap
                      >
                        {d.pvcName}
                      </Typography>
                      <Chip
                        label={d.type === 'dataVolume' ? 'DV' : 'PVC'}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem' }}
                      />
                      {d.size && d.size !== '?' && (
                        <Typography variant="body2" color="text.secondary">
                          {d.size}
                        </Typography>
                      )}
                      <Chip
                        label={d.volumeMode === 'Block' ? 'Block' : 'Filesystem'}
                        size="small"
                        variant="outlined"
                        sx={{
                          height: 20,
                          fontSize: '0.65rem',
                          fontFamily: 'monospace',
                          color: d.volumeMode === 'Block' ? 'warning.main' : 'success.main',
                          borderColor: d.volumeMode === 'Block' ? 'warning.main' : 'success.main',
                        }}
                      />
                      {sel && diskIdx >= 0 && (
                        <Chip
                          label={`→ /dev/vd${devLetter(diskIdx)}`}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '0.7rem',
                            fontFamily: 'monospace',
                            bgcolor: theme => alpha(theme.palette.primary.main, 0.08),
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Inspect button + scheduling option */}
          {disks.length > 0 && (
            <Box
              sx={{
                mt: 2.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
              }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={copyVmScheduling}
                    onChange={e => setCopyVmScheduling(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Tooltip title="nodeSelector, tolerations, affinity" arrow>
                    <Typography variant="body2" color="text.secondary" sx={{ cursor: 'help' }}>
                      Copy VM scheduling
                    </Typography>
                  </Tooltip>
                }
              />
              <Button
                variant="contained"
                startIcon={<Icon icon="mdi:magnify-scan" width={20} />}
                onClick={createInspectorVMI}
                disabled={!isStopped || selectedDisks.length === 0}
                sx={{ textTransform: 'none', fontWeight: 600, px: 4, py: 1 }}
              >
                Inspect {selectedDisks.length === 1 ? 'Disk' : `${selectedDisks.length} Disks`}
              </Button>
            </Box>
          )}

          {/* Warnings */}
          {!isStopped && (
            <Alert
              severity="warning"
              icon={<Icon icon="mdi:power-plug-off" width={18} />}
              sx={{
                mt: 2,
                textAlign: 'left',
                justifyContent: 'center',
                '& .MuiAlert-message': { fontWeight: 500 },
              }}
              variant="filled"
            >
              VM must be stopped. Disk inspection requires exclusive PVC access.
            </Alert>
          )}
          {disks.length === 0 && (
            <Alert
              severity="info"
              icon={<Icon icon="mdi:information" width={18} />}
              sx={{ mt: 2, textAlign: 'left', justifyContent: 'center' }}
            >
              No PVC-backed disks found on this VM.
            </Alert>
          )}

          {/* Image footer */}
          <Box display="flex" alignItems="center" justifyContent="center" gap={0.75} mt={2}>
            <Icon icon="mdi:server" width={14} color="#78909c" />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            >
              {getGuestfsSettings().image || INSPECTOR_IMAGE}
            </Typography>
            <Chip
              label="containerDisk"
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: '0.6rem' }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
