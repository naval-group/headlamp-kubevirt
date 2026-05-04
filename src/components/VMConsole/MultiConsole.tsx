import { Icon } from '@iconify/react';
import {
  Box,
  Dialog,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import { ConsoleObject, TerminalPanel, TerminalPanelHandle, VNCPanel } from './VMConsole';

interface MultiConsoleProps {
  open: boolean;
  vms: VirtualMachine[];
  onClose: () => void;
}

interface PanelState {
  mode: 'terminal' | 'vnc';
  status: 'connecting' | 'connected' | 'disconnected';
}

function PanelHeader({
  vm,
  state,
  broadcast,
  maximized,
  onModeChange,
  onToggleMaximize,
}: {
  vm: VirtualMachine;
  state: PanelState;
  broadcast?: boolean;
  maximized?: boolean;
  onModeChange: (mode: 'terminal' | 'vnc') => void;
  onToggleMaximize: () => void;
}) {
  const statusColor =
    state.status === 'connected'
      ? '#4caf50'
      : state.status === 'connecting'
      ? '#ff9800'
      : '#f44336';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        bgcolor:
          broadcast && state.mode === 'terminal' ? 'rgba(255,152,0,0.15)' : 'rgba(30,30,30,0.95)',
        borderBottom:
          broadcast && state.mode === 'terminal'
            ? '1px solid rgba(255,152,0,0.3)'
            : '1px solid rgba(255,255,255,0.1)',
        transition: 'background-color 0.3s, border-color 0.3s',
        minHeight: 28,
        maxHeight: 28,
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: statusColor,
          flexShrink: 0,
        }}
      />
      <Typography
        variant="caption"
        noWrap
        sx={{
          color: 'rgba(255,255,255,0.9)',
          fontSize: '0.75rem',
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
        }}
      >
        {vm.getName()}
      </Typography>
      <ToggleButtonGroup
        value={state.mode}
        exclusive
        onChange={(_, v) => v && onModeChange(v)}
        size="small"
        sx={{
          height: 20,
          '& .MuiToggleButton-root': {
            color: 'rgba(255,255,255,0.5)',
            borderColor: 'rgba(255,255,255,0.2)',
            textTransform: 'none',
            fontSize: '0.65rem',
            px: 0.75,
            py: 0,
            gap: 0.25,
            minWidth: 0,
            '&.Mui-selected': {
              color: '#fff',
              bgcolor: 'rgba(255,255,255,0.15)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
            },
            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
          },
        }}
      >
        <ToggleButton value="vnc">
          <Icon icon="mdi:monitor" width={12} />
          VNC
        </ToggleButton>
        <ToggleButton value="terminal">
          <Icon icon="mdi:console" width={12} />
          Serial
        </ToggleButton>
      </ToggleButtonGroup>
      <Tooltip title={maximized ? 'Restore grid' : 'Maximize'} arrow placement="bottom">
        <IconButton
          size="small"
          onClick={onToggleMaximize}
          sx={{
            color: 'rgba(255,255,255,0.5)',
            '&:hover': { color: '#fff' },
            p: 0.25,
          }}
        >
          <Icon icon={maximized ? 'mdi:window-restore' : 'mdi:window-maximize'} width={14} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function MultiConsole({ open, vms, onClose }: MultiConsoleProps) {
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [broadcast, setBroadcast] = useState(false);
  const [maximizedIndex, setMaximizedIndex] = useState<number | null>(null);
  const broadcastRef = useRef(false);
  broadcastRef.current = broadcast;
  const maximizedIndexRef = useRef<number | null>(null);
  maximizedIndexRef.current = maximizedIndex;
  const terminalRefs = useRef<(TerminalPanelHandle | null)[]>([]);
  // Track mode generation per panel to discard stale status updates from unmounting panels
  const modeGenRef = useRef<number[]>([]);

  // Initialize panel states when VMs change
  useEffect(() => {
    if (open) {
      setPanels(vms.map(() => ({ mode: 'terminal', status: 'connecting' })));
      terminalRefs.current = vms.map(() => null);
      modeGenRef.current = vms.map(() => 0);
      setMaximizedIndex(null);
    }
  }, [open, vms]);

  const setMode = useCallback((index: number, mode: 'terminal' | 'vnc') => {
    modeGenRef.current[index] = (modeGenRef.current[index] || 0) + 1;
    setPanels(prev => prev.map((p, i) => (i === index ? { ...p, mode, status: 'connecting' } : p)));
  }, []);

  const setStatus = useCallback(
    (index: number, gen: number, status: 'connecting' | 'connected' | 'disconnected') => {
      // Ignore stale status updates from panels that were replaced by a mode switch
      if (modeGenRef.current[index] !== gen) return;
      setPanels(prev => prev.map((p, i) => (i === index ? { ...p, status } : p)));
    },
    []
  );

  // Broadcast handler: uses ref to always read latest broadcast state
  // Only sends to other Serial (terminal) panels — VNC excluded
  // Paused when a panel is maximized
  const handleBroadcastInput = useCallback((fromIndex: number, text: string) => {
    if (!broadcastRef.current || maximizedIndexRef.current !== null) return;
    terminalRefs.current.forEach((ref, i) => {
      if (i !== fromIndex && ref) {
        ref.sendText(text);
      }
    });
  }, []);

  // Grid layout based on VM count (or 1x1 when maximized)
  const count = vms.length;
  const isMaximized = maximizedIndex !== null;
  const gridCols = isMaximized ? 1 : count <= 1 ? 1 : 2;
  const gridRows = isMaximized ? 1 : count <= 2 ? 1 : 2;

  if (!open || vms.length === 0) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: '#1a1a1a',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.5,
          bgcolor: 'rgba(20,20,20,0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          minHeight: 36,
        }}
      >
        <Icon icon="mdi:console-network" width={20} color="rgba(255,255,255,0.7)" />
        <Typography
          variant="subtitle2"
          sx={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, mr: 'auto' }}
        >
          Multi Console ({count} VMs)
        </Typography>

        <Tooltip
          title={
            isMaximized && broadcast
              ? 'Broadcast paused — restore grid to resume'
              : broadcast
              ? 'Broadcast ON — input is sent to all terminals'
              : 'Enable broadcast — type in one, send to all'
          }
        >
          <IconButton
            size="small"
            onClick={() => setBroadcast(b => !b)}
            sx={{
              color: broadcast
                ? isMaximized
                  ? 'rgba(255,152,0,0.4)'
                  : '#ff9800'
                : 'rgba(255,255,255,0.5)',
              bgcolor: broadcast
                ? isMaximized
                  ? 'rgba(255,152,0,0.05)'
                  : 'rgba(255,152,0,0.15)'
                : 'transparent',
              border: broadcast
                ? `1px solid rgba(255,152,0,${isMaximized ? '0.2' : '0.4'})`
                : '1px solid transparent',
              '&:hover': {
                bgcolor: broadcast ? 'rgba(255,152,0,0.25)' : 'rgba(255,255,255,0.1)',
              },
              px: 1,
              borderRadius: 1,
              gap: 0.5,
            }}
          >
            <Icon icon="mdi:broadcast" width={18} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'inherit' }}>
              Broadcast
            </Typography>
          </IconButton>
        </Tooltip>

        <Tooltip title="Close">
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' } }}
          >
            <Icon icon="mdi:close" width={20} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Grid of panels */}
      <Box
        sx={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${gridRows}, 1fr)`,
          gap: '2px',
          bgcolor: 'rgba(255,255,255,0.15)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {vms.map((vm, index) => {
          const panel = panels[index];
          if (!panel) return null;
          const hidden = isMaximized && maximizedIndex !== index;
          const gen = modeGenRef.current[index] || 0;

          return (
            <Box
              key={`${vm.getNamespace()}/${vm.getName()}`}
              sx={{
                display: hidden ? 'none' : 'flex',
                flexDirection: 'column',
                bgcolor: '#000',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <PanelHeader
                vm={vm}
                state={panel}
                broadcast={broadcast}
                maximized={maximizedIndex === index}
                onModeChange={mode => setMode(index, mode)}
                onToggleMaximize={() => setMaximizedIndex(maximizedIndex === index ? null : index)}
              />
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {panel.mode === 'terminal' ? (
                  <TerminalPanel
                    ref={el => {
                      terminalRefs.current[index] = el;
                    }}
                    item={vm as unknown as ConsoleObject}
                    active={open}
                    compact
                    onStatusChange={status => setStatus(index, gen, status)}
                    onInput={text => handleBroadcastInput(index, text)}
                  />
                ) : (
                  <VNCPanel
                    item={vm as unknown as ConsoleObject}
                    vm={vm}
                    active={open}
                    onStatusChange={status => setStatus(index, gen, status)}
                  />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Dialog>
  );
}
