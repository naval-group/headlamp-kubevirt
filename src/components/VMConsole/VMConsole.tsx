import '@xterm/xterm/css/xterm.css';
import { Icon } from '@iconify/react';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import {
  Alert,
  Box,
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
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useVMActions from '../../hooks/useVMActions';
import { RFBPixelFormat } from '../../types';
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

// ── VNC keysym mapping ──────────────────────────────────────────────────

// Keyboard mode: 'character' sends the character the browser produces (e.key),
// 'physical' sends the keysym for the physical key position (e.code) — useful
// when guest OS has its own keyboard layout configured.
type KeyboardMode = 'character' | 'physical';

const specialKeys: { [key: string]: number } = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
  Meta: 0xffe7,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  Insert: 0xff63,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
  ScrollLock: 0xff14,
  Pause: 0xff13,
  PrintScreen: 0xff61,
};

// Maps physical key codes (e.code) to US-QWERTY keysyms.
// This lets users with non-US keyboards send the "correct" physical key
// when the guest OS handles its own layout.
const codeToKeysym: { [code: string]: [number, number] } = {
  // [unshifted, shifted] keysyms
  Backquote: [0x60, 0x7e], // ` ~
  Digit1: [0x31, 0x21], // 1 !
  Digit2: [0x32, 0x40], // 2 @
  Digit3: [0x33, 0x23], // 3 #
  Digit4: [0x34, 0x24], // 4 $
  Digit5: [0x35, 0x25], // 5 %
  Digit6: [0x36, 0x5e], // 6 ^
  Digit7: [0x37, 0x26], // 7 &
  Digit8: [0x38, 0x2a], // 8 *
  Digit9: [0x39, 0x28], // 9 (
  Digit0: [0x30, 0x29], // 0 )
  Minus: [0x2d, 0x5f], // - _
  Equal: [0x3d, 0x2b], // = +
  KeyQ: [0x71, 0x51], // q Q
  KeyW: [0x77, 0x57], // w W
  KeyE: [0x65, 0x45], // e E
  KeyR: [0x72, 0x52], // r R
  KeyT: [0x74, 0x54], // t T
  KeyY: [0x79, 0x59], // y Y
  KeyU: [0x75, 0x55], // u U
  KeyI: [0x69, 0x49], // i I
  KeyO: [0x6f, 0x4f], // o O
  KeyP: [0x70, 0x50], // p P
  BracketLeft: [0x5b, 0x7b], // [ {
  BracketRight: [0x5d, 0x7d], // ] }
  Backslash: [0x5c, 0x7c], // \ |
  KeyA: [0x61, 0x41], // a A
  KeyS: [0x73, 0x53], // s S
  KeyD: [0x64, 0x44], // d D
  KeyF: [0x66, 0x46], // f F
  KeyG: [0x67, 0x47], // g G
  KeyH: [0x68, 0x48], // h H
  KeyJ: [0x6a, 0x4a], // j J
  KeyK: [0x6b, 0x4b], // k K
  KeyL: [0x6c, 0x4c], // l L
  Semicolon: [0x3b, 0x3a], // ; :
  Quote: [0x27, 0x22], // ' "
  KeyZ: [0x7a, 0x5a], // z Z
  KeyX: [0x78, 0x58], // x X
  KeyC: [0x63, 0x43], // c C
  KeyV: [0x76, 0x56], // v V
  KeyB: [0x62, 0x42], // b B
  KeyN: [0x6e, 0x4e], // n N
  KeyM: [0x6d, 0x4d], // m M
  Comma: [0x2c, 0x3c], // , <
  Period: [0x2e, 0x3e], // . >
  Slash: [0x2f, 0x3f], // / ?
  Space: [0x20, 0x20], // space
  IntlBackslash: [0x3c, 0x3e], // < > (ISO key between left shift and Z)
};

function getKeysym(e: React.KeyboardEvent, mode: KeyboardMode = 'character'): number | null {
  // Special keys always use e.key
  if (e.key in specialKeys) return specialKeys[e.key];

  if (mode === 'physical' && e.code) {
    // Physical mode: map e.code to US-QWERTY keysym
    const mapping = codeToKeysym[e.code];
    if (mapping) {
      return e.shiftKey ? mapping[1] : mapping[0];
    }
    // Fallback to special keys by code
    if (e.code in specialKeys) return specialKeys[e.code];
  }

  // Character mode: use the character the browser produces
  if (e.key === 'Dead') {
    const deadKeyMap: { [code: string]: number } = {
      BracketLeft: 0x5e,
      Quote: 0xb4,
      Backquote: 0x60,
    };
    if (e.code && e.code in deadKeyMap) return deadKeyMap[e.code];
    return null;
  }
  if (e.key.length === 1) return e.key.charCodeAt(0);
  return null;
}

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
        sx={{
          width: '1px',
          height: 24,
          backgroundColor: 'rgba(255,255,255,0.3)',
          mx: 0.5,
        }}
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
              sx={{
                color: a.disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
                '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)' },
                padding: '4px',
              }}
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
  }
>(function TerminalPanel({ item, active, onStatusChange, compact }, ref) {
  const { t } = useTranslation(['translation', 'glossary']);
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminalConnected | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);
  const [fontSize, setFontSize] = useState(14);

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
    xterm.onData(data => send(0, data));
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
      onStatusChange('connecting');
      execRef.current = await item.exec(items => onData(xtermRef.current!, items), {
        reconnectOnFailure: false,
        failCb: () => {
          xtermRef.current?.xterm.write(encoderRef.current.encode(t('\r\n')));
        },
        connectCb: () => {
          if (xtermRef.current) xtermRef.current.connected = true;
          onStatusChange('connected');
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
        '& #xterm-container': {
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
          id="xterm-container"
          ref={x => setTerminalRef(x)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse' }}
        />
      </Box>
    </Box>
  );
});

// ── Shared helpers ──────────────────────────────────────────────────────

/** Build and send a VNC key event (RFB message type 4). */
function sendVncKey(socket: WebSocket, keysym: number, down: boolean) {
  const msg = new Uint8Array(8);
  msg[0] = 4;
  msg[1] = down ? 1 : 0;
  msg[4] = (keysym >> 24) & 0xff;
  msg[5] = (keysym >> 16) & 0xff;
  msg[6] = (keysym >> 8) & 0xff;
  msg[7] = keysym & 0xff;
  socket.send(msg);
}

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

export function VNCPanel({
  item,
  active,
  onStatusChange,
}: {
  item: ConsoleObject;
  active: boolean;
  onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
}) {
  const [errorMessage, setErrorMessage] = useState('');
  const [framebufferSize, setFramebufferSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [localStatus, setLocalStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting'
  );
  const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>('physical');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vncContainerRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<{ cancel: () => void; getSocket: () => WebSocket } | null>(null);

  // Listen for fullscreen changes (exit via Esc, etc.)
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (canvasRef.current && framebufferSize) {
      canvasRef.current.width = framebufferSize.width;
      canvasRef.current.height = framebufferSize.height;
    }
  }, [framebufferSize, localStatus]);

  useEffect(() => {
    if (!active) {
      if (vncRef.current) {
        vncRef.current.cancel();
        vncRef.current = null;
      }
      setLocalStatus('connecting');
      setErrorMessage('');
      setFramebufferSize(null);
      return;
    }

    if (vncRef.current) {
      vncRef.current.cancel();
      vncRef.current = null;
    }

    setLocalStatus('connecting');
    onStatusChange('connecting');
    setErrorMessage('');

    let rfbState = 'ProtocolVersion';
    const decoder = new TextDecoder('latin1');
    const encoder = new TextEncoder();
    let fbWidth = 0;
    let fbHeight = 0;
    let pixelFormat: RFBPixelFormat | null = null;
    let buffer = new Uint8Array(0);

    function appendBuffer(newData: Uint8Array) {
      const combined = new Uint8Array(buffer.length + newData.length);
      combined.set(buffer);
      combined.set(newData, buffer.length);
      buffer = combined;
    }

    function consumeBuffer(length: number): Uint8Array | null {
      if (buffer.length < length) return null;
      const consumed = buffer.slice(0, length);
      buffer = buffer.slice(length);
      return consumed;
    }

    let isCancelled = false;

    (async function () {
      try {
        const connection = await item.vnc(
          (data: ArrayBuffer) => {
            if (isCancelled) return;
            const bytes = new Uint8Array(data);
            appendBuffer(bytes);

            while (true) {
              if (rfbState === 'ProtocolVersion') {
                const msg = consumeBuffer(12);
                if (!msg) break;
                decoder.decode(msg);
                const response = 'RFB 003.008\n';
                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  socket.send(encoder.encode(response));
                  rfbState = 'Security';
                }
              } else if (rfbState === 'Security') {
                if (buffer.length < 1) break;
                const numTypes = buffer[0];
                const msg = consumeBuffer(1 + numTypes);
                if (!msg) break;
                if (numTypes === 0) {
                  console.error('VNC server offered zero security types (connection refused).');
                  setLocalStatus('disconnected');
                  onStatusChange('disconnected');
                  setErrorMessage('VNC connection refused by server.');
                  break;
                }
                const types = Array.from(msg.slice(1));
                // RFB security type 1 = None (no authentication).
                // KubeVirt's VNC proxy handles auth via Kubernetes RBAC — the user must have
                // permission to access the VMI subresource. Once past RBAC, the VNC connection
                // itself uses type 1 (None) since authentication is already established.
                if (types.includes(1)) {
                  const socket = vncRef.current?.getSocket();
                  if (socket && socket.readyState === 1) {
                    socket.send(new Uint8Array([1]));
                    rfbState = 'SecurityResult';
                  }
                } else {
                  console.error(
                    'VNC server does not offer security type None (1). Available types:',
                    types
                  );
                  setLocalStatus('disconnected');
                  onStatusChange('disconnected');
                  setErrorMessage(
                    'VNC connection failed: server requires unsupported authentication.'
                  );
                }
              } else if (rfbState === 'SecurityResult') {
                const msg = consumeBuffer(4);
                if (!msg) break;
                const resultCode = new DataView(msg.buffer, msg.byteOffset).getUint32(0);
                if (resultCode !== 0) {
                  setLocalStatus('disconnected');
                  onStatusChange('disconnected');
                  setErrorMessage('VNC authentication failed.');
                  break;
                }
                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  socket.send(new Uint8Array([1]));
                  rfbState = 'ServerInit';
                }
              } else if (rfbState === 'ServerInit') {
                if (buffer.length < 24) break;
                const view = new DataView(buffer.buffer, buffer.byteOffset);
                const nameLength = view.getUint32(20);
                const totalLength = 24 + nameLength;
                const msg = consumeBuffer(totalLength);
                if (!msg) break;

                const msgView = new DataView(msg.buffer, msg.byteOffset);
                fbWidth = msgView.getUint16(0);
                fbHeight = msgView.getUint16(2);

                pixelFormat = {
                  bitsPerPixel: msgView.getUint8(4),
                  depth: msgView.getUint8(5),
                  bigEndian: msgView.getUint8(6) !== 0,
                  trueColor: msgView.getUint8(7) !== 0,
                  redMax: msgView.getUint16(8),
                  greenMax: msgView.getUint16(10),
                  blueMax: msgView.getUint16(12),
                  redShift: msgView.getUint8(14),
                  greenShift: msgView.getUint8(15),
                  blueShift: msgView.getUint8(16),
                };

                setFramebufferSize({ width: fbWidth, height: fbHeight });
                setLocalStatus('connected');
                onStatusChange('connected');
                rfbState = 'Normal';

                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  // Advertise: Raw (0) + DesktopSize pseudo-encoding (-223)
                  const encodingsMsg = new Uint8Array(12);
                  encodingsMsg[0] = 2; // SetEncodings
                  encodingsMsg[1] = 0;
                  encodingsMsg[2] = 0;
                  encodingsMsg[3] = 2; // 2 encodings
                  // Raw encoding (0)
                  encodingsMsg[4] = 0;
                  encodingsMsg[5] = 0;
                  encodingsMsg[6] = 0;
                  encodingsMsg[7] = 0;
                  // DesktopSize pseudo-encoding (-223 = 0xFFFFFF21)
                  encodingsMsg[8] = 0xff;
                  encodingsMsg[9] = 0xff;
                  encodingsMsg[10] = 0xff;
                  encodingsMsg[11] = 0x21;
                  socket.send(encodingsMsg);

                  const updateMsg = new Uint8Array(10);
                  updateMsg[0] = 3;
                  updateMsg[1] = 0;
                  updateMsg[2] = 0;
                  updateMsg[3] = 0;
                  updateMsg[4] = 0;
                  updateMsg[5] = 0;
                  updateMsg[6] = (fbWidth >> 8) & 0xff;
                  updateMsg[7] = fbWidth & 0xff;
                  updateMsg[8] = (fbHeight >> 8) & 0xff;
                  updateMsg[9] = fbHeight & 0xff;
                  socket.send(updateMsg);
                }
              } else if (rfbState === 'Normal') {
                if (!pixelFormat) break;
                if (buffer.length < 4) break;
                if (buffer[0] === 0) {
                  const view = new DataView(buffer.buffer, buffer.byteOffset);
                  const numRects = view.getUint16(2);
                  let requiredSize = 4;
                  let offset = 4;

                  for (let i = 0; i < numRects; i++) {
                    if (buffer.length < offset + 12) return;
                    const w = view.getUint16(offset + 4);
                    const h = view.getUint16(offset + 6);
                    const encoding = view.getInt32(offset + 8);
                    requiredSize = offset + 12;
                    if (encoding === 0) {
                      // Raw encoding: has pixel data
                      const bytesPerPixel = pixelFormat.bitsPerPixel / 8;
                      requiredSize += w * h * bytesPerPixel;
                    }
                    // Pseudo-encodings (negative values like -223) have no pixel data
                    offset = requiredSize;
                  }

                  if (buffer.length < requiredSize) break;

                  const msg = consumeBuffer(requiredSize);
                  if (!msg) break;

                  const msgView = new DataView(msg.buffer, msg.byteOffset);
                  offset = 4;

                  for (let i = 0; i < numRects; i++) {
                    const x = msgView.getUint16(offset);
                    const y = msgView.getUint16(offset + 2);
                    const w = msgView.getUint16(offset + 4);
                    const h = msgView.getUint16(offset + 6);
                    const encoding = msgView.getInt32(offset + 8);
                    offset += 12;

                    if (encoding === -223) {
                      // DesktopSize pseudo-encoding: w,h = new framebuffer size
                      fbWidth = w;
                      fbHeight = h;
                      setFramebufferSize({ width: w, height: h });
                      // No pixel data for this rect
                    } else if (encoding === 0 && canvasRef.current) {
                      const bytesPerPixel = pixelFormat.bitsPerPixel / 8;
                      const ctx = canvasRef.current.getContext('2d');
                      if (ctx) {
                        const imageData = ctx.createImageData(w, h);
                        for (let py = 0; py < h; py++) {
                          for (let px = 0; px < w; px++) {
                            const pixelOffset = offset + (py * w + px) * bytesPerPixel;
                            const imgOffset = (py * w + px) * 4;
                            if (bytesPerPixel === 4) {
                              imageData.data[imgOffset + 0] = msg[pixelOffset + 2];
                              imageData.data[imgOffset + 1] = msg[pixelOffset + 1];
                              imageData.data[imgOffset + 2] = msg[pixelOffset + 0];
                              imageData.data[imgOffset + 3] = 255;
                            }
                          }
                        }
                        ctx.putImageData(imageData, x, y);
                      }
                      offset += w * h * bytesPerPixel;
                    }
                  }

                  const socket = vncRef.current?.getSocket();
                  if (socket && socket.readyState === 1) {
                    const updateMsg = new Uint8Array(10);
                    updateMsg[0] = 3;
                    updateMsg[1] = 1;
                    updateMsg[2] = 0;
                    updateMsg[3] = 0;
                    updateMsg[4] = 0;
                    updateMsg[5] = 0;
                    updateMsg[6] = (fbWidth >> 8) & 0xff;
                    updateMsg[7] = fbWidth & 0xff;
                    updateMsg[8] = (fbHeight >> 8) & 0xff;
                    updateMsg[9] = fbHeight & 0xff;
                    socket.send(updateMsg);
                  }
                } else {
                  consumeBuffer(1);
                }
              } else {
                break;
              }
            }
          },
          {
            reconnectOnFailure: false,
            connectCb: () => {},
            failCb: () => {
              if (isCancelled) return;
              setLocalStatus('disconnected');
              onStatusChange('disconnected');
              setErrorMessage('VNC connection failed.');
            },
          }
        );

        if (isCancelled) {
          connection.cancel();
          return;
        }
        vncRef.current = connection;
      } catch (error) {
        if (isCancelled) return;
        console.error('VNC connection error:', error);
        setLocalStatus('disconnected');
        onStatusChange('disconnected');
        setErrorMessage('Failed to create VNC connection.');
      }
    })();

    return () => {
      isCancelled = true;
      if (vncRef.current) {
        vncRef.current.cancel();
        vncRef.current = null;
      }
    };
  }, [active, item]);

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
        <Alert
          severity="error"
          onClose={() => setErrorMessage('')}
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 10,
          }}
        >
          {errorMessage}
        </Alert>
      )}

      {localStatus === 'connecting' && !errorMessage && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#fff',
          }}
        >
          <Typography>Connecting to VNC...</Typography>
        </Box>
      )}

      {localStatus === 'connected' && (
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
          {/* VNC toolbar — top right */}
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              bgcolor: 'rgba(0,0,0,0.75)',
              borderRadius: 1,
              px: 1,
              py: 0.5,
            }}
          >
            {/* Ctrl+Alt+Del button */}
            <Tooltip title="Ctrl+Alt+Del" arrow placement="bottom">
              <IconButton
                size="small"
                onClick={() => {
                  const socket = vncRef.current?.getSocket();
                  if (!socket || socket.readyState !== 1) return;
                  [0xffe3, 0xffe9, 0xffff].forEach(k => sendVncKey(socket, k, true));
                  [0xffff, 0xffe9, 0xffe3].forEach(k => sendVncKey(socket, k, false));
                  canvasRef.current?.focus();
                }}
                sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
              >
                <Icon icon="mdi:restart" width={16} />
              </IconButton>
            </Tooltip>

            {/* Send Keys menu */}
            <VNCKeysMenu
              onSend={keys => {
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;
                keys.forEach(k => sendVncKey(socket, k, true));
                [...keys].reverse().forEach(k => sendVncKey(socket, k, false));
                canvasRef.current?.focus();
              }}
            />

            <Box sx={{ width: 1, height: 18, bgcolor: 'rgba(255,255,255,0.2)', mx: 0.25 }} />

            {/* Keyboard mode toggle */}
            <ToggleButtonGroup
              value={keyboardMode}
              exclusive
              onChange={(_, v) => {
                if (v) {
                  setKeyboardMode(v);
                  canvasRef.current?.focus();
                }
              }}
              size="small"
              sx={{
                '& .MuiToggleButton-root': {
                  color: 'rgba(255,255,255,0.7)',
                  borderColor: 'rgba(255,255,255,0.3)',
                  py: 0.25,
                  px: 1,
                  fontSize: '0.7rem',
                  '&.Mui-selected': {
                    bgcolor: 'rgba(255,255,255,0.15)',
                    color: '#fff',
                  },
                },
              }}
            >
              <Tooltip
                title="Character mode: sends typed characters (guest has US layout)"
                arrow
                placement="bottom"
              >
                <ToggleButton value="character">ABC</ToggleButton>
              </Tooltip>
              <Tooltip
                title="Physical mode: sends physical key positions (guest has its own layout)"
                arrow
                placement="bottom"
              >
                <ToggleButton value="physical">
                  <Icon icon="mdi:keyboard" width={16} />
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>

            <Box sx={{ width: 1, height: 18, bgcolor: 'rgba(255,255,255,0.2)', mx: 0.25 }} />

            {/* Screenshot */}
            <Tooltip title="Screenshot" arrow placement="bottom">
              <IconButton
                size="small"
                onClick={() => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  const link = document.createElement('a');
                  link.download = `vnc-${item.getName()}-${new Date()
                    .toISOString()
                    .replace(/[:.]/g, '-')}.png`;
                  link.href = canvas.toDataURL('image/png');
                  link.click();
                }}
                sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
              >
                <Icon icon="mdi:camera" width={16} />
              </IconButton>
            </Tooltip>

            <Box sx={{ width: 1, height: 18, bgcolor: 'rgba(255,255,255,0.2)', mx: 0.25 }} />

            {/* Fullscreen toggle */}
            <Tooltip
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              arrow
              placement="bottom"
            >
              <IconButton
                size="small"
                onClick={() => {
                  if (isFullscreen) {
                    document.exitFullscreen?.();
                  } else {
                    vncContainerRef.current?.requestFullscreen?.();
                  }
                  canvasRef.current?.focus();
                }}
                sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
              >
                <Icon icon={isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} width={16} />
              </IconButton>
            </Tooltip>
          </Box>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            style={{
              display: 'block',
              imageRendering: 'auto',
              outline: 'none',
              cursor: 'default',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
            onMouseDown={e => {
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const scaleX = canvas.width / rect.width;
              const scaleY = canvas.height / rect.height;
              const x = Math.floor((e.clientX - rect.left) * scaleX);
              const y = Math.floor((e.clientY - rect.top) * scaleY);
              const msg = new Uint8Array(6);
              msg[0] = 5;
              msg[1] = 1 << e.button;
              msg[2] = (x >> 8) & 0xff;
              msg[3] = x & 0xff;
              msg[4] = (y >> 8) & 0xff;
              msg[5] = y & 0xff;
              socket.send(msg);
            }}
            onMouseUp={e => {
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const scaleX = canvas.width / rect.width;
              const scaleY = canvas.height / rect.height;
              const x = Math.floor((e.clientX - rect.left) * scaleX);
              const y = Math.floor((e.clientY - rect.top) * scaleY);
              const msg = new Uint8Array(6);
              msg[0] = 5;
              msg[1] = 0;
              msg[2] = (x >> 8) & 0xff;
              msg[3] = x & 0xff;
              msg[4] = (y >> 8) & 0xff;
              msg[5] = y & 0xff;
              socket.send(msg);
            }}
            onMouseMove={e => {
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const scaleX = canvas.width / rect.width;
              const scaleY = canvas.height / rect.height;
              const x = Math.floor((e.clientX - rect.left) * scaleX);
              const y = Math.floor((e.clientY - rect.top) * scaleY);
              const msg = new Uint8Array(6);
              msg[0] = 5;
              msg[1] = 0;
              msg[2] = (x >> 8) & 0xff;
              msg[3] = x & 0xff;
              msg[4] = (y >> 8) & 0xff;
              msg[5] = y & 0xff;
              socket.send(msg);
            }}
            onKeyDown={e => {
              e.preventDefault();
              e.stopPropagation();
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const isAltGr = e.getModifierState && e.getModifierState('AltGraph');
              if (isAltGr) sendVncKey(socket, 0xfe03, true);
              const keysym = getKeysym(e, keyboardMode);
              if (keysym !== null) sendVncKey(socket, keysym, true);
            }}
            onKeyUp={e => {
              e.preventDefault();
              e.stopPropagation();
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const keysym = getKeysym(e, keyboardMode);
              if (keysym !== null) sendVncKey(socket, keysym, false);
              const isAltGr = e.getModifierState && e.getModifierState('AltGraph');
              if (isAltGr) sendVncKey(socket, 0xfe03, false);
            }}
            onClick={() => canvasRef.current?.focus()}
          />
        </Box>
      )}
    </Box>
  );
}

// ── Main VMConsole Component ────────────────────────────────────────────

export default function VMConsole(props: VMConsoleProps) {
  const { item, vm, onClose, initialTab = 'vnc', ...other } = props;
  const [activeTab, setActiveTab] = useState<'vnc' | 'terminal'>(initialTab);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  // Reset tab when dialog opens
  useEffect(() => {
    if (props.open) {
      setActiveTab(initialTab);
      setConnectionStatus('connecting');
    }
  }, [props.open, initialTab]);

  const handleVNCStatus = useCallback(
    (status: 'connecting' | 'connected' | 'disconnected') => {
      if (activeTab === 'vnc') setConnectionStatus(status);
    },
    [activeTab]
  );

  const handleTerminalStatus = useCallback(
    (status: 'connecting' | 'connected') => {
      if (activeTab === 'terminal') setConnectionStatus(status);
    },
    [activeTab]
  );

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
              sx={{ width: '1px', height: 24, backgroundColor: 'rgba(255,255,255,0.3)', mx: 0.5 }}
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
              sx={{
                height: 28,
                '& .MuiToggleButton-root': {
                  color: 'rgba(255,255,255,0.6)',
                  borderColor: 'rgba(255,255,255,0.3)',
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  px: 1.5,
                  py: 0,
                  gap: 0.5,
                  '&.Mui-selected': {
                    color: '#fff',
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' },
                  },
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.08)' },
                },
              }}
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
          item={item}
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
