import { Icon } from '@iconify/react';
import { getHeadlampAPIHeaders } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

interface ConsoleLogTabProps {
  podName: string;
  namespace: string;
}

export default function ConsoleLogTab({ podName, namespace }: ConsoleLogTabProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!podName || !namespace) {
      setLoading(false);
      setError('No virt-launcher pod found. Is the VM running?');
      return;
    }
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const headers = getHeadlampAPIHeaders();
        const resp = await fetch(
          `/api/v1/namespaces/${namespace}/pods/${podName}/log?container=guest-console-log&tailLines=5000`,
          { headers }
        );
        if (!resp.ok) {
          throw new Error(`${resp.status} ${resp.statusText}`);
        }
        const text = await resp.text();
        if (!cancelled) {
          setLogs(text);
          setError(null);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('not found') || msg.includes('container') || msg.includes('404')) {
            setError(
              'guest-console-log container not found. Serial console logging may not be enabled for this VM.'
            );
          } else {
            setError(`Failed to fetch console logs: ${msg}`);
          }
          setLoading(false);
        }
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [podName, namespace]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(logs).catch(() => {});
  };

  const handleDownload = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = podName.replace(/[^a-zA-Z0-9._-]/g, '_');
    a.download = `console-log-${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Typography color="text.secondary">Loading console logs...</Typography>;
  }

  if (error) {
    return (
      <Alert severity="warning" icon={<Icon icon="mdi:console" />}>
        {error}
      </Alert>
    );
  }

  // Highlight search matches
  const highlightedLines = search
    ? logs.split('\n').map(line => {
        const idx = line.toLowerCase().indexOf(search.toLowerCase());
        if (idx === -1) return null;
        return line;
      })
    : null;

  const matchCount = highlightedLines ? highlightedLines.filter(l => l !== null).length : 0;
  const displayLogs =
    search && highlightedLines ? highlightedLines.filter(l => l !== null).join('\n') : logs;

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
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
                <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear search">
                  <Icon icon="mdi:close" width={16} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{ minWidth: 250 }}
        />
        <ToggleButtonGroup size="small">
          <ToggleButton value="wrap" selected={wrapLines} onChange={() => setWrapLines(!wrapLines)}>
            <Tooltip title="Wrap lines">
              <Icon icon="mdi:wrap" width={18} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton
            value="scroll"
            selected={autoScroll}
            onChange={() => setAutoScroll(!autoScroll)}
          >
            <Tooltip title="Auto-scroll">
              <Icon icon="mdi:arrow-collapse-down" width={18} />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:content-copy" width={16} />}
          onClick={handleCopy}
        >
          Copy
        </Button>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:download" width={16} />}
          onClick={handleDownload}
        >
          Download
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {logs.split('\n').length} lines | Refresh: 5s
        </Typography>
      </Box>

      {/* Log output */}
      <Box
        ref={logRef}
        component="pre"
        sx={{
          bgcolor: '#1e1e1e',
          color: '#d4d4d4',
          p: 2,
          borderRadius: 1,
          overflow: 'auto',
          maxHeight: '60vh',
          minHeight: 300,
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
        {displayLogs || 'No console output yet.'}
      </Box>
    </Box>
  );
}
