import { Icon } from '@iconify/react';
import { Alert, Box, Chip, Divider, IconButton, Tooltip, Typography } from '@mui/material';
import React, { useRef, useState } from 'react';
import PodExecTerminal, { PodExecTerminalHandle } from './PodExecTerminal';

interface VirtLauncherExecProps {
  podName: string;
  namespace: string;
  hasAgent?: boolean;
}

interface HelpCommand {
  label: string;
  command: string;
  requiresAgent?: boolean;
}

function getHelpCommands(domain: string): Array<{ category: string; commands: HelpCommand[] }> {
  return [
    {
      category: 'VM Status',
      commands: [
        { label: 'List VMs', command: 'virsh list --all 2>/dev/null' },
        { label: 'VM Info', command: `virsh dominfo ${domain} 2>/dev/null` },
        { label: 'VM State', command: `virsh domstate ${domain} --reason 2>/dev/null` },
        { label: 'vCPU Info', command: `virsh vcpuinfo ${domain} 2>/dev/null` },
      ],
    },
    {
      category: 'Resources',
      commands: [
        { label: 'Memory Stats', command: `virsh dommemstat ${domain} 2>/dev/null` },
        { label: 'Block Devices', command: `virsh domblklist ${domain} 2>/dev/null` },
        { label: 'Block Stats', command: `virsh domblkstat ${domain} 2>/dev/null` },
        { label: 'Network Interfaces', command: `virsh domiflist ${domain} 2>/dev/null` },
        {
          label: 'Network Stats',
          command: `virsh domifstat ${domain} $(virsh domiflist ${domain} 2>/dev/null | awk 'NR>2 && NF{print $1; exit}') 2>/dev/null`,
        },
      ],
    },
    {
      category: 'Configuration',
      commands: [
        { label: 'VM XML', command: `virsh dumpxml ${domain} 2>/dev/null | more` },
        {
          label: 'QEMU Args',
          command: `virsh qemu-monitor-command ${domain} --hmp 'info version' 2>/dev/null`,
        },
        {
          label: 'QEMU Threads',
          command: `virsh qemu-monitor-command ${domain} --hmp 'info cpus' 2>/dev/null`,
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
        },
        {
          label: 'Guest OS Info',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-osinfo"}' 2>/dev/null`,
          requiresAgent: true,
        },
        {
          label: 'Guest Hostname',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-host-name"}' 2>/dev/null`,
          requiresAgent: true,
        },
        {
          label: 'Guest Networks',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-network-get-interfaces"}' 2>/dev/null`,
          requiresAgent: true,
        },
        {
          label: 'Guest Filesystems',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-fsinfo"}' 2>/dev/null`,
          requiresAgent: true,
        },
        {
          label: 'Guest Users',
          command: `virsh qemu-agent-command ${domain} --pretty '{"execute":"guest-get-users"}' 2>/dev/null`,
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
}

function CommandChip({
  cmd,
  onExec,
  disabled,
}: {
  cmd: HelpCommand;
  onExec: (command: string) => void;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(cmd.command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box
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
          '&:hover': {
            bgcolor: 'action.selected',
            borderColor: 'divider',
          },
        }),
      }}
      onClick={disabled ? undefined : () => onExec(cmd.command)}
    >
      {!disabled && (
        <Icon icon="mdi:console-line" width={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      )}
      <Typography
        variant="caption"
        sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 500, flex: 1 }}
      >
        {cmd.label}
      </Typography>
      {disabled ? (
        <Tooltip title="QEMU Guest Agent is not connected" arrow placement="left">
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Icon icon="mdi:information-outline" width={14} style={{ opacity: 0.7 }} />
          </Box>
        </Tooltip>
      ) : (
        <IconButton
          size="small"
          onClick={handleCopy}
          sx={{ p: 0.25, flexShrink: 0 }}
          aria-label="Copy command"
        >
          <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={12} />
        </IconButton>
      )}
    </Box>
  );
}

export default function VirtLauncherExec({ podName, namespace, hasAgent }: VirtLauncherExecProps) {
  const [showHelp, setShowHelp] = useState(false);
  const terminalRef = useRef<PodExecTerminalHandle>(null);

  // virsh domain = namespace_vmName — derive VM name from pod name
  const vmNameMatch = podName.match(/^virt-launcher-(.+)-[a-z0-9]+$/);
  const vmName = vmNameMatch ? vmNameMatch[1] : '';
  const domain = vmName ? `${namespace}_${vmName}` : '';

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
