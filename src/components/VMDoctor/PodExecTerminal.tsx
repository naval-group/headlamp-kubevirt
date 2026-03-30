import '@xterm/xterm/css/xterm.css';
import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Chip, Dialog, IconButton, Tooltip, Typography } from '@mui/material';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface PodExecTerminalHandle {
  /** Send text to the terminal's stdin (injects a command) */
  inject: (text: string) => void;
  /** Toggle fullscreen mode */
  toggleFullscreen: () => void;
  /** Current connection status */
  getStatus: () => 'disconnected' | 'connecting' | 'connected';
  /** Trigger reconnect */
  reconnect: () => void;
}

interface PodExecTerminalProps {
  podName: string;
  namespace: string;
  container?: string;
  connectMessage?: string;
  /** Extra elements rendered in the toolbar (right side) */
  toolbarActions?: React.ReactNode;
  /** Hide the built-in toolbar (for custom external toolbar) */
  hideToolbar?: boolean;
  /** Called when connection status changes */
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected') => void;
}

const PodExecTerminal = React.forwardRef<PodExecTerminalHandle, PodExecTerminalProps>(
  function PodExecTerminal(
    {
      podName,
      namespace,
      container,
      connectMessage,
      toolbarActions,
      hideToolbar,
      onStatusChange,
    }: PodExecTerminalProps,
    ref
  ) {
    const execRef = useRef<{ cancel: () => void; getSocket: () => WebSocket | null } | null>(null);
    const xtermRef = useRef<{ xterm: XTerminal; connected: boolean } | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [terminalEl, setTerminalEl] = useState<HTMLElement | null>(null);
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
      'disconnected'
    );
    const [fullscreen, setFullscreen] = useState(false);
    const [reconnectKey, setReconnectKey] = useState(0);

    const decoderRef = useRef(new TextDecoder('utf-8'));

    function send(data: string) {
      const socket = execRef.current?.getSocket();
      if (!socket || socket.readyState !== 1) return;
      const buf = new Uint8Array(data.length + 1);
      buf[0] = 0;
      for (let i = 0; i < data.length; i++) {
        buf[i + 1] = data.charCodeAt(i);
      }
      socket.send(buf);
    }

    useImperativeHandle(ref, () => ({
      inject: (text: string) => {
        xtermRef.current?.xterm.scrollToBottom();
        send(text);
      },
      toggleFullscreen: () => setFullscreen(f => !f),
      getStatus: () => status,
      reconnect: () => setReconnectKey(k => k + 1),
    }));

    function onData(bytes: ArrayBuffer) {
      if (!xtermRef.current) return;
      const view = new Uint8Array(bytes);
      if (view.length === 0) return;
      const channel = view[0];
      if (channel === 1 || channel === 2) {
        const text = decoderRef.current.decode(view.slice(1));
        if (!xtermRef.current.connected) {
          xtermRef.current.connected = true;
          setStatus('connected');
        }
        xtermRef.current.xterm.write(text);
      } else if (channel === 3) {
        const text = decoderRef.current.decode(view.slice(1));
        try {
          const err = JSON.parse(text);
          xtermRef.current.xterm.writeln(`\r\n\x1b[31mError: ${err.message || text}\x1b[0m`);
        } catch {
          xtermRef.current.xterm.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
        }
      }
    }

    useEffect(() => {
      if (!podName || !namespace || !terminalEl) return;

      xtermRef.current?.xterm.dispose();
      execRef.current?.cancel();

      const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].indexOf(navigator?.platform) >= 0;
      const xterm = new XTerminal({
        cursorBlink: true,
        cursorStyle: 'underline',
        scrollback: 10000,
        rows: 24,
        windowsMode: isWindows,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xtermRef.current = { xterm, connected: false };
      fitAddonRef.current = fitAddon;

      xterm.open(terminalEl);
      xterm.onData(data => send(data));

      xterm.onResize(size => {
        const socket = execRef.current?.getSocket();
        if (socket && socket.readyState === 1) {
          const resizeMsg = JSON.stringify({ Width: size.cols, Height: size.rows });
          const buf = new Uint8Array(resizeMsg.length + 1);
          buf[0] = 4;
          for (let i = 0; i < resizeMsg.length; i++) {
            buf[i + 1] = resizeMsg.charCodeAt(i);
          }
          socket.send(buf);
        }
      });

      xterm.attachCustomKeyEventHandler(arg => {
        if (arg.ctrlKey && arg.type === 'keydown') {
          if (arg.code === 'KeyC') {
            const sel = xterm.getSelection();
            if (sel) return false;
          }
          if (arg.code === 'KeyV') return false;
        }
        return true;
      });

      fitAddon.fit();
      setStatus('connecting');
      xterm.writeln(`\x1b[33m${connectMessage || `Connecting to ${podName}...`}\x1b[0m`);

      const command = [
        'sh',
        '-c',
        'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi',
      ];
      const commandStr = command.map(c => '&command=' + encodeURIComponent(c)).join('');
      const containerParam = container ? `container=${encodeURIComponent(container)}&` : '';
      const url = `/api/v1/namespaces/${namespace}/pods/${podName}/exec?${containerParam}${commandStr}&stdin=1&stdout=1&stderr=1&tty=1`;

      const connection = ApiProxy.stream(url, onData, {
        additionalProtocols: [
          'v4.channel.k8s.io',
          'v3.channel.k8s.io',
          'v2.channel.k8s.io',
          'channel.k8s.io',
        ],
        isJson: false,
        connectCb: () => setStatus('connected'),
        failCb: () => {
          setStatus('disconnected');
          xtermRef.current?.xterm.writeln('\r\n\x1b[31mConnection lost.\x1b[0m');
        },
      });

      execRef.current = connection;

      const observer = new ResizeObserver(() => fitAddonRef.current?.fit());
      observer.observe(terminalEl);
      const resizeHandler = () => fitAddonRef.current?.fit();
      window.addEventListener('resize', resizeHandler);

      return () => {
        xterm.dispose();
        connection.cancel();
        observer.disconnect();
        window.removeEventListener('resize', resizeHandler);
      };
    }, [podName, namespace, container, terminalEl, reconnectKey]);

    // Notify parent of status changes
    useEffect(() => {
      onStatusChange?.(status);
    }, [status, onStatusChange]);

    // Re-fit when entering/exiting fullscreen
    useEffect(() => {
      const timer = setTimeout(() => fitAddonRef.current?.fit(), 100);
      return () => clearTimeout(timer);
    }, [fullscreen]);

    const statusColor =
      status === 'connected' ? '#3e8635' : status === 'connecting' ? '#f0ab00' : '#c9190b';

    const toolbar = (
      <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor }} />
        <Typography variant="caption" color="text.secondary">
          {status}
        </Typography>
        {status === 'disconnected' && (
          <Tooltip title="Reconnect">
            <IconButton
              size="small"
              onClick={() => setReconnectKey(k => k + 1)}
              sx={{ p: 0.25 }}
              aria-label="Reconnect"
            >
              <Icon icon="mdi:refresh" width={16} />
            </IconButton>
          </Tooltip>
        )}
        <Chip
          label={`${container ? container + ' @ ' : ''}${podName}`}
          size="small"
          variant="outlined"
          sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
        />
        <Box flex={1} />
        {toolbarActions}
        <IconButton
          size="small"
          onClick={() => setFullscreen(f => !f)}
          sx={{ p: 0.5 }}
          aria-label="Toggle fullscreen"
        >
          <Icon icon={fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} width={18} />
        </IconButton>
      </Box>
    );

    const terminalBox = (
      <Box
        ref={setTerminalEl}
        sx={{
          flex: 1,
          minHeight: fullscreen ? 0 : 300,
          bgcolor: '#1e1e1e',
          borderRadius: fullscreen ? 0 : 1,
          overflow: 'hidden',
          '& .xterm': {
            height: '100%',
            padding: 1,
            '& .xterm-viewport': { width: 'initial !important' },
          },
        }}
      />
    );

    if (fullscreen) {
      return (
        <>
          {/* Keep inline slot so parent layout doesn't collapse */}
          <Box sx={{ flex: 1, minHeight: 0 }} />
          <Dialog
            open
            fullScreen
            onClose={() => setFullscreen(false)}
            PaperProps={{
              sx: {
                bgcolor: '#1e1e1e',
                display: 'flex',
                flexDirection: 'column',
              },
            }}
          >
            <Box sx={{ p: 1, bgcolor: '#2d2d2d' }}>{toolbar}</Box>
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {terminalBox}
            </Box>
          </Dialog>
        </>
      );
    }

    return (
      <Box
        display="flex"
        flexDirection="column"
        gap={hideToolbar ? 0 : 1}
        sx={{ flex: 1, minHeight: 0 }}
      >
        {!hideToolbar && toolbar}
        {terminalBox}
      </Box>
    );
  }
);

export default PodExecTerminal;
