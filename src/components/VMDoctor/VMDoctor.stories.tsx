import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import { SnackbarProvider } from 'notistack';
import React, { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { TabContent, TabDef, TabPanelHeader } from '../common/TabPanel';

/**
 * Pixel-accurate mock of VMDoctorDialog.
 * Every tab mock is a faithful replica of the real component's JSX structure,
 * using the exact same MUI components, props, sx styles, colors, and layout.
 * No headlamp-plugin imports — all data is static mock data.
 */

// ─── Mock Data ──────────────────────────────────────────────────────

const VM_NAME = 'fedora-server-01';
const NAMESPACE = 'default';
const POD_NAME = 'virt-launcher-fedora-server-01-xk7rp';
const DOMAIN = `${NAMESPACE}_${VM_NAME}`;

// ─── Status Color (from statusColors.ts) ────────────────────────────

function getVMIPhaseColor(phase: string): string {
  const map: Record<string, string> = {
    Running: '#4caf50',
    Succeeded: '#2196f3',
    Failed: '#f44336',
    Pending: '#ff9800',
    Scheduling: '#ff9800',
    Scheduled: '#ff9800',
    Unknown: '#9e9e9e',
    Stopped: '#9e9e9e',
  };
  return map[phase] || '#9e9e9e';
}

// ─── VM Actions (mocked) ────────────────────────────────────────────

const VM_ACTIONS = [
  { id: 'start', label: 'Start', icon: 'mdi:play', disabled: true },
  { id: 'stop', label: 'Stop', icon: 'mdi:stop', disabled: false },
  { id: 'restart', label: 'Restart', icon: 'mdi:restart', disabled: false },
  { id: 'pause', label: 'Pause', icon: 'mdi:pause', disabled: false },
  { id: 'migrate', label: 'Migrate', icon: 'mdi:transfer', disabled: false },
  { id: 'forceStop', label: 'Force Stop', icon: 'mdi:power', disabled: false },
];

// ─── Tab Constants (same as VMDoctorDialog.tsx) ─────────────────────

const TAB_GUEST_INFO = 0;
const TAB_CONDITIONS = 1;
const TAB_EVENTS = 2;
const TAB_METRICS = 3;
const TAB_QUERIER = 4;
const TAB_LOGS = 5;
const TAB_VM_SHELL = 6;
const TAB_POD_SHELL = 7;
const TAB_YAML = 8;
const TAB_MEMDUMP = 9;

// ─── Helpers ────────────────────────────────────────────────────────

function conditionStatusIcon(status: string, type: string): { icon: string; color: string } {
  const isPositive = status === 'True';
  const invertedTypes = new Set(['Running', 'Paused']);
  const isGood = invertedTypes.has(type) ? !isPositive : isPositive;
  return {
    icon: isGood ? 'mdi:check-circle' : 'mdi:alert-circle',
    color: isGood ? '#66bb6a' : status === 'False' ? '#ef5350' : '#ffca28',
  };
}

function timeAgo(timestamp?: string): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '-';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── Conditions Mock Data ───────────────────────────────────────────

const CONDITION_GROUPS = [
  {
    source: 'VirtualMachine',
    icon: 'mdi:server',
    color: '#42a5f5',
    phase: 'Running',
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: 'VMIReady',
        message: 'VMI is ready',
        lastTransitionTime: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        type: 'Initialized',
        status: 'True',
        reason: 'NoFailure',
        message: '',
        lastTransitionTime: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
  {
    source: 'VirtualMachineInstance',
    icon: 'mdi:memory',
    color: '#ce93d8',
    phase: 'Running',
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        type: 'LiveMigratable',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        type: 'AgentConnected',
        status: 'True',
        reason: 'GuestAgentIsConnected',
        message: 'QEMU guest agent is connected',
        lastTransitionTime: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
  },
  {
    source: `Pod (${POD_NAME})`,
    icon: 'mdi:cube-outline',
    color: '#66bb6a',
    phase: 'Running',
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        type: 'PodScheduled',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        type: 'ContainersReady',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        type: 'Initialized',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
  {
    source: `DataVolume: ${VM_NAME}-rootdisk`,
    icon: 'mdi:harddisk',
    color: '#ffca28',
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        type: 'Bound',
        status: 'True',
        reason: '',
        message: '',
        lastTransitionTime: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
];

// ─── Events Mock Data ───────────────────────────────────────────────

const MOCK_EVENTS = [
  {
    type: 'Normal',
    reason: 'SuccessfulCreate',
    kind: 'VirtualMachine',
    name: VM_NAME,
    message: 'Created virtual machine instance',
    count: 1,
    lastTimestamp: new Date(Date.now() - 7200000).toISOString(),
    source: 'virt-controller',
  },
  {
    type: 'Normal',
    reason: 'Started',
    kind: 'VirtualMachineInstance',
    name: VM_NAME,
    message: 'VirtualMachineInstance started',
    count: 1,
    lastTimestamp: new Date(Date.now() - 6600000).toISOString(),
    source: 'virt-handler',
  },
  {
    type: 'Normal',
    reason: 'GuestAgentConnected',
    kind: 'VirtualMachineInstance',
    name: VM_NAME,
    message: 'QEMU Guest Agent connected',
    count: 1,
    lastTimestamp: new Date(Date.now() - 6300000).toISOString(),
    source: 'virt-handler',
  },
  {
    type: 'Normal',
    reason: 'Scheduled',
    kind: 'Pod',
    name: POD_NAME,
    message: `Successfully assigned ${NAMESPACE}/${POD_NAME} to worker-01`,
    count: 1,
    lastTimestamp: new Date(Date.now() - 6900000).toISOString(),
    source: 'default-scheduler',
  },
  {
    type: 'Normal',
    reason: 'Created',
    kind: 'Pod',
    name: POD_NAME,
    message: 'Created container compute',
    count: 1,
    lastTimestamp: new Date(Date.now() - 6800000).toISOString(),
    source: 'kubelet',
  },
  {
    type: 'Normal',
    reason: 'Started',
    kind: 'Pod',
    name: POD_NAME,
    message: 'Started container compute',
    count: 1,
    lastTimestamp: new Date(Date.now() - 6700000).toISOString(),
    source: 'kubelet',
  },
  {
    type: 'Warning',
    reason: 'FailedMount',
    kind: 'Pod',
    name: POD_NAME,
    message:
      'MountVolume.SetUp failed for volume "cloudinit" : configmap "fedora-server-01-cloudinit" not found',
    count: 2,
    lastTimestamp: new Date(Date.now() - 5400000).toISOString(),
    source: 'kubelet',
  },
];

// ─── Guest Info Mock ────────────────────────────────────────────────

const GUEST_OS_ROWS = [
  ['Hostname', 'fedora-server-01'],
  ['OS', 'Fedora Linux 39 (Server Edition)'],
  ['Version', '39'],
  ['Kernel', '6.5.6-300.fc39.x86_64'],
  ['Architecture', 'x86_64'],
  ['Timezone', 'UTC, +0000'],
  ['Agent Version', '8.1.3'],
];

const GUEST_USERS = [
  { user: 'fedora', loginTime: new Date(Date.now() - 3600000).toLocaleString(), domain: '-' },
  { user: 'root', loginTime: new Date(Date.now() - 7200000).toLocaleString(), domain: '-' },
];

const GUEST_FS = [
  { mount: '/', type: 'xfs', disk: 'vda1', totalBytes: 32212254720, usedBytes: 8589934592 },
  { mount: '/boot', type: 'ext4', disk: 'vda2', totalBytes: 536870912, usedBytes: 139460608 },
];

const GUEST_IFACES = [
  {
    name: 'default',
    interfaceName: 'eth0',
    mac: '52:54:00:12:34:56',
    ipAddresses: ['10.244.1.42', 'fd00::42', 'fe80::5054:ff:fe12:3456'],
  },
];

// ─── Logs Mock ──────────────────────────────────────────────────────

const MOCK_LOGS = `time="2024-11-15T10:30:15Z" level=info msg="Setting up networking"
time="2024-11-15T10:30:16Z" level=info msg="Starting VM"
time="2024-11-15T10:30:18Z" level=info msg="QEMU machine type is: pc-q35-8.1"
time="2024-11-15T10:30:19Z" level=info msg="Starting container"
time="2024-11-15T10:30:20Z" level=info msg="VNC is listening on port 5900"
time="2024-11-15T10:30:22Z" level=info msg="Guest agent connected"
time="2024-11-15T10:30:25Z" level=info msg="Domain state changed to running"
time="2024-11-15T10:30:30Z" level=info msg="Healthy check passed"
time="2024-11-15T10:31:00Z" level=info msg="Periodic health check OK"
time="2024-11-15T10:32:00Z" level=info msg="Periodic health check OK"
time="2024-11-15T10:33:00Z" level=info msg="Periodic health check OK"
time="2024-11-15T10:34:00Z" level=info msg="Periodic health check OK"
time="2024-11-15T10:35:00Z" level=info msg="Periodic health check OK"`;

// ─── YAML Mock ──────────────────────────────────────────────────────

const MOCK_YAML = `apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${VM_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: fedora-server
spec:
  running: true
  template:
    metadata:
      labels:
        kubevirt.io/domain: ${VM_NAME}
    spec:
      domain:
        cpu:
          cores: 2
          sockets: 1
          threads: 1
        memory:
          guest: 4Gi
        devices:
          disks:
            - name: rootdisk
              disk:
                bus: virtio
          interfaces:
            - name: default
              masquerade: {}
      networks:
        - name: default
          pod: {}
      volumes:
        - name: rootdisk
          dataVolume:
            name: ${VM_NAME}-rootdisk
status:
  printableStatus: Running
  ready: true`;

// ─── Metrics chart definitions (from MetricsDashboardTab.tsx) ───────

const METRIC_CHARTS = [
  {
    title: 'CPU Usage',
    color: '#3e8635',
    icon: 'mdi:chip',
    yLabel: '%',
    lines: [{ key: 'value', name: 'CPU %', color: '#3e8635' }],
  },
  {
    title: 'Memory Usage',
    color: '#2196f3',
    icon: 'mdi:memory',
    yLabel: 'GiB',
    lines: [
      { key: 'used', name: 'Used', color: '#2196f3' },
      { key: 'total', name: 'Total', color: '#cccccc', dash: '5 5' },
    ],
  },
  {
    title: 'Network Throughput',
    color: '#00acc1',
    icon: 'mdi:lan',
    yLabel: 'KB/s',
    lines: [
      { key: 'rx', name: 'Receive', color: '#3e8635' },
      { key: 'tx', name: 'Transmit', color: '#2196f3' },
    ],
  },
  {
    title: 'Storage Throughput',
    color: '#f0ab00',
    icon: 'mdi:harddisk',
    yLabel: 'KB/s',
    lines: [
      { key: 'read', name: 'Read', color: '#3e8635' },
      { key: 'write', name: 'Write', color: '#f0ab00' },
    ],
  },
  {
    title: 'Storage IOPS',
    color: '#9c27b0',
    icon: 'mdi:speedometer',
    yLabel: 'ops/s',
    lines: [
      { key: 'read', name: 'Read IOPS', color: '#9c27b0' },
      { key: 'write', name: 'Write IOPS', color: '#f0ab00' },
    ],
  },
  {
    title: 'Swap Activity',
    color: '#c9190b',
    icon: 'mdi:swap-vertical',
    yLabel: 'KB/s',
    lines: [
      { key: 'swapIn', name: 'Swap In', color: '#c9190b' },
      { key: 'swapOut', name: 'Swap Out', color: '#f0ab00' },
    ],
  },
  {
    title: 'Network Packets',
    color: '#00acc1',
    icon: 'mdi:package-variant',
    yLabel: 'pkt/s',
    lines: [
      { key: 'rxPackets', name: 'RX pkt/s', color: '#3e8635' },
      { key: 'txPackets', name: 'TX pkt/s', color: '#2196f3' },
    ],
  },
  {
    title: 'Network Errors',
    color: '#c9190b',
    icon: 'mdi:alert-circle',
    yLabel: 'err/s',
    lines: [
      { key: 'rxErrors', name: 'RX Errors', color: '#c9190b' },
      { key: 'txErrors', name: 'TX Errors', color: '#f0ab00' },
    ],
  },
];

// Generate fake time-series data for a chart
function generateChartData(
  lines: Array<{ key: string }>,
  seed: number
): Array<Record<string, any>> {
  const points: Array<Record<string, any>> = [];
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const t = new Date(now - (29 - i) * 60000);
    const point: Record<string, any> = {
      time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    lines.forEach((line, li) => {
      const base = 20 + seed * 7 + li * 15;
      point[line.key] = Math.max(
        0,
        base + Math.sin(i * 0.3 + seed + li) * 10 + (Math.random() - 0.5) * 5
      );
    });
    points.push(point);
  }
  return points;
}

// ─── Querier Mock Data ──────────────────────────────────────────────

const QUERIER_PRESETS = [
  { label: 'CPU Usage %', unit: '%', group: 'CPU' },
  { label: 'vCPU Wait Rate', unit: 's/s', group: 'CPU' },
  { label: 'CPU System Rate', unit: 's/s', group: 'CPU' },
  { label: 'CPU User Rate', unit: 's/s', group: 'CPU' },
  { label: 'Memory Available', unit: 'GiB', group: 'Memory' },
  { label: 'Memory Usable', unit: 'GiB', group: 'Memory' },
  { label: 'Memory Domain Total', unit: 'GiB', group: 'Memory' },
  { label: 'Memory Resident (RSS)', unit: 'MiB', group: 'Memory' },
  { label: 'Memory Unused', unit: 'MiB', group: 'Memory' },
  { label: 'Memory Cached', unit: 'MiB', group: 'Memory' },
  { label: 'Swap In Rate', unit: 'KiB/s', group: 'Swap' },
  { label: 'Swap Out Rate', unit: 'KiB/s', group: 'Swap' },
  { label: 'Page Major Faults Rate', unit: '/s', group: 'Memory' },
  { label: 'Page Minor Faults Rate', unit: '/s', group: 'Memory' },
  { label: 'Network RX Rate', unit: 'KiB/s', group: 'Network' },
  { label: 'Network TX Rate', unit: 'KiB/s', group: 'Network' },
  { label: 'Network RX Packets Rate', unit: 'pkt/s', group: 'Network' },
  { label: 'Network TX Packets Rate', unit: 'pkt/s', group: 'Network' },
  { label: 'Network RX Errors Rate', unit: '/s', group: 'Network' },
  { label: 'Network TX Errors Rate', unit: '/s', group: 'Network' },
  { label: 'Network RX Dropped Rate', unit: '/s', group: 'Network' },
  { label: 'Network TX Dropped Rate', unit: '/s', group: 'Network' },
  { label: 'Storage Read Rate', unit: 'KiB/s', group: 'Storage' },
  { label: 'Storage Write Rate', unit: 'KiB/s', group: 'Storage' },
  { label: 'Storage Read IOPS', unit: 'ops/s', group: 'Storage' },
  { label: 'Storage Write IOPS', unit: 'ops/s', group: 'Storage' },
  { label: 'Storage Read Latency', unit: 's/s', group: 'Storage' },
  { label: 'Storage Write Latency', unit: 's/s', group: 'Storage' },
  { label: 'Storage Flush Rate', unit: '/s', group: 'Storage' },
  { label: 'Filesystem Capacity', unit: 'GiB', group: 'Filesystem' },
  { label: 'Filesystem Used', unit: 'GiB', group: 'Filesystem' },
  { label: 'Migration Data Remaining', unit: 'MiB', group: 'Migration' },
  { label: 'Migration Data Processed', unit: 'MiB', group: 'Migration' },
  { label: 'Migration Dirty Memory Rate', unit: 'KiB/s', group: 'Migration' },
  { label: 'Migration Disk Transfer Rate', unit: 'KiB/s', group: 'Migration' },
];

const GROUP_COLORS: Record<string, string> = {
  CPU: '#9c27b0',
  Memory: '#9c27b0',
  Swap: '#9c27b0',
  Network: '#2196f3',
  Storage: '#ff9800',
  Filesystem: '#ff9800',
  Migration: '#00bcd4',
};

const CHART_COLORS = [
  '#66bb6a',
  '#42a5f5',
  '#ffca28',
  '#ef5350',
  '#ce93d8',
  '#26c6da',
  '#ff7043',
  '#a1887f',
];

// ─── Memory Dump Mock Data ──────────────────────────────────────────

const MOCK_DUMP_PVCS = [
  {
    name: `${VM_NAME}-memdump-20240115`,
    displayName: 'Pre-update snapshot',
    size: '4Gi',
    created: new Date(Date.now() - 86400000 * 3).toISOString(),
    phase: 'Bound',
    isActive: false,
    activePhase: undefined as string | undefined,
  },
  {
    name: `${VM_NAME}-memdump-20240118`,
    displayName: 'After migration',
    size: '4Gi',
    created: new Date(Date.now() - 86400000).toISOString(),
    phase: 'Bound',
    isActive: true,
    activePhase: 'Completed',
  },
];

// ─── Pod Shell / VirtLauncher help commands ─────────────────────────

const VIRSH_HELP_COMMANDS = [
  {
    category: 'VM Status',
    commands: [
      { label: 'List VMs', command: 'virsh list --all 2>/dev/null' },
      { label: 'VM Info', command: `virsh dominfo ${DOMAIN} 2>/dev/null` },
      { label: 'VM State', command: `virsh domstate ${DOMAIN} --reason 2>/dev/null` },
      { label: 'vCPU Info', command: `virsh vcpuinfo ${DOMAIN} 2>/dev/null` },
    ],
  },
  {
    category: 'Resources',
    commands: [
      { label: 'Memory Stats', command: `virsh dommemstat ${DOMAIN} 2>/dev/null` },
      { label: 'Block Devices', command: `virsh domblklist ${DOMAIN} 2>/dev/null` },
      { label: 'Block Stats', command: `virsh domblkstat ${DOMAIN} 2>/dev/null` },
      { label: 'Network Interfaces', command: `virsh domiflist ${DOMAIN} 2>/dev/null` },
    ],
  },
  {
    category: 'Configuration',
    commands: [
      { label: 'VM XML', command: `virsh dumpxml ${DOMAIN} 2>/dev/null | more` },
      {
        label: 'QEMU Args',
        command: `virsh qemu-monitor-command ${DOMAIN} --hmp 'info version' 2>/dev/null`,
      },
      {
        label: 'QEMU Threads',
        command: `virsh qemu-monitor-command ${DOMAIN} --hmp 'info cpus' 2>/dev/null`,
      },
    ],
  },
  {
    category: 'Diagnostics',
    commands: [
      {
        label: 'Guest Agent Ping',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-ping"}' 2>/dev/null`,
        requiresAgent: true,
      },
      {
        label: 'Guest OS Info',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-get-osinfo"}' 2>/dev/null`,
        requiresAgent: true,
      },
      {
        label: 'Guest Hostname',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-get-host-name"}' 2>/dev/null`,
        requiresAgent: true,
      },
      {
        label: 'Guest Networks',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-network-get-interfaces"}' 2>/dev/null`,
        requiresAgent: true,
      },
      {
        label: 'Guest Filesystems',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-get-fsinfo"}' 2>/dev/null`,
        requiresAgent: true,
      },
      {
        label: 'Guest Users',
        command: `virsh qemu-agent-command ${DOMAIN} --pretty '{"execute":"guest-get-users"}' 2>/dev/null`,
        requiresAgent: true,
      },
    ],
  },
  {
    category: 'System',
    commands: [
      { label: 'Processes', command: 'ps aux' },
      { label: 'Disk Usage', command: 'df -h' },
      { label: 'Memory', command: 'cat /proc/meminfo | head -10' },
      {
        label: 'Cgroup Limits',
        command:
          'cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null',
      },
    ],
  },
];

// ─── Forensic Commands (from MemoryDumpTab) ─────────────────────────

const FORENSIC_COMMANDS = [
  {
    category: 'Process Analysis',
    commands: [
      { label: 'List processes', cmd: 'vol-qemu linux.pslist.PsList' },
      { label: 'Process tree', cmd: 'vol-qemu linux.pstree.PsTree' },
      { label: 'Process environment', cmd: 'vol-qemu linux.proc.Maps' },
    ],
  },
  {
    category: 'Network',
    commands: [
      { label: 'Network connections', cmd: 'vol-qemu linux.sockstat.Sockstat' },
      { label: 'Network state', cmd: 'vol-qemu linux.netstat.Netstat' },
    ],
  },
  {
    category: 'Malware Detection',
    commands: [
      { label: 'Hidden modules', cmd: 'vol-qemu linux.check_modules.Check_modules' },
      { label: 'Syscall table', cmd: 'vol-qemu linux.check_syscall.Check_syscall' },
      { label: 'Rootkit detection', cmd: 'vol-qemu linux.tty_check.tty_check' },
    ],
  },
  {
    category: 'Kernel',
    commands: [
      { label: 'Kernel modules', cmd: 'vol-qemu linux.lsmod.Lsmod' },
      { label: 'Mount points', cmd: 'vol-qemu linux.mountinfo.MountInfo' },
    ],
  },
];

// ─── Reusable: Command sidebar (used by Pod Shell & Memory Dump) ────

function CommandSidebar({
  title,
  subtitle,
  icon,
  commands,
  onExec,
  onClose,
  hasAgent,
}: {
  title: string;
  subtitle: string;
  icon: string;
  commands: Array<{
    category: string;
    commands: Array<{ label: string; command?: string; cmd?: string; requiresAgent?: boolean }>;
  }>;
  onExec: (command: string) => void;
  onClose: () => void;
  hasAgent?: boolean;
}) {
  return (
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
          <Icon icon={icon} width={16} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.8rem' }}>
            {title}
          </Typography>
          <Box flex={1} />
          <IconButton size="small" onClick={onClose} sx={{ p: 0.25 }}>
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          {subtitle}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        {commands.map((group, idx) => (
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
              {group.commands.map(cmd => {
                const cmdStr = cmd.command || cmd.cmd || '';
                const disabled = cmd.requiresAgent && !hasAgent;
                return (
                  <Box
                    key={cmd.label}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      bgcolor: disabled ? 'transparent' : 'action.hover',
                      borderRadius: 1,
                      px: 1,
                      py: 0.5,
                      cursor: disabled ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                      border: '1px solid transparent',
                      opacity: disabled ? 0.45 : 1,
                      ...(!disabled && {
                        '&:hover': { bgcolor: 'action.selected', borderColor: 'divider' },
                      }),
                    }}
                    onClick={disabled ? undefined : () => onExec(cmdStr)}
                  >
                    {!disabled && (
                      <Icon
                        icon="mdi:console-line"
                        width={14}
                        style={{ flexShrink: 0, opacity: 0.7 }}
                      />
                    )}
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        flex: 1,
                      }}
                    >
                      {cmd.label}
                    </Typography>
                    {disabled ? (
                      <Tooltip title="QEMU Guest Agent is not connected" arrow placement="left">
                        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          <Icon
                            icon="mdi:information-outline"
                            width={14}
                            style={{ opacity: 0.7 }}
                          />
                        </Box>
                      </Tooltip>
                    ) : (
                      <IconButton
                        size="small"
                        onClick={e => {
                          e.stopPropagation();
                        }}
                        sx={{ p: 0.25, flexShrink: 0 }}
                      >
                        <Icon icon="mdi:content-copy" width={12} />
                      </IconButton>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── Reusable: Mock Terminal UI ─────────────────────────────────────

function MockTerminalUI({
  status,
  podLabel,
  containerLabel,
  lines,
  toolbarExtra,
  onFullscreen,
}: {
  status: 'connecting' | 'connected' | 'disconnected';
  podLabel: string;
  containerLabel?: string;
  lines: React.ReactNode;
  toolbarExtra?: React.ReactNode;
  onFullscreen?: () => void;
}) {
  const statusColor =
    status === 'connected' ? '#3e8635' : status === 'connecting' ? '#f0ab00' : '#c9190b';
  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      {/* Toolbar — matches PodExecTerminal */}
      <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor }} />
        <Typography variant="caption" color="text.secondary">
          {status}
        </Typography>
        {status === 'disconnected' && (
          <Tooltip title="Reconnect">
            <IconButton size="small" sx={{ p: 0.25 }}>
              <Icon icon="mdi:refresh" width={16} />
            </IconButton>
          </Tooltip>
        )}
        <Chip
          label={`${containerLabel ? containerLabel + ' @ ' : ''}${podLabel}`}
          size="small"
          variant="outlined"
          sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
        />
        <Box flex={1} />
        {toolbarExtra}
        <IconButton size="small" onClick={onFullscreen} sx={{ p: 0.5 }}>
          <Icon icon="mdi:fullscreen" width={18} />
        </IconButton>
      </Box>
      {/* Terminal area */}
      <Box
        sx={{
          flex: 1,
          minHeight: 300,
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          overflow: 'hidden',
          p: 1.5,
          fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
          fontSize: '0.8rem',
          lineHeight: 1.5,
          color: '#d4d4d4',
          '&::-webkit-scrollbar': { width: 8 },
          '&::-webkit-scrollbar-track': { bgcolor: '#2d2d2d' },
          '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
        }}
      >
        {lines}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB CONTENT COMPONENTS — Pixel-accurate replicas
// ═══════════════════════════════════════════════════════════════════

// ─── Guest Info Tab (GuestInfoTab.tsx) ──────────────────────────────

function MockGuestInfoTab() {
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        {/* OS Card — uses SimpleTable, we replicate with MUI Table */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              <Icon
                icon="mdi:linux"
                width={18}
                style={{ verticalAlign: 'middle', marginRight: 6 }}
              />
              Operating System
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Field</TableCell>
                  <TableCell>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {GUEST_OS_ROWS.map(([field, value]) => (
                  <TableRow key={field}>
                    <TableCell>{field}</TableCell>
                    <TableCell>{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Users Card */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              <Icon
                icon="mdi:account-group"
                width={18}
                style={{ verticalAlign: 'middle', marginRight: 6 }}
              />
              Logged-in Users
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Login Time</TableCell>
                  <TableCell>Domain</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {GUEST_USERS.map(u => (
                  <TableRow key={u.user}>
                    <TableCell>{u.user}</TableCell>
                    <TableCell>{u.loginTime}</TableCell>
                    <TableCell>{u.domain}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Box>

      {/* Filesystems Card (full width) */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            <Icon
              icon="mdi:harddisk"
              width={18}
              style={{ verticalAlign: 'middle', marginRight: 6 }}
            />
            Filesystems
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Mount Point</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Disk</TableCell>
                <TableCell>Usage</TableCell>
                <TableCell>Size</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {GUEST_FS.map(fs => {
                const pct = (fs.usedBytes / fs.totalBytes) * 100;
                return (
                  <TableRow key={fs.mount}>
                    <TableCell>{fs.mount}</TableCell>
                    <TableCell>{fs.type}</TableCell>
                    <TableCell>{fs.disk}</TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1} minWidth={200}>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{
                            flexGrow: 1,
                            height: 8,
                            borderRadius: 4,
                            '& .MuiLinearProgress-bar': {
                              bgcolor: pct > 90 ? '#c9190b' : pct > 75 ? '#f0ab00' : '#3e8635',
                            },
                          }}
                        />
                        <Typography variant="caption" sx={{ minWidth: 40 }}>
                          {pct.toFixed(0)}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {formatBytes(fs.usedBytes)} / {formatBytes(fs.totalBytes)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Network Interfaces Card (full width) */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            <Icon icon="mdi:lan" width={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Network Interfaces
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Interface</TableCell>
                <TableCell>MAC</TableCell>
                <TableCell>IP Addresses</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {GUEST_IFACES.map(iface => (
                <TableRow key={iface.name}>
                  <TableCell>{iface.name}</TableCell>
                  <TableCell>{iface.interfaceName}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.85rem">
                      {iface.mac}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {iface.ipAddresses
                      .filter(ip => !ip.startsWith('fe80::'))
                      .map(ip => (
                        <Chip
                          key={ip}
                          label={ip}
                          size="small"
                          variant="outlined"
                          sx={{ mr: 0.5, mb: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}
                        />
                      ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}

// ─── Conditions Tab (ConditionsTab.tsx) ──────────────────────────────

function MockConditionsTab() {
  const totalConditions = CONDITION_GROUPS.reduce((s, g) => s + g.conditions.length, 0);
  const unhealthyCount = CONDITION_GROUPS.reduce(
    (sum, g) =>
      sum +
      g.conditions.filter(c => {
        const inv = new Set(['Running', 'Paused']);
        return inv.has(c.type) ? c.status === 'True' : c.status === 'False';
      }).length,
    0
  );

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Box display="flex" alignItems="center" gap={1.5}>
        <Chip
          icon={<Icon icon="mdi:clipboard-check-outline" width={16} />}
          label={`${totalConditions} conditions`}
          size="small"
          variant="outlined"
        />
        {unhealthyCount > 0 ? (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 1,
              bgcolor: '#f0ab00',
              color: '#000',
            }}
          >
            <Icon icon="mdi:alert" width={20} color="#000" />
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#000' }}>
              {unhealthyCount} condition{unhealthyCount > 1 ? 's' : ''} need
              {unhealthyCount === 1 ? 's' : ''} attention
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 1,
              bgcolor: '#3e8635',
              color: '#fff',
            }}
          >
            <Icon icon="mdi:check-circle" width={20} color="#fff" />
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#fff' }}>
              All conditions healthy
            </Typography>
          </Box>
        )}
      </Box>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        {CONDITION_GROUPS.map(group => {
          const healthy = group.conditions.filter(c => {
            const inv = new Set(['Running', 'Paused']);
            return inv.has(c.type) ? c.status === 'False' : c.status === 'True';
          }).length;
          const allOk = healthy === group.conditions.length;
          return (
            <Card key={group.source} variant="outlined">
              <CardContent sx={{ pb: '12px !important' }}>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Icon icon={group.icon} width={20} color={group.color} />
                  <Typography variant="subtitle2" fontWeight={600}>
                    {group.source}
                  </Typography>
                  {group.phase && (
                    <Chip
                      label={group.phase}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: '0.7rem', height: 20 }}
                    />
                  )}
                  <Box flex={1} />
                  <Chip
                    label={`${healthy}/${group.conditions.length}`}
                    size="small"
                    sx={{
                      fontSize: '0.7rem',
                      height: 20,
                      fontWeight: 600,
                      bgcolor: allOk ? '#66bb6a' : '#ffca28',
                      color: '#fff',
                    }}
                  />
                </Box>
                <Box display="flex" flexDirection="column" gap={0.5}>
                  {group.conditions.map(c => {
                    const { icon, color } = conditionStatusIcon(c.status, c.type);
                    return (
                      <Box
                        key={c.type}
                        display="flex"
                        alignItems="flex-start"
                        gap={1.5}
                        sx={{
                          py: 1,
                          px: 1.5,
                          borderRadius: 1,
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Icon
                          icon={icon}
                          width={20}
                          color={color}
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
                        <Box flex={1} minWidth={0}>
                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                            <Typography variant="body2" fontWeight={600}>
                              {c.type}
                            </Typography>
                            <Chip
                              label={c.status}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                bgcolor: color,
                                color: '#fff',
                              }}
                            />
                            {c.reason && (
                              <Chip
                                label={c.reason}
                                size="small"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            )}
                            {c.lastTransitionTime && (
                              <Tooltip title={c.lastTransitionTime}>
                                <Typography variant="caption" color="text.secondary">
                                  {timeAgo(c.lastTransitionTime)}
                                </Typography>
                              </Tooltip>
                            )}
                          </Box>
                          {c.message && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ mt: 0.25, display: 'block', lineHeight: 1.4 }}
                            >
                              {c.message}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}

// ─── Events Tab (EventsTab.tsx) ─────────────────────────────────────

function MockEventsTab() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const warningCount = MOCK_EVENTS.filter(e => e.type === 'Warning').length;
  const filtered = MOCK_EVENTS.filter(
    e =>
      (filter === 'all' || e.type === filter) &&
      (!search || e.message.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <Chip label={`${MOCK_EVENTS.length} events`} size="small" variant="outlined" />
        {warningCount > 0 && (
          <Chip
            icon={<Icon icon="mdi:alert" width={16} />}
            label={`${warningCount} warnings`}
            size="small"
            color="warning"
          />
        )}
        <FormControl size="small">
          <Select value={filter} onChange={e => setFilter(e.target.value)} sx={{ minWidth: 120 }}>
            <MenuItem value="all">All Types</MenuItem>
            <MenuItem value="Normal">Normal</MenuItem>
            <MenuItem value="Warning">Warning</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Search events..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon="mdi:magnify" width={18} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch('')}>
                  <Icon icon="mdi:close" width={16} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{ minWidth: 220 }}
        />
      </Box>
      {filtered.length === 0 ? (
        <Alert severity="info">No events found for this VM.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Object</TableCell>
              <TableCell>Message</TableCell>
              <TableCell>Count</TableCell>
              <TableCell>Last Seen</TableCell>
              <TableCell>Source</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((ev, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Chip
                    label={ev.type}
                    size="small"
                    color={ev.type === 'Warning' ? 'warning' : 'success'}
                    sx={{ fontWeight: 600, minWidth: 70 }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {ev.reason}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={`${ev.kind}/${ev.name}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title={ev.message}>
                    <Typography
                      variant="body2"
                      sx={{
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ev.message}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell>{ev.count}</TableCell>
                <TableCell>{timeAgo(ev.lastTimestamp)}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {ev.source}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

// ─── Metrics Tab (MetricsDashboardTab.tsx) ───────────────────────────

function MockMetricsTab() {
  const [timeRange, setTimeRange] = useState('1h');

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <FormControl size="small">
          <Select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="5m">Last 5 minutes</MenuItem>
            <MenuItem value="15m">Last 15 minutes</MenuItem>
            <MenuItem value="30m">Last 30 minutes</MenuItem>
            <MenuItem value="1h">Last 1 hour</MenuItem>
            <MenuItem value="3h">Last 3 hours</MenuItem>
            <MenuItem value="6h">Last 6 hours</MenuItem>
            <MenuItem value="12h">Last 12 hours</MenuItem>
            <MenuItem value="24h">Last 24 hours</MenuItem>
          </Select>
        </FormControl>
      </Box>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        {METRIC_CHARTS.map((chart, ci) => {
          const data = generateChartData(chart.lines, ci);
          return (
            <Card key={chart.title} variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" color={chart.color} fontWeight={600} mb={1}>
                  <Icon
                    icon={chart.icon}
                    width={16}
                    style={{ verticalAlign: 'middle', marginRight: 4 }}
                  />
                  {chart.title}
                </Typography>
                {/* SVG chart replica matching Recharts LineChart layout */}
                <Box sx={{ width: '100%', height: 180, position: 'relative' }}>
                  <svg width="100%" height="100%" viewBox="0 0 400 180" preserveAspectRatio="none">
                    {/* CartesianGrid */}
                    {[36, 72, 108, 144].map(y => (
                      <line
                        key={y}
                        x1="40"
                        y1={y}
                        x2="390"
                        y2={y}
                        stroke="#ccc"
                        strokeWidth="0.5"
                        strokeDasharray="3 3"
                      />
                    ))}
                    {/* XAxis baseline */}
                    <line x1="40" y1="160" x2="390" y2="160" stroke="#ccc" strokeWidth="1" />
                    {/* YAxis */}
                    <line x1="40" y1="10" x2="40" y2="160" stroke="#ccc" strokeWidth="1" />
                    {/* Lines */}
                    {chart.lines.map(line => {
                      const pts = data
                        .map((d, i) => {
                          const x = 40 + (i / (data.length - 1)) * 350;
                          const maxVal = Math.max(...data.map(p => p[line.key] || 0), 1);
                          const y = 160 - ((d[line.key] || 0) / maxVal) * 140;
                          return `${x},${y}`;
                        })
                        .join(' L');
                      return (
                        <path
                          key={line.key}
                          d={`M${pts}`}
                          fill="none"
                          stroke={line.color}
                          strokeWidth="2"
                          strokeDasharray={line.dash || undefined}
                        />
                      );
                    })}
                    {/* YAxis label */}
                    <text
                      x="8"
                      y="90"
                      fill="#999"
                      fontSize="10"
                      textAnchor="middle"
                      transform="rotate(-90 8 90)"
                    >
                      {chart.yLabel}
                    </text>
                    {/* XAxis labels */}
                    {[0, 7, 14, 21, 29].map(i => (
                      <text
                        key={i}
                        x={40 + (i / 29) * 350}
                        y="175"
                        fill="#999"
                        fontSize="9"
                        textAnchor="middle"
                      >
                        {data[i]?.time}
                      </text>
                    ))}
                  </svg>
                  {/* Legend */}
                  <Box sx={{ position: 'absolute', bottom: -4, left: 50, display: 'flex', gap: 2 }}>
                    {chart.lines.map(line => (
                      <Box key={line.key} display="flex" alignItems="center" gap={0.5}>
                        <Box
                          sx={{
                            width: 12,
                            height: 2,
                            bgcolor: line.color,
                            ...(line.dash ? { borderStyle: 'dashed' } : {}),
                          }}
                        />
                        <Typography variant="caption" sx={{ fontSize: 11 }}>
                          {line.name}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
      <Box mt={2}>
        <Typography variant="caption" color="text.secondary">
          Metrics refresh every 30 seconds. All rates use a 5-minute window.
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Querier Tab (PrometheusQuerier.tsx) ─────────────────────────────

function MockQuerierTab() {
  type MockPanel = { id: string; label: string; unit: string; group: string; col: number };
  const [panels, setPanels] = useState<MockPanel[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [timeRange, setTimeRange] = useState('30m');
  const [columns, setColumns] = useState<number>(1);

  const addedLabels = new Set(panels.map(p => p.label));
  const available = QUERIER_PRESETS.filter(p => !addedLabels.has(p.label)).sort((a, b) =>
    a.group.localeCompare(b.group)
  );
  const chartHeight = columns === 1 ? 220 : columns === 2 ? 180 : 150;

  const colArrays: MockPanel[][] = Array.from({ length: columns }, () => []);
  panels.forEach(p => {
    colArrays[Math.min(p.col, columns - 1)].push(p);
  });

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={2}
      sx={{ overflow: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }}
    >
      {/* Toolbar */}
      <Box display="flex" gap={1} alignItems="center" flexShrink={0} flexWrap="wrap">
        <Autocomplete
          sx={{ flex: '1 1 50%', minWidth: 250, maxWidth: '50%' }}
          options={available}
          groupBy={opt => opt.group}
          getOptionLabel={opt => opt.label}
          value={null}
          inputValue={inputValue}
          onInputChange={(_, v, r) => {
            if (r === 'reset') setInputValue('');
            else setInputValue(v);
          }}
          onChange={(_, value) => {
            if (value) {
              const colCounts = Array.from(
                { length: columns },
                (_, i) => panels.filter(p => Math.min(p.col, columns - 1) === i).length
              );
              const minCol = colCounts.indexOf(Math.min(...colCounts));
              setPanels(prev => [
                ...prev,
                {
                  id: `p-${Date.now()}`,
                  label: value.label,
                  unit: value.unit,
                  group: value.group,
                  col: minCol,
                },
              ]);
              setInputValue('');
            }
          }}
          blurOnSelect
          clearOnBlur
          renderOption={(props, opt) => (
            <li {...props} key={opt.label}>
              <Box display="flex" justifyContent="space-between" width="100%" alignItems="center">
                <Typography variant="body2">{opt.label}</Typography>
                <Box display="flex" gap={0.5} alignItems="center">
                  <Chip
                    label={opt.group}
                    size="small"
                    sx={{
                      fontSize: '0.6rem',
                      height: 18,
                      bgcolor: GROUP_COLORS[opt.group] || '#757575',
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  />
                  <Chip
                    label={opt.unit}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem', height: 20 }}
                  />
                </Box>
              </Box>
            </li>
          )}
          renderInput={params => (
            <TextField
              {...params}
              size="small"
              placeholder="Add a metric..."
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <Icon
                      icon="mdi:chart-line"
                      width={18}
                      style={{ marginRight: 8, opacity: 0.5 }}
                    />
                    {params.InputProps.startAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <FormControl size="small" sx={{ ml: 'auto' }}>
          <Select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            sx={{ minWidth: 130 }}
          >
            {['5m', '15m', '30m', '1h', '3h', '6h', '12h', '24h'].map(v => (
              <MenuItem key={v} value={v}>
                {v.replace('m', ' min').replace('h', ' hour')}
                {parseInt(v) > 1 && v.endsWith('h') ? 's' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <ToggleButtonGroup
          value={columns}
          exclusive
          onChange={(_, v) => {
            if (v !== null) setColumns(v);
          }}
          size="small"
          sx={{ flexShrink: 0 }}
        >
          {[
            { v: 1, icon: 'mdi:view-sequential', tip: '1 column' },
            { v: 2, icon: 'mdi:view-grid', tip: '2 columns' },
            { v: 3, icon: 'mdi:view-module', tip: '3 columns' },
          ].map(c => (
            <ToggleButton key={c.v} value={c.v} sx={{ px: 1, py: 0.5 }}>
              <Tooltip title={c.tip} arrow>
                <Box display="flex">
                  <Icon icon={c.icon} width={18} />
                </Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Chart panels in columns */}
      {panels.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          {colArrays.map((colPanels, ci) => (
            <Box
              key={ci}
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                minHeight: 100,
              }}
            >
              {colPanels.map((panel, pi) => {
                const groupColor = GROUP_COLORS[panel.group] || '#757575';
                const lineColor = CHART_COLORS[pi % CHART_COLORS.length];
                const data = generateChartData([{ key: 'value' }], pi * 17 + ci * 7);
                return (
                  <Card
                    key={panel.id}
                    variant="outlined"
                    sx={{ borderLeft: `3px solid ${groupColor}` }}
                  >
                    <CardContent sx={{ pb: '12px !important' }}>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={1}
                        mb={1}
                        sx={{
                          cursor: 'grab',
                          userSelect: 'none',
                          '&:active': { cursor: 'grabbing' },
                        }}
                        draggable
                      >
                        <Icon
                          icon="mdi:drag-horizontal-variant"
                          width={16}
                          style={{ opacity: 0.4, flexShrink: 0 }}
                        />
                        <Typography
                          variant="subtitle2"
                          fontWeight={600}
                          noWrap
                          sx={{ minWidth: 0 }}
                        >
                          {panel.label}
                        </Typography>
                        <Chip
                          label="1 series"
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.7rem', flexShrink: 0 }}
                        />
                        <Chip
                          label={panel.unit}
                          size="small"
                          sx={{ fontSize: '0.7rem', bgcolor: 'action.selected', flexShrink: 0 }}
                        />
                        <Chip
                          label={panel.group}
                          size="small"
                          sx={{
                            fontSize: '0.6rem',
                            bgcolor: groupColor,
                            color: '#fff',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        />
                        <Box flex={1} />
                        <IconButton
                          size="small"
                          onClick={() => setPanels(prev => prev.filter(p => p.id !== panel.id))}
                          sx={{ p: 0.25, flexShrink: 0 }}
                        >
                          <Icon icon="mdi:close" width={16} />
                        </IconButton>
                      </Box>
                      <Box sx={{ height: chartHeight, position: 'relative' }}>
                        <svg
                          width="100%"
                          height="100%"
                          viewBox="0 0 400 160"
                          preserveAspectRatio="none"
                        >
                          {[40, 80, 120].map(y => (
                            <line
                              key={y}
                              x1="40"
                              y1={y}
                              x2="390"
                              y2={y}
                              stroke="#ccc"
                              strokeWidth="0.5"
                              strokeDasharray="3 3"
                            />
                          ))}
                          <path
                            d={`M${data
                              .map((d, i) => `${40 + (i / 29) * 350},${150 - (d.value / 80) * 130}`)
                              .join(' L')}`}
                            fill="none"
                            stroke={lineColor}
                            strokeWidth="2"
                          />
                          {[0, 7, 14, 21, 29].map(i => (
                            <text
                              key={i}
                              x={40 + (i / 29) * 350}
                              y="158"
                              fill="#999"
                              fontSize={columns > 1 ? 8 : 10}
                              textAnchor="middle"
                            >
                              {data[i]?.time}
                            </text>
                          ))}
                        </svg>
                        {columns === 1 && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: -2,
                              left: 50,
                              display: 'flex',
                              gap: 1,
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={0.5}>
                              <Box sx={{ width: 12, height: 2, bgcolor: lineColor }} />
                              <Typography variant="caption" sx={{ fontSize: 12 }}>
                                value
                              </Typography>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      {/* Empty state */}
      {panels.length === 0 && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, minHeight: 0 }}
        >
          <Box sx={{ maxWidth: 560, textAlign: 'center' }}>
            <Icon icon="mdi:chart-line" width={56} style={{ opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
              Prometheus Querier
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
              Query KubeVirt metrics directly from Prometheus. Select pre-built metrics from the
              dropdown above to visualize CPU, memory, network, storage, and migration activity for
              this VM in real time.
            </Typography>
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
                {
                  icon: 'mdi:menu-down',
                  text: 'Pick metrics from the dropdown — grouped by category',
                },
                {
                  icon: 'mdi:chart-multiple',
                  text: 'Add multiple charts side by side (1–3 columns)',
                },
                { icon: 'mdi:drag', text: 'Drag & drop to reorder charts between columns' },
                { icon: 'mdi:clock-outline', text: 'Adjust time range: 5m to 24h' },
                { icon: 'mdi:refresh', text: 'Auto-refresh every 30 seconds' },
                {
                  icon: 'mdi:database-search',
                  text: 'Pre-built PromQL — CPU, memory, network, storage, migration',
                },
              ].map((hint, i) => (
                <Box
                  key={i}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75 }}
                >
                  <Icon icon={hint.icon} width={18} style={{ opacity: 0.6, flexShrink: 0 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem' }}>
                    {hint.text}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
              Select a metric from the dropdown above to get started.
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── Logs Tab (PodLogsTab.tsx) ───────────────────────────────────────

function MockLogsTab() {
  const [selectedContainer, setSelectedContainer] = useState('compute');
  const [tailLines, setTailLines] = useState(1000);
  const [search, setSearch] = useState('');
  const [wrapLines, setWrapLines] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const matchCount = search
    ? MOCK_LOGS.split('\n').filter(l => l.toLowerCase().includes(search.toLowerCase())).length
    : 0;

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        <FormControl size="small">
          <Select
            value={selectedContainer}
            onChange={e => setSelectedContainer(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {[
              'compute',
              'guest-console-log',
              'volumecontainerdisk-init',
              'container-disk-binary',
            ].map(c => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <Select
            value={tailLines}
            onChange={e => setTailLines(e.target.value as number)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value={100}>100 lines</MenuItem>
            <MenuItem value={500}>500 lines</MenuItem>
            <MenuItem value={1000}>1000 lines</MenuItem>
            <MenuItem value={5000}>5000 lines</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Filter logs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon="mdi:magnify" width={18} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <Typography variant="caption" sx={{ mr: 0.5 }}>
                  {matchCount} matches
                </Typography>
                <IconButton size="small" onClick={() => setSearch('')}>
                  <Icon icon="mdi:close" width={16} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{ minWidth: 220 }}
        />
        <ToggleButtonGroup size="small">
          <ToggleButton value="wrap" selected={wrapLines} onChange={() => setWrapLines(!wrapLines)}>
            <Tooltip title="Wrap lines">
              <span>
                <Icon icon="mdi:wrap" width={18} />
              </span>
            </Tooltip>
          </ToggleButton>
          <ToggleButton
            value="scroll"
            selected={autoScroll}
            onChange={() => setAutoScroll(!autoScroll)}
          >
            <Tooltip title="Auto-scroll">
              <span>
                <Icon icon="mdi:arrow-collapse-down" width={18} />
              </span>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        <Button size="small" startIcon={<Icon icon="mdi:content-copy" width={16} />}>
          Copy
        </Button>
        <Button size="small" startIcon={<Icon icon="mdi:download" width={16} />}>
          Download
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Pod: {POD_NAME} | Container: {selectedContainer} | Refresh: 5s
      </Typography>
      <Box
        component="pre"
        sx={{
          bgcolor: '#1e1e1e',
          color: '#d4d4d4',
          p: 2,
          borderRadius: 1,
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
          fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
          fontSize: '0.8rem',
          lineHeight: 1.5,
          whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
          wordBreak: wrapLines ? 'break-all' : 'normal',
          m: 0,
          '&::-webkit-scrollbar': { width: 8 },
          '&::-webkit-scrollbar-track': { bgcolor: '#2d2d2d' },
          '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
        }}
      >
        {MOCK_LOGS}
      </Box>
    </Box>
  );
}

// ─── VM Shell Tab (VMShellTab.tsx) ───────────────────────────────────

function MockVMShellTab() {
  const [mode, setMode] = useState<'vnc' | 'terminal'>('vnc');
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connected');

  const statusColor =
    connectionStatus === 'connected'
      ? '#4caf50'
      : connectionStatus === 'connecting'
      ? '#ff9800'
      : '#f44336';

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      <Box display="flex" alignItems="center" gap={1.5}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => {
            if (v !== null) {
              setMode(v);
              setConnectionStatus('connecting');
              setTimeout(() => setConnectionStatus('connected'), 800);
            }
          }}
          size="small"
        >
          <ToggleButton value="vnc">
            <Icon icon="mdi:monitor" width={16} />
            <Typography variant="body2" sx={{ ml: 0.5 }}>
              VNC
            </Typography>
          </ToggleButton>
          <ToggleButton value="terminal">
            <Icon icon="mdi:console" width={16} />
            <Typography variant="body2" sx={{ ml: 0.5 }}>
              Serial
            </Typography>
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColor }} />
        <Typography variant="caption" color="text.secondary">
          {connectionStatus}
        </Typography>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          borderRadius: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {mode === 'vnc' ? (
          /* Mock VNC canvas */
          <Box
            sx={{
              flex: 1,
              bgcolor: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <Box
              sx={{
                width: '100%',
                maxWidth: 800,
                aspectRatio: '4/3',
                bgcolor: '#1a1a2e',
                borderRadius: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #333',
              }}
            >
              <Typography variant="h5" sx={{ color: '#e0e0e0', fontFamily: 'monospace', mb: 1 }}>
                Fedora Linux 39 (Server Edition)
              </Typography>
              <Typography variant="body1" sx={{ color: '#aaa', fontFamily: 'monospace' }}>
                Kernel 6.5.6-300.fc39.x86_64 on an x86_64
              </Typography>
              <Box sx={{ mt: 3, display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ color: '#e0e0e0', fontFamily: 'monospace' }}>
                  fedora-server-01 login:{' '}
                </Typography>
                <Box
                  sx={{
                    width: 8,
                    height: 16,
                    bgcolor: '#e0e0e0',
                    animation: 'blink 1s step-end infinite',
                  }}
                />
              </Box>
            </Box>
          </Box>
        ) : (
          /* Mock serial terminal */
          <Box
            sx={{
              flex: 1,
              bgcolor: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: '"Fira Code", monospace',
              fontSize: '0.85rem',
              p: 2,
              overflow: 'auto',
            }}
          >
            <div>Fedora Linux 39 (Server Edition)</div>
            <div>Kernel 6.5.6-300.fc39.x86_64 on an x86_64</div>
            <div>&nbsp;</div>
            <div>
              fedora-server-01 login:{' '}
              <span style={{ borderRight: '2px solid #d4d4d4' }}>&nbsp;</span>
            </div>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Pod Shell Tab (VirtLauncherExec.tsx) ────────────────────────────

function MockPodShellTab() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ height: '100%' }}>
      <Box display="flex" gap={1.5} sx={{ flex: 1, minHeight: 300 }}>
        {/* Terminal */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <MockTerminalUI
            status="connected"
            podLabel={POD_NAME}
            containerLabel="compute"
            toolbarExtra={
              <>
                <Chip
                  label={`domain: ${DOMAIN}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                />
                <Chip
                  icon={<Icon icon="mdi:help-circle-outline" width={16} />}
                  label="Command Reference"
                  size="small"
                  variant={showHelp ? 'filled' : 'outlined'}
                  onClick={() => setShowHelp(!showHelp)}
                  sx={{
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontSize: '0.75rem',
                    bgcolor: showHelp ? 'action.selected' : undefined,
                  }}
                />
              </>
            }
            lines={
              <>
                <div>Connecting to virt-launcher compute container...</div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: '#4caf50' }}>sh-5.2#</span> virsh list --all
                </div>
                <div style={{ marginTop: 4 }}> Id Name State</div>
                <div>----------------------------------------------------</div>
                <div> 1 {DOMAIN} running</div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: '#4caf50' }}>sh-5.2#</span> virsh dominfo {DOMAIN}
                </div>
                <div>Id: 1</div>
                <div>Name: {DOMAIN}</div>
                <div>UUID: a1b2c3d4-e5f6-7890-abcd-ef1234567890</div>
                <div>OS Type: hvm</div>
                <div>State: running</div>
                <div>CPU(s): 2</div>
                <div>Max memory: 4194304 KiB</div>
                <div>Used memory: 4194304 KiB</div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: '#4caf50' }}>sh-5.2#</span>{' '}
                  <span style={{ borderRight: '2px solid #d4d4d4' }}>&nbsp;</span>
                </div>
              </>
            }
          />
        </Box>

        {/* Right sidebar — command reference */}
        {showHelp && (
          <CommandSidebar
            title="Command Reference"
            subtitle="Click to execute, copy icon to clipboard"
            icon="mdi:help-circle-outline"
            commands={VIRSH_HELP_COMMANDS}
            onExec={() => {}}
            onClose={() => setShowHelp(false)}
            hasAgent
          />
        )}
      </Box>
    </Box>
  );
}

// ─── YAML Tab (YAMLEditorTab.tsx) ────────────────────────────────────

function MockYAMLTab() {
  const [resourceKind, setResourceKind] = useState('vm');
  const [useMinimalEditor, setUseMinimalEditor] = useState(false);
  const [dirty] = useState(false);

  const RESOURCE_OPTIONS = [
    { kind: 'vm', label: 'VM', icon: 'mdi:server', tooltip: 'VirtualMachine', editable: true },
    {
      kind: 'vmi',
      label: 'VMI',
      icon: 'mdi:server-network',
      tooltip: 'VirtualMachineInstance (read-only)',
      editable: false,
    },
    {
      kind: 'pod',
      label: 'Pod',
      icon: 'mdi:cube-outline',
      tooltip: 'Virt-launcher Pod (read-only)',
      editable: false,
    },
    {
      kind: 'dv',
      label: 'DV',
      icon: 'mdi:database',
      tooltip: 'DataVolume (read-only)',
      editable: false,
    },
  ];
  const isReadOnly = resourceKind !== 'vm';

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        <ToggleButtonGroup
          value={resourceKind}
          exclusive
          onChange={(_, v) => {
            if (v) setResourceKind(v);
          }}
          size="small"
        >
          {RESOURCE_OPTIONS.map(opt => (
            <ToggleButton key={opt.kind} value={opt.kind}>
              <Tooltip title={opt.tooltip}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Icon icon={opt.icon} width={16} />
                  {opt.label}
                </Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box flexGrow={1} />
        <FormControlLabel
          control={
            <Switch
              checked={useMinimalEditor}
              onChange={() => setUseMinimalEditor(!useMinimalEditor)}
              size="small"
            />
          }
          label={<Typography variant="caption">Minimal editor</Typography>}
          sx={{ mr: 0 }}
        />
        <Button size="small" startIcon={<Icon icon="mdi:refresh" width={16} />}>
          Refresh
        </Button>
        <Button size="small" startIcon={<Icon icon="mdi:content-copy" width={16} />}>
          Copy
        </Button>
        <Button size="small" startIcon={<Icon icon="mdi:download" width={16} />}>
          Download
        </Button>
        {!isReadOnly && (
          <>
            <Button size="small" disabled={!dirty}>
              Reset
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={!dirty}
              startIcon={<Icon icon="mdi:content-save" width={16} />}
            >
              Save &amp; Apply
            </Button>
          </>
        )}
      </Box>
      {isReadOnly && (
        <Typography variant="caption" color="text.secondary">
          Read-only —{' '}
          {resourceKind === 'vmi' ? 'VMI' : resourceKind === 'pod' ? 'Pod' : 'DataVolume'} resources
          cannot be edited directly.
        </Typography>
      )}
      {/* Editor area — mock Monaco */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: '#1e1e1e',
            borderRadius: 1,
            overflow: 'auto',
            display: 'flex',
          }}
        >
          {/* Line numbers */}
          <Box
            sx={{
              width: 48,
              bgcolor: '#1e1e1e',
              borderRight: '1px solid #333',
              py: 1,
              textAlign: 'right',
              pr: 1,
              flexShrink: 0,
            }}
          >
            {MOCK_YAML.split('\n').map((_, i) => (
              <Typography
                key={i}
                variant="caption"
                sx={{
                  display: 'block',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  lineHeight: 1.5,
                  color: '#858585',
                }}
              >
                {i + 1}
              </Typography>
            ))}
          </Box>
          {/* Code area */}
          <Box
            component="pre"
            sx={{
              flex: 1,
              m: 0,
              p: 1,
              fontFamily: '"Fira Code", monospace',
              fontSize: '0.8rem',
              lineHeight: 1.5,
              color: '#d4d4d4',
              whiteSpace: 'pre',
            }}
          >
            {MOCK_YAML.split('\n').map((line, i) => {
              const keyMatch = line.match(/^(\s*)([\w.-]+)(:)(.*)/);
              if (keyMatch) {
                return (
                  <div key={i}>
                    {keyMatch[1]}
                    <span style={{ color: '#9cdcfe' }}>{keyMatch[2]}</span>
                    <span style={{ color: '#d4d4d4' }}>{keyMatch[3]}</span>
                    <span
                      style={{
                        color:
                          line.includes('true') || line.includes('false') ? '#569cd6' : '#ce9178',
                      }}
                    >
                      {keyMatch[4]}
                    </span>
                  </div>
                );
              }
              return (
                <div key={i} style={{ color: line.trim().startsWith('-') ? '#ce9178' : '#d4d4d4' }}>
                  {line}
                </div>
              );
            })}
          </Box>
          {/* Minimap */}
          <Box
            sx={{
              width: 60,
              bgcolor: '#1e1e1e',
              borderLeft: '1px solid #333',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: 'scaleY(0.15) scaleX(0.5)',
                transformOrigin: 'top left',
                opacity: 0.5,
              }}
            >
              <pre
                style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#d4d4d4', margin: 0 }}
              >
                {MOCK_YAML}
              </pre>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Memory Dump Tab (MemoryDumpTab.tsx) ─────────────────────────────

function MockMemoryDumpTab() {
  type MemDumpView = 'detail' | 'terminal';
  const [selectedDump, setSelectedDump] = useState<string | null>(MOCK_DUMP_PVCS[1].name);
  const [view, setView] = useState<MemDumpView>('detail');
  const [showCmdRef, setShowCmdRef] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNewDumpForm, setShowNewDumpForm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  const selectedPVC = MOCK_DUMP_PVCS.find(d => d.name === selectedDump);
  const kernelRelease = '6.5.6-300.fc39.x86_64';

  const renderDumpItem = (dump: (typeof MOCK_DUMP_PVCS)[0]) => {
    const isSelected = selectedDump === dump.name;
    const effectivePhase =
      dump.isActive && dump.activePhase
        ? dump.activePhase
        : dump.phase === 'Bound'
        ? 'Completed'
        : dump.phase;
    const effectiveColor =
      effectivePhase === 'Completed'
        ? '#3e8635'
        : effectivePhase === 'InProgress'
        ? '#f0ab00'
        : '#c9190b';
    const effectiveIcon =
      effectivePhase === 'Completed'
        ? 'mdi:check-circle'
        : effectivePhase === 'InProgress'
        ? 'mdi:progress-clock'
        : 'mdi:help-circle-outline';

    return (
      <Box
        key={dump.name}
        onClick={() => {
          setSelectedDump(dump.name);
          setView('detail');
        }}
        sx={{
          p: 0.75,
          borderRadius: 1,
          cursor: 'pointer',
          border: '1px solid',
          borderColor: isSelected ? 'primary.main' : 'divider',
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          opacity: 1,
          transition: 'all 0.15s',
          '&:hover': {
            bgcolor: isSelected ? 'action.selected' : 'action.hover',
            borderColor: isSelected ? 'primary.main' : 'text.secondary',
          },
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
              {dump.size} &middot; {new Date(dump.created).toLocaleString()}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={e => e.stopPropagation()}
            sx={{ p: 0.25, flexShrink: 0 }}
          >
            <Icon icon="mdi:delete-outline" width={14} />
          </IconButton>
        </Box>
      </Box>
    );
  };

  const renderOnboarding = () => (
    <Box display="flex" alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ maxWidth: 520, textAlign: 'center' }}>
        <Icon icon="mdi:memory" width={56} style={{ opacity: 0.6 }} />
        <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
          Memory Forensics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
          Capture a full memory dump of the running VM and analyze it with{' '}
          <Tooltip title="ghcr.io/forensic/vol3-toolbox:latest" arrow placement="top">
            <span style={{ fontWeight: 600, cursor: 'help', borderBottom: '1px dotted' }}>
              Volatility3
            </span>
          </Tooltip>{' '}
          directly inside the cluster. Detect rootkits, inspect processes, recover credentials, and
          audit kernel modules — all from a live or post-mortem dump.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 2.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { icon: 'mdi:harddisk', text: 'PVC: 6Gi (auto-sized)' },
            { icon: 'mdi:check-decagram', text: `Kernel: ${kernelRelease}`, color: '#3e8635' },
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Create your first memory dump using <strong>New Dump</strong> in the sidebar.
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  const renderAnalysisLanding = () => (
    <Box display="flex" alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ maxWidth: 540, textAlign: 'center' }}>
        <Icon icon="mdi:flask" width={48} style={{ opacity: 0.6 }} />
        <Typography variant="h6" sx={{ mt: 1, fontWeight: 700, fontSize: '1rem' }}>
          Forensic Analysis Pod
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.6 }}>
          Launch a{' '}
          <Tooltip title="ghcr.io/forensic/vol3-toolbox:latest" arrow placement="top">
            <span style={{ fontWeight: 600, cursor: 'help', borderBottom: '1px dotted' }}>
              Volatility3
            </span>
          </Tooltip>{' '}
          pod with the dump volume mounted at <code>/dump</code>. ISF symbols for {kernelRelease}{' '}
          will be auto-mounted via init container.
        </Typography>
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
          <Icon icon="mdi:check-decagram" width={18} color="#3e8635" />
          <Typography variant="caption" sx={{ fontSize: '0.8rem' }}>
            Kernel: <strong>{kernelRelease}</strong> — ISF image:{' '}
            <code style={{ fontSize: '0.7rem' }}>ghcr.io/forensic/isf:{kernelRelease}</code>
          </Typography>
        </Box>
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
            { icon: 'mdi:book-open-variant', text: 'Command reference sidebar with click-to-run' },
            { icon: 'mdi:rename', text: 'Rename dumps with friendly labels' },
            { icon: 'mdi:delete-clock', text: 'Cleanup prompt on close — or keep pod for later' },
          ].map((hint, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75 }}>
              <Icon icon={hint.icon} width={18} style={{ opacity: 0.6, flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                {hint.text}
              </Typography>
            </Box>
          ))}
        </Box>
        <Button
          variant="contained"
          onClick={() => setView('terminal')}
          startIcon={<Icon icon="mdi:flask-outline" width={20} />}
          sx={{ mt: 3, px: 4, py: 1 }}
        >
          Launch Analysis Pod
        </Button>
      </Box>
    </Box>
  );

  const renderTerminal = () => (
    <Box display="flex" flexDirection="column" gap={0} sx={{ flex: 1, minHeight: 0 }}>
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
        <Tooltip title={`ISF: ghcr.io/forensic/isf:${kernelRelease}`} arrow placement="top">
          <Box display="flex" alignItems="center" gap={0.5} sx={{ cursor: 'help' }}>
            <Icon icon="mdi:check-circle" width={13} color="#3e8635" />
            <Typography variant="caption" sx={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>
              {kernelRelease}
            </Typography>
          </Box>
        </Tooltip>
        <Box flex={1} />
        <Box display="flex" alignItems="center" gap={0.75}>
          <Box
            sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#3e8635', flexShrink: 0 }}
          />
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 500 }}
          >
            connected
          </Typography>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
          <Icon icon="mdi:flask" width={14} style={{ opacity: 0.7 }} />
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 600 }}
          >
            vol3 @ vol3-{selectedDump}
          </Typography>
        </Box>
        <Box flex={1} />
        <Tooltip title="Command Reference" arrow>
          <IconButton
            size="small"
            onClick={() => setShowCmdRef(!showCmdRef)}
            sx={{ p: 0.25, bgcolor: showCmdRef ? 'action.selected' : undefined, borderRadius: 0.5 }}
          >
            <Icon icon="mdi:help-circle-outline" width={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fullscreen" arrow>
          <IconButton size="small" sx={{ p: 0.25, borderRadius: 0.5 }}>
            <Icon icon="mdi:fullscreen" width={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close & delete pod" arrow>
          <IconButton
            size="small"
            onClick={() => setView('detail')}
            sx={{ p: 0.25, borderRadius: 0.5, color: 'error.main' }}
          >
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box
            sx={{
              flex: 1,
              bgcolor: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: '"Fira Code", monospace',
              fontSize: '0.8rem',
              p: 1.5,
              overflow: 'auto',
            }}
          >
            <div>
              <span style={{ color: '#4caf50' }}>root@vol3-{selectedDump}</span>:
              <span style={{ color: '#42a5f5' }}>/dump</span>$ vol-qemu linux.pslist.PsList
            </div>
            <div style={{ color: '#888', marginTop: 4 }}>Volatility 3 Framework 2.5.2</div>
            <div style={{ marginTop: 8 }}>PID PPID COMM OFFSET</div>
            <div>1 0 systemd 0x8802a0c0</div>
            <div>2 0 kthreadd 0x8802a4c0</div>
            <div>423 1 sshd 0x88047100</div>
            <div>891 423 bash 0x88051c80</div>
            <div>1024 891 python3 0x88063200</div>
            <div style={{ marginTop: 12 }}>
              <span style={{ color: '#4caf50' }}>root@vol3-{selectedDump}</span>:
              <span style={{ color: '#42a5f5' }}>/dump</span>${' '}
              <span style={{ borderRight: '2px solid #d4d4d4' }}>&nbsp;</span>
            </div>
          </Box>
        </Box>
        {showCmdRef && (
          <CommandSidebar
            title="Forensic Commands"
            subtitle="Click to execute, copy icon to clipboard"
            icon="mdi:flask"
            commands={FORENSIC_COMMANDS}
            onExec={() => {}}
            onClose={() => setShowCmdRef(false)}
          />
        )}
      </Box>
    </Box>
  );

  const renderMainContent = () => {
    if (!selectedDump || !selectedPVC) {
      if (MOCK_DUMP_PVCS.length === 0) return renderOnboarding();
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

    const effectivePhase =
      selectedPVC.isActive && selectedPVC.activePhase
        ? selectedPVC.activePhase
        : selectedPVC.phase === 'Bound'
        ? 'Completed'
        : selectedPVC.phase;
    const dumpIsCompleted = effectivePhase === 'Completed';

    return (
      <Box display="flex" flexDirection="column" gap={1.5} sx={{ flex: 1, minHeight: 0 }}>
        <Box display="flex" alignItems="center" gap={0.75} flexShrink={0}>
          <Tooltip title={effectivePhase} arrow>
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              <Icon icon="mdi:check-circle" width={18} color="#3e8635" />
            </Box>
          </Tooltip>
          {editingName ? (
            <TextField
              size="small"
              value={editNameValue}
              onChange={e => setEditNameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false);
              }}
              onBlur={() => setEditingName(false)}
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
                  setEditNameValue(selectedPVC.displayName || '');
                  setEditingName(true);
                }}
              >
                {selectedPVC.displayName || selectedDump}
              </Typography>
              <Tooltip title="Rename" arrow>
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditNameValue(selectedPVC.displayName || '');
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
            {selectedPVC.size}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
            {new Date(selectedPVC.created).toLocaleString()}
          </Typography>
          <Box flex={1} />
          {dumpIsCompleted && (
            <Tooltip title="Copy download command" arrow>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  bgcolor: 'action.hover',
                  borderRadius: 0.5,
                  px: 1,
                  py: 0.25,
                  cursor: 'pointer',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: 'text.secondary' }}
                >
                  virtctl memory-dump download {VM_NAME} -n {NAMESPACE} --output=dump.gz
                </Typography>
                <Icon icon="mdi:content-copy" width={12} style={{ opacity: 0.5 }} />
              </Box>
            </Tooltip>
          )}
          {selectedPVC.isActive && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<Icon icon="mdi:close-circle-outline" width={14} />}
              sx={{ fontSize: '0.7rem', py: 0.25 }}
            >
              Deselect
            </Button>
          )}
        </Box>
        {dumpIsCompleted && view === 'detail' && renderAnalysisLanding()}
        {dumpIsCompleted && view === 'terminal' && renderTerminal()}
      </Box>
    );
  };

  const showTerminal = view === 'terminal';

  return (
    <Box display="flex" gap={1.5} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
            <IconButton size="small" onClick={() => setSidebarOpen(!sidebarOpen)} sx={{ p: 0.25 }}>
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
                label={MOCK_DUMP_PVCS.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
              <Tooltip title="Refresh" arrow>
                <IconButton size="small" sx={{ p: 0.25 }}>
                  <Icon icon="mdi:refresh" width={16} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
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
          {MOCK_DUMP_PVCS.map(dump => renderDumpItem(dump))}
        </Box>
        {sidebarOpen && <Divider />}
        <Box sx={{ p: 1.5, display: sidebarOpen ? 'block' : 'none' }}>
          {!showNewDumpForm ? (
            <Button
              fullWidth
              variant="outlined"
              onClick={() => setShowNewDumpForm(true)}
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
                <IconButton size="small" onClick={() => setShowNewDumpForm(false)} sx={{ p: 0.25 }}>
                  <Icon icon="mdi:close" width={14} />
                </IconButton>
              </Box>
              <Box display="flex" alignItems="center" gap={0.5}>
                <Chip
                  icon={<Icon icon="mdi:memory" width={12} />}
                  label="4Gi"
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.5 } }}
                />
                <Chip
                  icon={<Icon icon="mdi:harddisk" width={12} />}
                  label="PVC: 6Gi"
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.5 } }}
                />
              </Box>
              <TextField
                label="Display Name (optional)"
                size="small"
                fullWidth
                placeholder="e.g. Pre-upgrade snapshot"
                InputProps={{ sx: { fontSize: '0.75rem' } }}
                InputLabelProps={{ sx: { fontSize: '0.8rem' } }}
              />
              <TextField
                label="PVC Name"
                size="small"
                fullWidth
                defaultValue={`${VM_NAME}-memdump-${Date.now().toString(36)}`}
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                InputLabelProps={{ sx: { fontSize: '0.8rem' } }}
              />
              <FormControl size="small" fullWidth>
                <Select value="local-path" sx={{ fontSize: '0.8rem' }}>
                  <MenuItem value="local-path" sx={{ fontSize: '0.8rem' }}>
                    local-path
                  </MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained"
                startIcon={<Icon icon="mdi:download-circle" width={16} />}
                fullWidth
                sx={{ fontSize: '0.8rem' }}
              >
                Dump
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DIALOG MOCK (VMDoctorDialog.tsx)
// ═══════════════════════════════════════════════════════════════════

interface VMDoctorMockProps {
  isRunning: boolean;
}

function VMDoctorMock({ isRunning }: VMDoctorMockProps) {
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState(TAB_CONDITIONS);

  const vmiPhase = isRunning ? 'Running' : 'Stopped';
  const vmStatus = isRunning ? 'Running' : 'Stopped';
  const hasPod = isRunning;
  const hasAgent = isRunning;

  const tabs: TabDef[] = [
    {
      icon: 'mdi:card-account-details',
      label: 'Guest Info',
      disabled: !isRunning || !hasAgent,
      reason: !isRunning ? 'VM is not running.' : 'QEMU Guest Agent not installed.',
    },
    { icon: 'mdi:clipboard-check-outline', label: 'Conditions' },
    { icon: 'mdi:timeline-alert', label: 'Events' },
    {
      icon: 'mdi:chart-line',
      label: 'Metrics',
      disabled: !isRunning,
      reason: 'VM is not running.',
    },
    {
      icon: 'mdi:database-search',
      label: 'Querier',
      disabled: !isRunning,
      reason: 'VM is not running.',
    },
    {
      icon: 'mdi:text-box-outline',
      label: 'Logs',
      disabled: !hasPod,
      reason: 'No virt-launcher pod found.',
    },
    { icon: 'mdi:monitor', label: 'VM Shell', disabled: !isRunning, reason: 'VM is not running.' },
    {
      icon: 'mdi:console-line',
      label: 'Pod Shell',
      disabled: !hasPod,
      reason: 'No virt-launcher pod found.',
    },
    { icon: 'mdi:code-braces', label: 'YAML' },
    { icon: 'mdi:memory', label: 'Memory Dump' },
  ];

  const isShellTab = activeTab === TAB_VM_SHELL || activeTab === TAB_POD_SHELL;
  const isLogs = activeTab === TAB_LOGS;
  const isYaml = activeTab === TAB_YAML;
  const isMemDump = activeTab === TAB_MEMDUMP;
  const isFixedLayout = isShellTab || isLogs || isYaml || isMemDump;

  return (
    <>
      {!open && (
        <Button onClick={() => setOpen(true)} sx={{ m: 2 }} variant="outlined">
          Re-open VM Doctor
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: '94vw',
            maxWidth: '94vw',
            height: '96vh',
            maxHeight: '96vh',
            margin: '2vh 3vw',
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <Icon icon="mdi:stethoscope" width={24} />
          <Typography variant="h6" fontWeight={600} component="span">
            VM Doctor
          </Typography>
          <Typography variant="body1" color="text.secondary" component="span">
            {NAMESPACE}/{VM_NAME}
          </Typography>
          <Chip
            label={vmStatus}
            size="small"
            sx={{ bgcolor: getVMIPhaseColor(vmiPhase), color: 'white', fontWeight: 600 }}
          />
          <Box flexGrow={1} />
          {isRunning && (
            <Box display="flex" alignItems="center" gap={0.25}>
              {VM_ACTIONS.map(a => (
                <Tooltip key={a.id} title={a.label} arrow>
                  <span>
                    <IconButton size="small" disabled={a.disabled}>
                      <Icon icon={a.icon} width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              ))}
              <Tooltip title="Delete" arrow>
                <span>
                  <IconButton size="small">
                    <Icon icon="mdi:delete" width={18} color="#ef5350" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}
          <IconButton onClick={() => setOpen(false)} size="small">
            <Icon icon="mdi:close" width={20} />
          </IconButton>
        </DialogTitle>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <TabPanelHeader tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        </Box>

        <DialogContent
          sx={{
            pt: 2,
            overflow: isFixedLayout ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <TabContent activeTab={activeTab} index={TAB_GUEST_INFO}>
            <MockGuestInfoTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_CONDITIONS}>
            <MockConditionsTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_EVENTS}>
            <MockEventsTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_METRICS}>
            <MockMetricsTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_QUERIER} flex>
            <MockQuerierTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_LOGS} flex>
            <MockLogsTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_VM_SHELL} flex>
            <MockVMShellTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_POD_SHELL} flex>
            <MockPodShellTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_YAML} flex>
            <MockYAMLTab />
          </TabContent>
          <TabContent activeTab={activeTab} index={TAB_MEMDUMP} flex>
            <MockMemoryDumpTab />
          </TabContent>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STORYBOOK
// ═══════════════════════════════════════════════════════════════════

function StoryWrapper({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <SnackbarProvider maxSnack={3} autoHideDuration={3000}>
        {children}
      </SnackbarProvider>
    </BrowserRouter>
  );
}

export default {
  title: 'KubeVirt/VMDoctor',
  parameters: { layout: 'fullscreen' },
} as Meta;

export const RunningVM: StoryFn = () => (
  <StoryWrapper>
    <VMDoctorMock isRunning />
  </StoryWrapper>
);
RunningVM.storyName = 'Running VM (all tabs)';

export const StoppedVM: StoryFn = () => (
  <StoryWrapper>
    <VMDoctorMock isRunning={false} />
  </StoryWrapper>
);
StoppedVM.storyName = 'Stopped VM (limited tabs)';
