import { Icon } from '@iconify/react';
import { Alert, Box, Chip, Divider, IconButton, Typography } from '@mui/material';
import React, { useRef, useState } from 'react';
import CommandChip, { CommandDef } from './CommandChip';
import PodExecTerminal, { PodExecTerminalHandle } from './PodExecTerminal';

interface VirtLauncherExecProps {
  podName: string;
  namespace: string;
  hasAgent?: boolean;
}

function getHelpCommands(domain: string): Array<{ category: string; commands: CommandDef[] }> {
  return [
    {
      category: 'VM Status',
      commands: [
        {
          label: 'List VMs',
          command: 'virsh list --all 2>/dev/null',
          description: 'Show all VMs managed by libvirt on this node, including stopped ones',
        },
        {
          label: 'VM Info',
          command: `virsh dominfo ${domain} 2>/dev/null`,
          description: 'General info: UUID, memory, vCPUs, state, autostart, and security model',
        },
        {
          label: 'VM State',
          command: `virsh domstate ${domain} --reason 2>/dev/null`,
          description: 'Current state (running, paused, etc.) and the reason for that state',
        },
        {
          label: 'vCPU Info',
          command: `virsh vcpuinfo ${domain} 2>/dev/null`,
          description:
            'Per-vCPU details: which physical CPU it runs on, CPU time used, and pinning',
        },
      ],
    },
    {
      category: 'Resources',
      commands: [
        {
          label: 'Memory Stats',
          command: `virsh dommemstat ${domain} 2>/dev/null`,
          description: 'Memory usage breakdown: actual, available, swap, balloon, and RSS',
        },
        {
          label: 'Block Devices',
          command: `virsh domblklist ${domain} 2>/dev/null`,
          description: 'List all attached disks with their target device names and source paths',
        },
        {
          label: 'Block Stats',
          command: `virsh domblkstat ${domain} 2>/dev/null`,
          description: 'I/O statistics: read/write operations, bytes transferred, and errors',
        },
        {
          label: 'Network Interfaces',
          command: `virsh domiflist ${domain} 2>/dev/null`,
          description:
            'List all network interfaces with their type, source, model, and MAC address',
        },
        {
          label: 'Network Stats',
          command: `virsh domifstat ${domain} $(virsh domiflist ${domain} 2>/dev/null | awk 'NR>2 && NF{print $1; exit}') 2>/dev/null`,
          description:
            'Network I/O counters for the first interface: packets, bytes, drops, and errors',
        },
      ],
    },
    {
      category: 'Configuration',
      commands: [
        {
          label: 'VM XML',
          command: `virsh dumpxml ${domain} 2>/dev/null | more`,
          description: "Full libvirt XML definition — the ground truth of this VM's configuration",
        },
        {
          label: 'QEMU Args',
          command: `virsh qemu-monitor-command ${domain} --hmp 'info version' 2>/dev/null`,
          description: 'QEMU hypervisor version running this VM',
        },
        {
          label: 'QEMU Threads',
          command: `virsh qemu-monitor-command ${domain} --hmp 'info cpus' 2>/dev/null`,
          description: 'Thread-to-CPU mapping — shows which host threads handle each vCPU',
        },
      ],
    },
    {
      category: 'Diagnostics',
      commands: [
        {
          label: 'Guest Agent Ping',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-ping"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'Check if the QEMU Guest Agent inside the VM is responding',
        },
        {
          label: 'Guest OS Info',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-osinfo"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'OS name, version, kernel, and architecture as reported by the guest agent',
        },
        {
          label: 'Guest Hostname',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-host-name"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'Hostname as seen from inside the VM',
        },
        {
          label: 'Guest Networks',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-network-get-interfaces"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'Network interfaces, IPs, and MAC addresses as seen from inside the VM',
        },
        {
          label: 'Guest Filesystems',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-fsinfo"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'Mounted filesystems, disk usage, and mount points inside the VM',
        },
        {
          label: 'Guest Users',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-users"}' 2>/dev/null`,
          requiresAgent: true,
          description: 'Currently logged-in users inside the VM',
        },
      ],
    },
    {
      category: 'System',
      commands: [
        {
          label: 'Processes',
          command: 'ps aux',
          description: 'All processes running in the virt-launcher pod (QEMU, libvirt, sidecars)',
        },
        {
          label: 'Disk Usage',
          command: 'df -h',
          description: 'Filesystem usage inside the virt-launcher pod — check for full disks',
        },
        {
          label: 'Memory',
          command: 'cat /proc/meminfo | head -10',
          description: 'Pod-level memory info: total, free, available, and buffers',
        },
        {
          label: 'Cgroup Limits',
          command:
            'cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null',
          description: 'Memory limit enforced by Kubernetes on the virt-launcher pod',
        },
      ],
    },
  ];
}

export default function VirtLauncherExec({ podName, namespace, hasAgent }: VirtLauncherExecProps) {
  const [showHelp, setShowHelp] = useState(false);
  const terminalRef = useRef<PodExecTerminalHandle>(null);

  // virsh domain = namespace_vmName — derive VM name from pod name
  const vmNameMatch = podName.match(/^virt-launcher-(.+)-[a-z0-9]+$/);
  const vmName = vmNameMatch ? vmNameMatch[1] : '';
  // Validate domain contains only safe characters (alphanumeric, dash, underscore, dot)
  const rawDomain = vmName ? `${namespace}_${vmName}` : '';
  const domain = /^[a-zA-Z0-9._-]+$/.test(rawDomain) ? rawDomain : '';

  if (!podName) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:console-line" />}>
        No virt-launcher pod found. Is the VM running?
      </Alert>
    );
  }

  const helpCommands = getHelpCommands(domain);

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ height: '100%' }}>
      <Box display="flex" gap={1.5} sx={{ flex: 1, minHeight: 300 }}>
        {/* Terminal */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <PodExecTerminal
            ref={terminalRef}
            podName={podName}
            namespace={namespace}
            container="compute"
            connectMessage="Connecting to virt-launcher compute container..."
            toolbarActions={
              <>
                {domain && (
                  <Chip
                    label={`domain: ${domain}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                  />
                )}
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
          />
        </Box>

        {/* Right sidebar */}
        {showHelp && (
          <Box
            sx={{
              width: 280,
              flexShrink: 0,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              zIndex: 2,
            }}
          >
            <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box display="flex" alignItems="center" gap={0.5}>
                <Icon icon="mdi:help-circle-outline" width={16} />
                <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.8rem' }}>
                  Command Reference
                </Typography>
                <Box flex={1} />
                <IconButton
                  size="small"
                  onClick={() => setShowHelp(false)}
                  sx={{ p: 0.25 }}
                  aria-label="Close command reference"
                >
                  <Icon icon="mdi:close" width={16} />
                </IconButton>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                Click to execute, copy icon to clipboard
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
              {helpCommands.map((group, idx) => (
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
                      <CommandChip
                        key={cmd.label}
                        cmd={cmd}
                        disabled={cmd.requiresAgent && !hasAgent}
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
    </Box>
  );
}
