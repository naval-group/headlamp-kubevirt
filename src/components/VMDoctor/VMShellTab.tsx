import '@xterm/xterm/css/xterm.css';
import { Icon } from '@iconify/react';
import { Alert, Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import React, { useCallback, useState } from 'react';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import { ConsoleObject, TerminalPanel, VNCPanel } from '../VMConsole/VMConsole';

interface VMShellTabProps {
  vmItem?: VirtualMachine | null;
  active: boolean;
}

export default function VMShellTab({ vmItem, active }: VMShellTabProps) {
  const [mode, setMode] = useState<'vnc' | 'terminal'>('vnc');
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  const handleVNCStatus = useCallback(
    (status: 'connecting' | 'connected' | 'disconnected') => {
      if (mode === 'vnc') setConnectionStatus(status);
    },
    [mode]
  );

  const handleTerminalStatus = useCallback(
    (status: 'connecting' | 'connected') => {
      if (mode === 'terminal') setConnectionStatus(status);
    },
    [mode]
  );

  if (!vmItem) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:monitor" />}>
        VM data not available. Is the VM running?
      </Alert>
    );
  }

  const item = vmItem as unknown as ConsoleObject;
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
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: statusColor,
          }}
        />
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
        <VNCPanel item={item} active={active && mode === 'vnc'} onStatusChange={handleVNCStatus} />
        <TerminalPanel
          item={item}
          active={active && mode === 'terminal'}
          onStatusChange={handleTerminalStatus}
        />
      </Box>
    </Box>
  );
}
