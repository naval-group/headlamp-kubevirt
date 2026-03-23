import '@xterm/xterm/css/xterm.css';
import { Icon } from '@iconify/react';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import {
  Alert,
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RFBPixelFormat } from '../../types';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

// ── Terminal types ──────────────────────────────────────────────────────

interface ConsoleObject extends KubeObject {
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

function getKeysym(e: React.KeyboardEvent): number | null {
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
  };
  if (e.key in specialKeys) return specialKeys[e.key];
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
  const { enqueueSnackbar } = useSnackbar();
  if (!vm) return null;

  const status = vm.status?.printableStatus || 'Unknown';

  const actions = [
    {
      icon: 'mdi:play',
      label: 'Start',
      disabled: status !== 'Stopped',
      handler: async () => {
        try {
          await vm.start();
          enqueueSnackbar('VM started', { variant: 'success' });
        } catch (e) {
          enqueueSnackbar('Failed to start: ' + e, { variant: 'error' });
        }
      },
    },
    {
      icon: 'mdi:stop',
      label: 'Stop',
      disabled: status === 'Stopped' || status === 'Stopping',
      handler: async () => {
        try {
          await vm.stop();
          enqueueSnackbar('VM stopped', { variant: 'success' });
        } catch (e) {
          enqueueSnackbar('Failed to stop: ' + e, { variant: 'error' });
        }
      },
    },
    {
      icon: 'mdi:stop-circle',
      label: 'Force Stop',
      disabled: status === 'Stopped',
      handler: async () => {
        try {
          await vm.forceStop();
          enqueueSnackbar('VM force stopped', { variant: 'success' });
        } catch (e) {
          enqueueSnackbar('Failed to force stop: ' + e, { variant: 'error' });
        }
      },
    },
    {
      icon: 'mdi:restart',
      label: 'Restart',
      disabled: status !== 'Running',
      handler: async () => {
        try {
          await vm.restart();
          enqueueSnackbar('VM restarting', { variant: 'success' });
        } catch (e) {
          enqueueSnackbar('Failed to restart: ' + e, { variant: 'error' });
        }
      },
    },
  ];

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
      {actions.map(a => (
        <Tooltip key={a.label} title={a.label}>
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

function TerminalPanel({
  item,
  active,
  onStatusChange,
}: {
  item: ConsoleObject;
  active: boolean;
  onStatusChange: (status: 'connecting' | 'connected') => void;
}) {
  const { t } = useTranslation(['translation', 'glossary']);
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminalConnected | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');

  function send(channel: number, data: string) {
    const socket = execRef.current?.getSocket();
    if (!socket || socket.readyState !== 1) return;
    const encoded = encoder.encode(data);
    socket.send(encoded);
  }

  function onData(xtermc: XTerminalConnected, bytes: ArrayBuffer) {
    const xterm = xtermc.xterm;
    const text = decoder.decode(bytes);
    if (!xtermc.connected) {
      xtermc.connected = true;
      xterm.writeln(t('Connected to terminal…'));
    }
    xterm.write(text);
  }

  function setupTerminal(itemRef: HTMLElement, xterm: XTerminal, fitAddon: FitAddon) {
    if (!itemRef) return;
    xterm.open(itemRef);
    xterm.onData(data => send(0, data));
    xterm.onResize(size => {
      const resizeData = `{"Width":${size.cols},"Height":${size.rows}}`;
      const socket = execRef.current?.getSocket();
      if (socket && socket.readyState === 1) {
        const encoded = encoder.encode(resizeData);
        socket.send(encoded);
      }
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
          xtermRef.current?.xterm.write(encoder.encode(t('\r\n')));
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
      <Box
        sx={theme => ({
          paddingTop: theme.spacing(1),
          paddingBottom: theme.spacing(1),
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
}

// ── VNC Panel ───────────────────────────────────────────────────────────

function VNCPanel({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vncRef = useRef<any>(null);

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

    (async function () {
      try {
        vncRef.current = await item.vnc(
          (data: ArrayBuffer) => {
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
                if (numTypes > 0) {
                  const types = Array.from(msg.slice(1));
                  if (types.includes(1)) {
                    const socket = vncRef.current?.getSocket();
                    if (socket && socket.readyState === 1) {
                      socket.send(new Uint8Array([1]));
                      rfbState = 'SecurityResult';
                    }
                  }
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
                  const encodingsMsg = new Uint8Array(8);
                  encodingsMsg[0] = 2;
                  encodingsMsg[1] = 0;
                  encodingsMsg[2] = 0;
                  encodingsMsg[3] = 1;
                  encodingsMsg[4] = 0;
                  encodingsMsg[5] = 0;
                  encodingsMsg[6] = 0;
                  encodingsMsg[7] = 0;
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
                      const bytesPerPixel = pixelFormat!.bitsPerPixel / 8;
                      requiredSize += w * h * bytesPerPixel;
                    }
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

                    if (encoding === 0 && canvasRef.current) {
                      const bytesPerPixel = pixelFormat!.bitsPerPixel / 8;
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
              setLocalStatus('disconnected');
              onStatusChange('disconnected');
              setErrorMessage('VNC connection failed.');
            },
          }
        );
      } catch (error) {
        setLocalStatus('disconnected');
        onStatusChange('disconnected');
        setErrorMessage(`Failed to create VNC connection: ${error}`);
      }
    })();

    return () => {
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
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            width: '100%',
            minHeight: 0,
            position: 'relative',
          }}
        >
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
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const sendKeyEvent = (keysym: number, down: boolean) => {
                const msg = new Uint8Array(8);
                msg[0] = 4;
                msg[1] = down ? 1 : 0;
                msg[2] = 0;
                msg[3] = 0;
                msg[4] = (keysym >> 24) & 0xff;
                msg[5] = (keysym >> 16) & 0xff;
                msg[6] = (keysym >> 8) & 0xff;
                msg[7] = keysym & 0xff;
                socket.send(msg);
              };
              const isAltGr = e.getModifierState && e.getModifierState('AltGraph');
              if (isAltGr) sendKeyEvent(0xfe03, true);
              const keysym = getKeysym(e);
              if (keysym !== null) sendKeyEvent(keysym, true);
            }}
            onKeyUp={e => {
              e.preventDefault();
              const socket = vncRef.current?.getSocket();
              if (!socket || socket.readyState !== 1) return;
              const sendKeyEvent = (keysym: number, down: boolean) => {
                const msg = new Uint8Array(8);
                msg[0] = 4;
                msg[1] = down ? 1 : 0;
                msg[2] = 0;
                msg[3] = 0;
                msg[4] = (keysym >> 24) & 0xff;
                msg[5] = (keysym >> 16) & 0xff;
                msg[6] = (keysym >> 8) & 0xff;
                msg[7] = keysym & 0xff;
                socket.send(msg);
              };
              const keysym = getKeysym(e);
              if (keysym !== null) sendKeyEvent(keysym, false);
              const isAltGr = e.getModifierState && e.getModifierState('AltGraph');
              if (isAltGr) sendKeyEvent(0xfe03, false);
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
      onClose={onClose}
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
