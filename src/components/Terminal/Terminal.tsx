import '@xterm/xterm/css/xterm.css';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import { Box } from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

enum Channel {
  StdIn = 0,
  StdOut,
  StdErr,
  ServerError,
  Resize,
}

interface TerminalProps extends DialogProps {
  item: VirtualMachineInstance;
  onClose?: () => void;
  open: boolean;
}

interface ConsoleObject extends KubeObject {
  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket };
}

interface XTerminalConnected {
  xterm: XTerminal;
  connected: boolean;
  reconnectOnEnter: boolean;
}
type execReturn = ReturnType<ConsoleObject['exec']>;

export default function Terminal(props: TerminalProps) {
  const { item, onClose, ...other } = props;
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminalConnected | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected'>(
    'connecting'
  );

  const { t } = useTranslation(['translation', 'glossary']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  function setupTerminal(itemRef: HTMLElement, xterm: XTerminal, fitAddon: FitAddon) {
    if (!itemRef) {
      return;
    }

    xterm.open(itemRef);

    xterm.onData(data => {
      send(0, data);
    });

    xterm.onResize(size => {
      // Send resize info to channel 4 without displaying it in the terminal
      const resizeData = `{"Width":${size.cols},"Height":${size.rows}}`;
      const socket = execRef.current?.getSocket();
      if (socket && socket.readyState === 1) {
        const encoded = encoder.encode(resizeData);
        socket.send(encoded);
      }
    });

    // Allow copy/paste in terminal
    xterm.attachCustomKeyEventHandler(arg => {
      if (arg.ctrlKey && arg.type === 'keydown') {
        if (arg.code === 'KeyC') {
          const selection = xterm.getSelection();
          if (selection) {
            return false;
          }
        }
        if (arg.code === 'KeyV') {
          return false;
        }
      }

      return true;
    });
    fitAddon.fit();
  }

  function send(channel: number, data: string) {
    const socket = execRef.current!.getSocket();

    if (!socket || socket.readyState !== 1) {
      return;
    }
    const encoded = encoder.encode(data);
    socket.send(encoded);
  }
  function onData(xtermc: XTerminalConnected, bytes: ArrayBuffer) {
    const xterm = xtermc.xterm;
    // Only show data from stdout, stderr and server error channel.
    const channel: Channel = Channel.StdOut;
    if (channel < Channel.StdOut || channel > Channel.ServerError) {
      console.warn('Ignoring channel:', channel);
      return;
    }

    // The first byte is discarded because it just identifies whether
    // this data is from stderr, stdout, or stdin.
    const text = decoder.decode(bytes);
    if (!xtermc.connected) {
      xtermc.connected = true;
      xterm.writeln(t('Connected to terminal…'));
    }
    xterm.write(text);
  }
  useEffect(() => {
    // Don't do anything if the dialog is not open.
    if (!props.open) {
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
        rows: 30, // initial rows before fit
        windowsMode: isWindows,
        allowProposedApi: true,
      }),
      connected: false,
      reconnectOnEnter: false,
    };

    fitAddonRef.current = new FitAddon();
    xtermRef.current.xterm.loadAddon(fitAddonRef.current);

    (async function () {
      setConnectionStatus('connecting');
      execRef.current = await item.exec(items => onData(xtermRef.current!, items), {
        reconnectOnFailure: false,
        failCb: () => {
          xtermRef.current!.xterm.write(encoder.encode(t('\r\n')));
        },
        connectCb: () => {
          xtermRef.current!.connected = true;
          setConnectionStatus('connected');
          // Clear any pending input (Ctrl+U) then send Enter to trigger prompt.
          // Ctrl+U discards the current line buffer, preventing accidental execution
          // of commands left over from a previous serial console session.
          setTimeout(() => {
            send(0, '\x15\r');
          }, 500);
        },
        tty: false,
        stderr: false,
        stdin: false,
        stdout: false,
      });
      setupTerminal(terminalRef, xtermRef.current!.xterm, fitAddonRef.current!);
    })();

    const handler = () => {
      fitAddonRef.current!.fit();
    };

    window.addEventListener('resize', handler);

    return function cleanup() {
      xtermRef.current?.xterm.dispose();
      execRef.current?.cancel();
      window.removeEventListener('resize', handler);
    };
  }, [terminalRef, props.open, item]);

  return (
    <Dialog
      onClose={onClose}
      onFullScreenToggled={() => {
        setTimeout(() => {
          fitAddonRef.current!.fit();
        }, 1);
      }}
      withFullScreen
      title={
        (
          <Box display="flex" alignItems="center" gap={1}>
            <span>Terminal: {item.getName()}</span>
            <Box
              component="span"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: connectionStatus === 'connected' ? '#4caf50' : '#ff9800',
                display: 'inline-block',
              }}
            />
          </Box>
        ) as unknown as string
      }
      {...other}
    >
      <DialogContent
        sx={theme => ({
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          '& .xterm ': {
            height: '100vh', // So the terminal doesn't stay shrunk when shrinking vertically and maximizing again.
            '& .xterm-viewport': {
              width: 'initial !important', // BugFix: https://github.com/xtermjs/xterm.js/issues/3564#issuecomment-1004417440
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
      </DialogContent>
    </Dialog>
  );
}
