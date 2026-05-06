import '@xterm/xterm/css/xterm.css';
import { Icon } from '@iconify/react';
import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
// @ts-ignore — noVNC has no TypeScript declarations
import RFBCreate from '@novnc/novnc/lib/rfb';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useVMActions from '../../hooks/useVMActions';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

// ── Terminal types ──────────────────────────────────────────────────────

export interface ConsoleObject extends KubeObject {
  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket };
  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket };
}

interface XTerminalConnected {
  xterm: XTerminal;
  connected: boolean;
  reconnectOnEnter: boolean;
}
type execReturn = ReturnType<ConsoleObject['exec']>;

// ── Props ───────────────────────────────────────────────────────────────

interface VMConsoleProps extends DialogProps {
  item: ConsoleObject;
  vm?: VirtualMachine;
  onClose?: () => void;
  open: boolean;
  initialTab?: 'vnc' | 'terminal';
}

// ── Quick Action Buttons ────────────────────────────────────────────────

function QuickActions({ vm }: { vm?: VirtualMachine }) {
  const { actions } = useVMActions(vm);
  if (!vm) return null;

  // Only show start, stop, force-stop, restart in console view
  const quickIds = ['start', 'stop', 'force-stop', 'restart'];
  const quickActions = actions.filter(a => quickIds.includes(a.id));

  return (
    <Box display="flex" alignItems="center" gap={0.5} sx={{ ml: 2 }}>
      <Box
        sx={theme => ({
          width: '1px',
          height: 24,
          backgroundColor: theme.palette.divider,
          mx: 0.5,
        })}
      />
      {quickActions.map(a => (
        <Tooltip key={a.id} title={a.label}>
          <span>
            <IconButton
              size="small"
              disabled={a.disabled}
              onClick={e => {
                e.stopPropagation();
                a.handler();
              }}
              sx={theme => ({
                color: a.disabled ? theme.palette.action.disabled : theme.palette.text.secondary,
                '&:hover': {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.action.hover,
                },
                padding: '4px',
              })}
            >
              <Icon icon={a.icon} width={18} />
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
}

// ── Terminal Panel ───────────────────────────────────────────────────────

export interface TerminalPanelHandle {
  sendText: (text: string) => void;
  sendStty: () => void;
}

export const TerminalPanel = React.forwardRef<
  TerminalPanelHandle,
  {
    item: ConsoleObject;
    active: boolean;
    onStatusChange: (status: 'connecting' | 'connected') => void;
    compact?: boolean;
    onInput?: (text: string) => void;
  }
>(function TerminalPanel({ item, active, onStatusChange, compact, onInput }, ref) {
  const { t } = useTranslation(['translation', 'glossary']);
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminalConnected | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const encoderRef = useRef(new TextEncoder());
  const decoderRef = useRef(new TextDecoder('utf-8'));

  const changeFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const next = Math.min(28, Math.max(8, prev + delta));
      if (xtermRef.current?.xterm) {
        xtermRef.current.xterm.options.fontSize = next;
        fitAddonRef.current?.fit();
      }
      return next;
    });
  }, []);

  function send(channel: number, data: string) {
    const socket = execRef.current?.getSocket();
    if (!socket || socket.readyState !== 1) return;
    const encoded = encoderRef.current.encode(data);
    socket.send(encoded);
  }

  function onData(xtermc: XTerminalConnected, bytes: ArrayBuffer) {
    const xterm = xtermc.xterm;
    const text = decoderRef.current.decode(bytes, { stream: true });
    if (!xtermc.connected) {
      xtermc.connected = true;
      xterm.writeln(t('Connected to terminal…'));
    }
    xterm.write(text);
  }

  // Send stty command to sync the VM's terminal size with xterm's dimensions.
  // Serial console (plain.kubevirt.io) has no resize channel, so stty must be
  // triggered manually (not on connect — the console often starts at a login prompt).
  const sendStty = useCallback(() => {
    const xterm = xtermRef.current?.xterm;
    if (!xterm || !xtermRef.current?.connected) return;
    const { cols, rows } = xterm;
    if (cols > 0 && rows > 0) {
      send(0, `stty cols ${cols} rows ${rows}\r`);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    sendText: (text: string) => send(0, text),
    sendStty,
  }));

  function setupTerminal(itemRef: HTMLElement, xterm: XTerminal, fitAddon: FitAddon) {
    if (!itemRef) return;
    xterm.open(itemRef);
    xterm.onData(data => {
      send(0, data);
      onInputRef.current?.(data);
    });
    xterm.attachCustomKeyEventHandler(arg => {
      if (arg.ctrlKey && arg.type === 'keydown') {
        if (arg.code === 'KeyC') {
          const selection = xterm.getSelection();
          if (selection) return false;
        }
        if (arg.code === 'KeyV') return false;
      }
      return true;
    });
    fitAddon.fit();
  }

  useEffect(() => {
    if (!active) {
      // Disconnect when tab is not active
      xtermRef.current?.xterm.dispose();
      execRef.current?.cancel();
      xtermRef.current = null;
      execRef.current = null;
      return;
    }

    if (xtermRef.current) {
      xtermRef.current.xterm.dispose();
      execRef.current?.cancel();
    }

    const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].indexOf(navigator?.platform) >= 0;
    xtermRef.current = {
      xterm: new XTerminal({
        cursorBlink: true,
        cursorStyle: 'underline',
        scrollback: 10000,
        fontSize,
        rows: 30,
        windowsMode: isWindows,
        allowProposedApi: true,
      }),
      connected: false,
      reconnectOnEnter: false,
    };

    fitAddonRef.current = new FitAddon();
    xtermRef.current.xterm.loadAddon(fitAddonRef.current);

    (async function () {
      onStatusChangeRef.current('connecting');
      execRef.current = await item.exec(items => onData(xtermRef.current!, items), {
        reconnectOnFailure: false,
        failCb: () => {
          xtermRef.current?.xterm.write(encoderRef.current.encode(t('\r\n')));
        },
        connectCb: () => {
          if (xtermRef.current) xtermRef.current.connected = true;
          onStatusChangeRef.current('connected');
          setTimeout(() => send(0, '\x15\r'), 500);
        },
        tty: false,
        stderr: false,
        stdin: false,
        stdout: false,
      });
      if (terminalRef && xtermRef.current && fitAddonRef.current) {
        setupTerminal(terminalRef, xtermRef.current.xterm, fitAddonRef.current);
      }
    })();

    const handler = () => fitAddonRef.current?.fit();
    window.addEventListener('resize', handler);

    return () => {
      xtermRef.current?.xterm.dispose();
      execRef.current?.cancel();
      window.removeEventListener('resize', handler);
    };
  }, [active, terminalRef, item]);

  // Use ResizeObserver to refit terminal whenever container size changes
  // This handles dialog open animation, fullscreen toggle, and window resize
  useEffect(() => {
    if (!active || !terminalRef || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(terminalRef);

    return () => observer.disconnect();
  }, [active, terminalRef]);

  return (
    <Box
      sx={theme => ({
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        '& .xterm': {
          height: '100%',
          '& .xterm-viewport': {
            width: 'initial !important',
            overflowY: 'hidden !important',
          },
        },
        '& .xterm-container': {
          overflow: 'hidden',
          width: '100%',
          '& .terminal.xterm': {
            padding: theme.spacing(1),
          },
        },
      })}
    >
      {/* Serial toolbar overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 12,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: 'rgba(0,0,0,0.6)',
          borderRadius: 1,
          px: 0.5,
          py: 0.25,
          backdropFilter: 'blur(4px)',
        }}
      >
        <SerialKeysMenu onStty={sendStty} onSendText={text => send(0, text)} />

        <Box sx={{ width: 1, height: 18, bgcolor: 'rgba(255,255,255,0.2)', mx: 0.25 }} />

        {/* Font size controls */}
        <Tooltip title="Decrease font size" arrow placement="bottom">
          <IconButton
            size="small"
            onClick={() => changeFontSize(-1)}
            disabled={fontSize <= 8}
            sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.25 }}
          >
            <Icon icon="mdi:minus" width={14} />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem', userSelect: 'none' }}
        >
          {fontSize}
        </Typography>
        <Tooltip title="Increase font size" arrow placement="bottom">
          <IconButton
            size="small"
            onClick={() => changeFontSize(1)}
            disabled={fontSize >= 28}
            sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.25 }}
          >
            <Icon icon="mdi:plus" width={14} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        sx={theme => ({
          paddingTop: compact ? 0 : theme.spacing(1),
          paddingBottom: compact ? 0 : theme.spacing(1),
          flex: 1,
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column-reverse',
        })}
      >
        <div
          className="xterm-container"
          ref={x => setTerminalRef(x)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse' }}
        />
      </Box>
    </Box>
  );
});

// ── Shared helpers ──────────────────────────────────────────────────────

/** Shared disabled section header styling for menus. */
const menuSectionSx = {
  fontSize: '0.8rem',
  py: 0.5,
  minHeight: 0,
  opacity: '0.5 !important',
  '&&': { fontSize: '0.65rem' },
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
};

// ── VNC Panel ───────────────────────────────────────────────────────────

// F1-F12 keysyms: F1=0xffbe, F2=0xffbf, ... F12=0xffc9
const FK = (n: number) => 0xffbe + (n - 1);

function VNCKeysMenu({ onSend }: { onSend: (keys: number[]) => void }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const send = (keys: number[]) => {
    setAnchorEl(null);
    onSend(keys);
  };

  const menuItemSx = { fontSize: '0.8rem', py: 0.5, minHeight: 0 };
  const iconSx = { minWidth: 28 };

  return (
    <>
      <Tooltip title="Send Keys" arrow placement="bottom">
        <IconButton
          size="small"
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
        >
          <Icon icon="mdi:keyboard-settings" width={16} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: { sx: { bgcolor: 'rgba(30,30,30,0.95)', color: '#fff', minWidth: 200 } },
        }}
      >
        <MenuItem disabled sx={menuSectionSx}>
          Switch TTY
        </MenuItem>
        {[1, 2, 3, 4, 5, 6].map(n => (
          <MenuItem key={`tty${n}`} onClick={() => send([0xffe3, 0xffe9, FK(n)])} sx={menuItemSx}>
            <ListItemIcon sx={iconSx}>
              <Icon icon="mdi:console" width={16} color="rgba(255,255,255,0.7)" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
              Ctrl+Alt+F{n} — tty{n}
            </ListItemText>
          </MenuItem>
        ))}
        <MenuItem onClick={() => send([0xffe3, 0xffe9, FK(7)])} sx={menuItemSx}>
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:monitor" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Ctrl+Alt+F7 — GUI
          </ListItemText>
        </MenuItem>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 0.5 }} />

        <MenuItem disabled sx={menuSectionSx}>
          System
        </MenuItem>
        <MenuItem onClick={() => send([0xffe3, 0xffe9, 0xffff])} sx={menuItemSx}>
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:restart" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>Ctrl+Alt+Del</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => send([0xffe3, 0xffe9, 0xff08])} sx={menuItemSx}>
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:backspace" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Ctrl+Alt+Backspace — Kill X
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={() => send([0xffeb])} sx={menuItemSx}>
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:microsoft-windows" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Super (Win) key
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

function SerialKeysMenu({
  onStty,
  onSendText,
}: {
  onStty: () => void;
  onSendText: (text: string) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const menuItemSx = { fontSize: '0.8rem', py: 0.5, minHeight: 0 };
  const iconSx = { minWidth: 28 };

  return (
    <>
      <Tooltip title="Serial Commands" arrow placement="bottom">
        <IconButton
          size="small"
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
        >
          <Icon icon="mdi:keyboard-settings" width={16} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: { sx: { bgcolor: 'rgba(30,30,30,0.95)', color: '#fff', minWidth: 200 } },
        }}
      >
        <MenuItem disabled sx={menuSectionSx}>
          Terminal
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onStty();
          }}
          sx={menuItemSx}
        >
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:resize" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Resize terminal (stty)
          </ListItemText>
        </MenuItem>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 0.5 }} />

        <MenuItem disabled sx={menuSectionSx}>
          Signals
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onSendText('\x03');
          }}
          sx={menuItemSx}
        >
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:cancel" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Ctrl+C — Interrupt
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onSendText('\x04');
          }}
          sx={menuItemSx}
        >
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:logout" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Ctrl+D — EOF / Logout
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onSendText('\x1a');
          }}
          sx={menuItemSx}
        >
          <ListItemIcon sx={iconSx}>
            <Icon icon="mdi:pause" width={16} color="rgba(255,255,255,0.7)" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
            Ctrl+Z — Suspend
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

export interface VNCPanelActions {
  sendCtrlAltDel: () => void;
  sendKeys: (keys: number[]) => void;
  screenshot: () => void;
  toggleFullscreen: () => void;
}

export const VNCPanel = React.forwardRef<
  VNCPanelActions,
  {
    item: ConsoleObject;
    vm?: KubeObject;
    active: boolean;
    onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
  }
>(function VNCPanel({ item, vm, active, onStatusChange }, ref) {
  const [errorMessage, setErrorMessage] = useState('');
  const [localStatus, setLocalStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting'
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [tabletWarning, setTabletWarning] = useState(false);
  const [tabletPatching, setTabletPatching] = useState(false);
  const [tabletAdded, setTabletAdded] = useState(false);
  const vncContainerRef = useRef<HTMLDivElement>(null);
  const vncDisplayRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rfbRef = useRef<any>(null);
  const desktopCheckTimerRef = useRef<number | null>(null);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  const actions: VNCPanelActions = {
    sendCtrlAltDel: () => rfbRef.current?.sendCtrlAltDel(),
    sendKeys: (keys: number[]) => {
      const rfb = rfbRef.current;
      if (!rfb) return;
      keys.forEach(k => rfb.sendKey(k, null, true));
      [...keys].reverse().forEach(k => rfb.sendKey(k, null, false));
    },
    screenshot: () => {
      const canvas = vncDisplayRef.current?.querySelector('canvas');
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `vnc-${item.getName()}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.href = (canvas as HTMLCanvasElement).toDataURL('image/png');
      link.click();
    },
    toggleFullscreen: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        vncContainerRef.current?.requestFullscreen?.();
      }
    },
  };

  useImperativeHandle(ref, () => actions, [item]);

  // Listen for fullscreen changes + lock system keys (Super/Win) in fullscreen
  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (fs && (navigator as any).keyboard?.lock) {
        (navigator as any).keyboard.lock(['MetaLeft', 'MetaRight', 'Escape']).catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (!active) {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
        rfbRef.current = null;
      }
      setLocalStatus('connecting');
      setErrorMessage('');
      return;
    }

    if (!vncDisplayRef.current) return;

    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }

    setLocalStatus('connecting');
    onStatusChange('connecting');
    setErrorMessage('');
    setTabletWarning(false);

    // Build WebSocket URL matching Headlamp's getAppUrl() logic exactly
    const ns = item.getNamespace();
    const name = item.getName();

    // Replicate isElectron() — checks renderer process, electron version, or user agent
    const isElectron =
      (typeof window !== 'undefined' &&
        typeof (window as any).process === 'object' &&
        (window as any).process.type === 'renderer') ||
      (typeof process !== 'undefined' &&
        typeof process.versions === 'object' &&
        !!(process.versions as any).electron) ||
      (typeof navigator === 'object' && navigator.userAgent.indexOf('Electron') >= 0);
    const isDockerDesktop = navigator.userAgent.indexOf('Docker Desktop') >= 0;

    let backendPort = 4466;
    let useLocalhost = false;
    if (isElectron) {
      if ((window as any).headlampBackendPort) {
        backendPort = (window as any).headlampBackendPort;
      }
      useLocalhost = true;
    }
    if (isDockerDesktop) {
      backendPort = 64446;
      useLocalhost = true;
    }

    const wsBase = useLocalhost
      ? `ws://localhost:${backendPort}`
      : window.location.origin.replace(/^http/, 'ws');
    const cluster = (item as any).cluster || 'default';
    const vncPath = `/apis/subresources.kubevirt.io/v1/namespaces/${ns}/virtualmachineinstances/${name}/vnc`;
    const wsUrl = `${wsBase}/clusters/${cluster}${vncPath}`;

    const userId = localStorage.getItem('headlamp-userId') || '';
    let cancelled = false;
    let retried = false;

    function connectVNC(protocols: string[]) {
      if (cancelled || !vncDisplayRef.current) return;

      try {
        const rfb = new RFBCreate(vncDisplayRef.current, wsUrl, {
          wsProtocols: protocols,
          scaleViewport: true,
        });

        rfb.addEventListener('connect', () => {
          setLocalStatus('connected');
          onStatusChange('connected');

          // Periodically check if this is a desktop VM without tablet
          if (vmRef.current) {
            const devices = (vmRef.current as any).jsonData?.spec?.template?.spec?.domain?.devices;
            const hasTablet = devices?.inputs?.some((i: any) => i.type === 'tablet');
            const hasAutoAttach = devices?.autoattachInputDevice === true;
            if (!hasTablet && !hasAutoAttach) {
              let checkCount = 0;
              const maxChecks = 10;
              const checkDesktop = () => {
                checkCount++;
                const canvas = vncDisplayRef.current?.querySelector('canvas') as HTMLCanvasElement;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const w = canvas.width;
                const h = canvas.height;
                if (w === 0 || h === 0) return;
                const imgData = ctx.getImageData(0, 0, w, h).data;
                const step = Math.max(1, Math.floor(Math.min(w, h) / 20));
                let colorfulPixels = 0;
                let totalSampled = 0;
                for (let y = step; y < h - step; y += step) {
                  for (let x = step; x < w - step; x += step) {
                    const i = (y * w + x) * 4;
                    const r = imgData[i];
                    const g = imgData[i + 1];
                    const b = imgData[i + 2];
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const saturation = max === 0 ? 0 : (max - min) / max;
                    if (saturation > 0.15 && max > 30) colorfulPixels++;
                    totalSampled++;
                  }
                }
                const colorRatio = totalSampled > 0 ? colorfulPixels / totalSampled : 0;
                if (colorRatio > 0.05) {
                  setTabletWarning(true);
                } else if (checkCount < maxChecks) {
                  desktopCheckTimerRef.current = window.setTimeout(checkDesktop, 30000);
                }
              };
              desktopCheckTimerRef.current = window.setTimeout(checkDesktop, 3000);
            }
          }
        });

        rfb.addEventListener('disconnect', (e: { detail: { clean: boolean } }) => {
          // If first attempt with auth protocol fails, retry without it
          if (!retried && !e.detail.clean && protocols.length > 2) {
            retried = true;
            rfbRef.current = null;
            connectVNC(['base64.binary.k8s.io', 'plain.kubevirt.io']);
            return;
          }
          setLocalStatus('disconnected');
          onStatusChange('disconnected');
          if (!e.detail.clean) {
            setErrorMessage('VNC connection lost.');
          }
        });

        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfbRef.current = rfb;
      } catch (error) {
        console.error('VNC connection error:', error);
        setLocalStatus('disconnected');
        onStatusChange('disconnected');
        setErrorMessage('Failed to create VNC connection.');
      }
    }

    // Try with auth protocol first, falls back to without on disconnect
    const protocols = ['base64.binary.k8s.io', 'plain.kubevirt.io'];
    if (userId) {
      protocols.push(`base64url.headlamp.authorization.k8s.io.${userId}`);
    }
    connectVNC(protocols);

    return () => {
      cancelled = true;
      if (desktopCheckTimerRef.current) {
        clearTimeout(desktopCheckTimerRef.current);
        desktopCheckTimerRef.current = null;
      }
      if (rfbRef.current) {
        rfbRef.current.disconnect();
        rfbRef.current = null;
      }
    };
  }, [active, item]);

  const alertSx = {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    right: 8,
    zIndex: 10,
  };

  return (
    <Box
      sx={{
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: '#000',
        position: 'relative',
      }}
    >
      {errorMessage && (
        <Alert severity="error" variant="filled" onClose={() => setErrorMessage('')} sx={alertSx}>
          {errorMessage}
        </Alert>
      )}

      {tabletWarning && (
        <Alert
          severity="warning"
          variant="filled"
          onClose={() => setTabletWarning(false)}
          sx={alertSx}
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                disabled={tabletPatching}
                onClick={async () => {
                  if (!vm) return;
                  setTabletPatching(true);
                  try {
                    const ns = vm.getNamespace();
                    const vmName = vm.getName();
                    await ApiProxy.patch(
                      `/apis/kubevirt.io/v1/namespaces/${ns}/virtualmachines/${vmName}`,
                      {
                        spec: {
                          template: {
                            spec: {
                              domain: {
                                devices: {
                                  inputs: [{ type: 'tablet', bus: 'usb', name: 'tablet0' }],
                                },
                              },
                            },
                          },
                        },
                      }
                    );
                    setTabletWarning(false);
                    setTabletPatching(false);
                    setTabletAdded(true);
                  } catch (err) {
                    console.error('Failed to add tablet:', err);
                    setTabletPatching(false);
                    setErrorMessage('Failed to add tablet input device.');
                  }
                }}
              >
                {tabletPatching ? 'Adding...' : 'Add tablet'}
              </Button>
              <IconButton size="small" color="inherit" onClick={() => setTabletWarning(false)}>
                <Icon icon="mdi:close" width={16} />
              </IconButton>
            </Box>
          }
        >
          Desktop detected without tablet input device — mouse cursor position may be inaccurate.
        </Alert>
      )}

      {tabletAdded && (
        <Alert severity="info" variant="filled" onClose={() => setTabletAdded(false)} sx={alertSx}>
          Tablet input added — will be effective after a VM restart.
        </Alert>
      )}

      {localStatus === 'connecting' && !errorMessage && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            zIndex: 5,
          }}
        >
          <Typography>Connecting to VNC...</Typography>
        </Box>
      )}

      <Box
        ref={vncContainerRef}
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          width: '100%',
          minHeight: 0,
          position: 'relative',
          bgcolor: '#000',
        }}
      >
        {/* VNC toolbar — right side, click-collapsible */}
        {localStatus === 'connected' && (
          <Box
            sx={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {/* Toggle button — always visible */}
            <IconButton
              size="small"
              onClick={() => setToolbarOpen(o => !o)}
              sx={{
                color: 'rgba(255,255,255,0.5)',
                bgcolor: 'rgba(0,0,0,0.5)',
                borderRadius: '4px 0 0 4px',
                p: 0.25,
                width: 16,
                height: 40,
                '&:hover': { bgcolor: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.8)' },
              }}
            >
              <Icon icon={toolbarOpen ? 'mdi:chevron-right' : 'mdi:chevron-left'} width={14} />
            </IconButton>

            {/* Panel — shown/hidden by state */}
            {toolbarOpen && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  bgcolor: 'rgba(0,0,0,0.8)',
                  borderRadius: '8px 0 0 8px',
                  px: 0.5,
                  py: 1,
                }}
              >
                <Tooltip title="Ctrl+Alt+Del" arrow placement="left">
                  <IconButton
                    size="small"
                    onClick={() => actions.sendCtrlAltDel()}
                    sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
                  >
                    <Icon icon="mdi:restart" width={18} />
                  </IconButton>
                </Tooltip>

                <VNCKeysMenu onSend={keys => actions.sendKeys(keys)} />

                <Box
                  sx={{
                    height: 1,
                    width: 18,
                    bgcolor: 'rgba(255,255,255,0.2)',
                    mx: 'auto',
                    my: 0.25,
                  }}
                />

                <Tooltip title="Screenshot" arrow placement="left">
                  <IconButton
                    size="small"
                    onClick={() => actions.screenshot()}
                    sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
                  >
                    <Icon icon="mdi:camera" width={18} />
                  </IconButton>
                </Tooltip>

                <Box
                  sx={{
                    height: 1,
                    width: 18,
                    bgcolor: 'rgba(255,255,255,0.2)',
                    mx: 'auto',
                    my: 0.25,
                  }}
                />

                <Tooltip
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  arrow
                  placement="left"
                >
                  <IconButton
                    size="small"
                    onClick={() => actions.toggleFullscreen()}
                    sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
                  >
                    <Icon
                      icon={isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'}
                      width={18}
                    />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
          </Box>
        )}
        <div
          ref={vncDisplayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      </Box>
    </Box>
  );
});

// ── Main VMConsole Component ────────────────────────────────────────────

export default function VMConsole(props: VMConsoleProps) {
  const { item, vm, onClose, initialTab = 'vnc', ...other } = props;
  const [activeTab, setActiveTab] = useState<'vnc' | 'terminal'>(initialTab);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const vncActionsRef = useRef<VNCPanelActions>(null);

  // Reset tab when dialog opens
  useEffect(() => {
    if (props.open) {
      setActiveTab(initialTab);
      setConnectionStatus('connecting');
    }
  }, [props.open, initialTab]);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const handleVNCStatus = useCallback((status: 'connecting' | 'connected' | 'disconnected') => {
    if (activeTabRef.current === 'vnc') setConnectionStatus(status);
  }, []);

  const handleTerminalStatus = useCallback((status: 'connecting' | 'connected') => {
    if (activeTabRef.current === 'terminal') setConnectionStatus(status);
  }, []);

  const statusColor =
    connectionStatus === 'connected'
      ? '#4caf50'
      : connectionStatus === 'connecting'
      ? '#ff9800'
      : '#f44336';

  return (
    <Dialog
      onClose={(event: object, reason: string) => {
        // Block real Escape key presses so they reach VNC/terminal instead of closing.
        // Allow the X button through — Headlamp's CloseButton passes {} as event
        // with reason 'escapeKeyDown', but real Escape has a 'key' property.
        if (reason === 'escapeKeyDown' && 'key' in event) return;
        onClose?.();
      }}
      withFullScreen
      onFullScreenToggled={() => {
        // Terminal fit handled internally by TerminalPanel
      }}
      title={
        (
          <Box display="flex" alignItems="center" gap={1}>
            <span>{item.getName()}</span>
            <Box
              component="span"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: statusColor,
                display: 'inline-block',
              }}
            />
            <Box
              sx={theme => ({
                width: '1px',
                height: 24,
                backgroundColor: theme.palette.divider,
                mx: 0.5,
              })}
            />
            <ToggleButtonGroup
              value={activeTab}
              exclusive
              onChange={(_, newValue) => {
                if (newValue !== null) {
                  setActiveTab(newValue);
                  setConnectionStatus('connecting');
                }
              }}
              size="small"
              sx={theme => ({
                height: 28,
                '& .MuiToggleButton-root': {
                  color: theme.palette.text.secondary,
                  borderColor: theme.palette.divider,
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  px: 1.5,
                  py: 0,
                  gap: 0.5,
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                    backgroundColor: theme.palette.action.selected,
                    '&:hover': { backgroundColor: theme.palette.action.hover },
                  },
                  '&:hover': { backgroundColor: theme.palette.action.hover },
                },
              })}
            >
              <ToggleButton value="vnc">
                <Icon icon="mdi:monitor" width={14} />
                VNC
              </ToggleButton>
              <ToggleButton value="terminal">
                <Icon icon="mdi:console" width={14} />
                Serial
              </ToggleButton>
            </ToggleButtonGroup>
            <QuickActions vm={vm} />
          </Box>
        ) as unknown as string
      }
      PaperProps={{
        sx: {
          overflow: 'hidden',
          display: 'grid !important',
          gridTemplateRows: 'auto 1fr',
          height: '85vh',
          maxHeight: '85vh',
          '& .MuiDialogTitle-root': {
            padding: '8px 24px',
          },
        },
      }}
      {...other}
    >
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          minHeight: 0,
          overflow: 'hidden',
          backgroundColor: activeTab === 'vnc' ? '#000' : 'inherit',
        }}
      >
        <VNCPanel
          ref={vncActionsRef}
          item={item}
          vm={vm}
          active={props.open && activeTab === 'vnc'}
          onStatusChange={handleVNCStatus}
        />
        <TerminalPanel
          item={item}
          active={props.open && activeTab === 'terminal'}
          onStatusChange={handleTerminalStatus}
        />
      </DialogContent>
    </Dialog>
  );
}
