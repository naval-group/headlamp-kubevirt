import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import usePolling from '../../hooks/usePolling';
import { safeError } from '../../utils/sanitize';

interface PodLogsTabProps {
  podName: string;
  namespace: string;
}

export default function PodLogsTab({ podName, namespace }: PodLogsTabProps) {
  const [containers, setContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState('compute');
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const [tailLines, setTailLines] = useState(1000);
  const logRef = useRef<HTMLPreElement>(null);

  // Discover containers
  useEffect(() => {
    if (!podName || !namespace) return;
    let cancelled = false;

    ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`)
      .then(
        (pod: {
          spec?: { initContainers?: Array<{ name: string }>; containers?: Array<{ name: string }> };
        }) => {
          if (cancelled) return;
          const allContainers: string[] = [];
          (pod?.spec?.initContainers || []).forEach((c: { name: string }) =>
            allContainers.push(c.name)
          );
          (pod?.spec?.containers || []).forEach((c: { name: string }) =>
            allContainers.push(c.name)
          );
          setContainers(allContainers);
          if (!allContainers.includes(selectedContainer) && allContainers.length > 0) {
            setSelectedContainer(allContainers[0]);
          }
        }
      )
      .catch(() => {
        if (!cancelled) setContainers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [podName, namespace]);

  // Fetch logs for selected container
  const hasLogTarget = !!podName && !!namespace && !!selectedContainer;
  useEffect(() => {
    if (!hasLogTarget) {
      setLoading(false);
      setError('No virt-launcher pod found. Is the VM running?');
    } else {
      setLoading(true);
    }
  }, [hasLogTarget]);

  usePolling(
    async cancelled => {
      try {
        const resp: string | { text?: () => Promise<string> } = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/pods/${podName}/log?container=${selectedContainer}&tailLines=${tailLines}`,
          { isJSON: false }
        );
        const text =
          typeof resp === 'string' ? resp : resp?.text ? await resp.text() : String(resp);
        if (!cancelled()) {
          setLogs(text);
          setError(null);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled()) {
          setError(`Failed to fetch logs for ${selectedContainer}: ${safeError(e, 'podLogs')}`);
          setLoading(false);
        }
      }
    },
    5000,
    [podName, namespace, selectedContainer, tailLines],
    hasLogTarget
  );

  // Scroll to bottom whenever logs change or element becomes visible
  const scrollToBottom = React.useCallback(() => {
    if (autoScroll && logRef.current && logRef.current.scrollHeight > 0) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
    const t = setTimeout(scrollToBottom, 150);
    return () => clearTimeout(t);
  }, [logs, scrollToBottom]);

  // Also scroll when the element becomes visible (tab switch from display:none)
  useEffect(() => {
    if (!logRef.current) return;
    const observer = new ResizeObserver(() => scrollToBottom());
    observer.observe(logRef.current);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(logs).catch(() => {});
  };

  const handleDownload = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = `${podName}-${selectedContainer}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    a.download = `${safeName}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!podName) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:text-box-outline" />}>
        No virt-launcher pod found. Is the VM running?
      </Alert>
    );
  }

  // Filter logs
  const matchCount = search
    ? logs.split('\n').filter(l => l.toLowerCase().includes(search.toLowerCase())).length
    : 0;
  const displayLogs = search
    ? logs
        .split('\n')
        .filter(l => l.toLowerCase().includes(search.toLowerCase()))
        .join('\n')
    : logs;

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        <FormControl size="small">
          <Select
            value={selectedContainer}
            onChange={e => setSelectedContainer(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {containers.map(c => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <Select
            value={tailLines}
            onChange={e => setTailLines(Number(e.target.value))}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value={100}>100 lines</MenuItem>
            <MenuItem value={500}>500 lines</MenuItem>
            <MenuItem value={1000}>1000 lines</MenuItem>
            <MenuItem value={5000}>5000 lines</MenuItem>
          </Select>
        </FormControl>
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
          sx={{ minWidth: 220 }}
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
      </Box>

      {/* Container info */}
      <Typography variant="caption" color="text.secondary">
        Pod: {podName} | Container: {selectedContainer} | Refresh: 5s
      </Typography>

      {error && (
        <Alert severity="warning" icon={<Icon icon="mdi:alert" />} sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

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
          flex: 1,
          minHeight: 0,
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
        {loading ? 'Loading...' : displayLogs || 'No logs available.'}
      </Box>
    </Box>
  );
}
