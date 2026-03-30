import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltipProps } from '../../types';
import { safeError, sanitizePromQL } from '../../utils/sanitize';

interface PrometheusQuerierProps {
  vmName: string;
  namespace: string;
}

interface MetricPreset {
  query: string;
  label: string;
  unit: string;
  group: string;
}

interface ChartPanel {
  id: string;
  col: number; // which column (0-based)
  preset: MetricPreset;
  chartData: Array<Record<string, any>>;
  seriesKeys: string[];
  seriesCount: number;
  loading: boolean;
  error: string | null;
}

const METRIC_PRESETS: MetricPreset[] = [
  {
    query:
      'sum(rate(kubevirt_vmi_vcpu_seconds_total{name="$VM",namespace="$NS",state="running"}[5m])) * 100',
    label: 'CPU Usage %',
    unit: '%',
    group: 'CPU',
  },
  {
    query: 'sum(rate(kubevirt_vmi_vcpu_wait_seconds_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'vCPU Wait Rate',
    unit: 's/s',
    group: 'CPU',
  },
  {
    query: 'rate(kubevirt_vmi_cpu_system_usage_seconds_total{name="$VM",namespace="$NS"}[5m])',
    label: 'CPU System Rate',
    unit: 's/s',
    group: 'CPU',
  },
  {
    query: 'rate(kubevirt_vmi_cpu_user_usage_seconds_total{name="$VM",namespace="$NS"}[5m])',
    label: 'CPU User Rate',
    unit: 's/s',
    group: 'CPU',
  },
  {
    query: 'kubevirt_vmi_memory_available_bytes{name="$VM",namespace="$NS"} / (1024*1024*1024)',
    label: 'Memory Available',
    unit: 'GiB',
    group: 'Memory',
  },
  {
    query: 'kubevirt_vmi_memory_usable_bytes{name="$VM",namespace="$NS"} / (1024*1024*1024)',
    label: 'Memory Usable',
    unit: 'GiB',
    group: 'Memory',
  },
  {
    query: 'kubevirt_vmi_memory_domain_bytes{name="$VM",namespace="$NS"} / (1024*1024*1024)',
    label: 'Memory Domain Total',
    unit: 'GiB',
    group: 'Memory',
  },
  {
    query: 'kubevirt_vmi_memory_resident_bytes{name="$VM",namespace="$NS"} / (1024*1024)',
    label: 'Memory Resident (RSS)',
    unit: 'MiB',
    group: 'Memory',
  },
  {
    query: 'kubevirt_vmi_memory_unused_bytes{name="$VM",namespace="$NS"} / (1024*1024)',
    label: 'Memory Unused',
    unit: 'MiB',
    group: 'Memory',
  },
  {
    query: 'kubevirt_vmi_memory_cached_bytes{name="$VM",namespace="$NS"} / (1024*1024)',
    label: 'Memory Cached',
    unit: 'MiB',
    group: 'Memory',
  },
  {
    query: 'rate(kubevirt_vmi_memory_swap_in_traffic_bytes{name="$VM",namespace="$NS"}[5m]) / 1024',
    label: 'Swap In Rate',
    unit: 'KiB/s',
    group: 'Swap',
  },
  {
    query:
      'rate(kubevirt_vmi_memory_swap_out_traffic_bytes{name="$VM",namespace="$NS"}[5m]) / 1024',
    label: 'Swap Out Rate',
    unit: 'KiB/s',
    group: 'Swap',
  },
  {
    query: 'rate(kubevirt_vmi_memory_pgmajfault_total{name="$VM",namespace="$NS"}[5m])',
    label: 'Page Major Faults Rate',
    unit: '/s',
    group: 'Memory',
  },
  {
    query: 'rate(kubevirt_vmi_memory_pgminfault_total{name="$VM",namespace="$NS"}[5m])',
    label: 'Page Minor Faults Rate',
    unit: '/s',
    group: 'Memory',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_network_receive_bytes_total{name="$VM",namespace="$NS"}[5m])) / 1024',
    label: 'Network RX Rate',
    unit: 'KiB/s',
    group: 'Network',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_network_transmit_bytes_total{name="$VM",namespace="$NS"}[5m])) / 1024',
    label: 'Network TX Rate',
    unit: 'KiB/s',
    group: 'Network',
  },
  {
    query: 'sum(rate(kubevirt_vmi_network_receive_packets_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network RX Packets Rate',
    unit: 'pkt/s',
    group: 'Network',
  },
  {
    query: 'sum(rate(kubevirt_vmi_network_transmit_packets_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network TX Packets Rate',
    unit: 'pkt/s',
    group: 'Network',
  },
  {
    query: 'sum(rate(kubevirt_vmi_network_receive_errors_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network RX Errors Rate',
    unit: '/s',
    group: 'Network',
  },
  {
    query: 'sum(rate(kubevirt_vmi_network_transmit_errors_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network TX Errors Rate',
    unit: '/s',
    group: 'Network',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_network_receive_packets_dropped_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network RX Dropped Rate',
    unit: '/s',
    group: 'Network',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_network_transmit_packets_dropped_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Network TX Dropped Rate',
    unit: '/s',
    group: 'Network',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_storage_read_traffic_bytes_total{name="$VM",namespace="$NS"}[5m])) / 1024',
    label: 'Storage Read Rate',
    unit: 'KiB/s',
    group: 'Storage',
  },
  {
    query:
      'sum(rate(kubevirt_vmi_storage_write_traffic_bytes_total{name="$VM",namespace="$NS"}[5m])) / 1024',
    label: 'Storage Write Rate',
    unit: 'KiB/s',
    group: 'Storage',
  },
  {
    query: 'sum(rate(kubevirt_vmi_storage_iops_read_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Storage Read IOPS',
    unit: 'ops/s',
    group: 'Storage',
  },
  {
    query: 'sum(rate(kubevirt_vmi_storage_iops_write_total{name="$VM",namespace="$NS"}[5m]))',
    label: 'Storage Write IOPS',
    unit: 'ops/s',
    group: 'Storage',
  },
  {
    query: 'rate(kubevirt_vmi_storage_read_times_seconds_total{name="$VM",namespace="$NS"}[5m])',
    label: 'Storage Read Latency',
    unit: 's/s',
    group: 'Storage',
  },
  {
    query: 'rate(kubevirt_vmi_storage_write_times_seconds_total{name="$VM",namespace="$NS"}[5m])',
    label: 'Storage Write Latency',
    unit: 's/s',
    group: 'Storage',
  },
  {
    query: 'rate(kubevirt_vmi_storage_flush_requests_total{name="$VM",namespace="$NS"}[5m])',
    label: 'Storage Flush Rate',
    unit: '/s',
    group: 'Storage',
  },
  {
    query: 'kubevirt_vmi_filesystem_capacity_bytes{name="$VM",namespace="$NS"} / (1024*1024*1024)',
    label: 'Filesystem Capacity',
    unit: 'GiB',
    group: 'Filesystem',
  },
  {
    query: 'kubevirt_vmi_filesystem_used_bytes{name="$VM",namespace="$NS"} / (1024*1024*1024)',
    label: 'Filesystem Used',
    unit: 'GiB',
    group: 'Filesystem',
  },
  {
    query: 'kubevirt_vmi_migration_data_remaining_bytes{name="$VM",namespace="$NS"} / (1024*1024)',
    label: 'Migration Data Remaining',
    unit: 'MiB',
    group: 'Migration',
  },
  {
    query: 'kubevirt_vmi_migration_data_processed_bytes{name="$VM",namespace="$NS"} / (1024*1024)',
    label: 'Migration Data Processed',
    unit: 'MiB',
    group: 'Migration',
  },
  {
    query: 'kubevirt_vmi_migration_dirty_memory_rate_bytes{name="$VM",namespace="$NS"} / 1024',
    label: 'Migration Dirty Memory Rate',
    unit: 'KiB/s',
    group: 'Migration',
  },
  {
    query: 'kubevirt_vmi_migration_disk_transfer_rate_bytes{name="$VM",namespace="$NS"} / 1024',
    label: 'Migration Disk Transfer Rate',
    unit: 'KiB/s',
    group: 'Migration',
  },
];

const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <Box
        sx={{ bgcolor: '#1e1e2e', p: 1.5, border: '1px solid #555', borderRadius: 1, boxShadow: 3 }}
      >
        <Typography
          variant="caption"
          display="block"
          sx={{ color: '#e0e0e0', fontWeight: 600, mb: 0.5 }}
        >
          {label}
        </Typography>
        {payload.map((entry: ChartTooltipProps['payload'][number], idx: number) => (
          <Typography key={idx} variant="caption" display="block" sx={{ color: '#e0e0e0' }}>
            <Box component="span" sx={{ color: entry.color, fontWeight: 600 }}>
              {entry.name}
            </Box>
            : {typeof entry.value === 'number' ? entry.value.toFixed(4) : entry.value}
          </Typography>
        ))}
      </Box>
    );
  }
  return null;
};

const NOISE_LABELS = new Set([
  '__name__',
  'name',
  'namespace',
  'job',
  'instance',
  'endpoint',
  'service',
  'pod',
  'container',
  'node',
  'kubernetes_vmi_label_kubevirt_io_domain',
  'kubernetes_vmi_label_kubevirt_io_nodeName',
  'kubernetes_vmi_label_kubevirt_io_size',
]);

const COLORS = [
  '#66bb6a',
  '#42a5f5',
  '#ffca28',
  '#ef5350',
  '#ce93d8',
  '#26c6da',
  '#ff7043',
  '#a1887f',
];

const GROUP_COLORS: Record<string, string> = {
  CPU: '#9c27b0',
  Memory: '#9c27b0',
  Swap: '#9c27b0',
  Network: '#2196f3',
  Storage: '#ff9800',
  Filesystem: '#ff9800',
  Migration: '#00bcd4',
};

export default function PrometheusQuerier({ vmName, namespace }: PrometheusQuerierProps) {
  const panelIdRef = useRef(0);
  const [panels, setPanels] = useState<ChartPanel[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [timeRange, setTimeRange] = useState('30m');
  const [columns, setColumns] = useState<number>(1);
  const [promBaseUrl, setPromBaseUrl] = useState<string | null>(null);
  const executingRef = useRef<Set<string>>(new Set());

  // Drag state: source panel id + drop indicator
  const dragIdRef = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    col: number;
    index: number; // insert before this index in the column
  } | null>(null);

  useEffect(() => {
    ApiProxy.request('/api/v1/services')
      .then((svcResp: any) => {
        const svcItems = svcResp?.items || [];
        const promSvc = svcItems.find((svc: any) => {
          const name = svc.metadata?.name || '';
          const ports = svc.spec?.ports || [];
          return name.includes('prometheus') && ports.some((p: any) => p.port === 9090);
        });
        if (promSvc) {
          setPromBaseUrl(
            `/api/v1/namespaces/${promSvc.metadata.namespace}/services/${promSvc.metadata.name}:9090/proxy`
          );
        }
      })
      .catch(() => {});
  }, []);

  const getTimeRangeSeconds = (range: string): number => {
    const value = parseInt(range);
    const unit = range.slice(-1);
    const multipliers: Record<string, number> = { m: 60, h: 3600 };
    return value * (multipliers[unit] || 60);
  };

  const fetchPreset = useCallback(
    async (
      preset: MetricPreset,
      range: string
    ): Promise<Omit<ChartPanel, 'preset' | 'id' | 'col'>> => {
      if (!promBaseUrl)
        return {
          chartData: [],
          seriesKeys: [],
          seriesCount: 0,
          loading: false,
          error: 'No Prometheus',
        };
      try {
        const resolvedQuery = preset.query
          .replace(/\$VM/g, sanitizePromQL(vmName))
          .replace(/\$NS/g, sanitizePromQL(namespace));
        const now = Math.floor(Date.now() / 1000);
        const rangeSeconds = getTimeRangeSeconds(range);
        const start = now - rangeSeconds;
        const step = Math.max(Math.floor(rangeSeconds / 60), 15);
        const resp = await ApiProxy.request(
          `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
            resolvedQuery
          )}&start=${start}&end=${now}&step=${step}`
        );
        if (resp?.data?.result) {
          const resultData = resp.data.result;
          if (resultData.length > 0) {
            const timestampSet = new Set<number>();
            resultData.forEach((r: any) => {
              (r.values || []).forEach(([ts]: [number, string]) => timestampSet.add(ts));
            });
            const timestamps = Array.from(timestampSet).sort();
            const keys = resultData.map((r: any) => {
              const labels = r.metric || {};
              const meaningful = Object.entries(labels)
                .filter(([k]) => !NOISE_LABELS.has(k))
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
              if (meaningful)
                return meaningful.length > 80 ? meaningful.slice(0, 77) + '...' : meaningful;
              return (
                labels.drive || labels.interface || labels.state || labels.__name__ || preset.label
              );
            });
            const valueMaps = resultData.map((r: any) => {
              const map = new Map<number, number>();
              (r.values || []).forEach(([ts, v]: [number, string]) => map.set(ts, parseFloat(v)));
              return map;
            });
            const data = timestamps.map(ts => {
              const point: Record<string, any> = { time: new Date(ts * 1000).toLocaleTimeString() };
              keys.forEach((key: string, i: number) => {
                point[key] = valueMaps[i].get(ts) ?? null;
              });
              return point;
            });
            return {
              chartData: data,
              seriesKeys: keys,
              seriesCount: resultData.length,
              loading: false,
              error: null,
            };
          }
          return { chartData: [], seriesKeys: [], seriesCount: 0, loading: false, error: null };
        }
        return {
          chartData: [],
          seriesKeys: [],
          seriesCount: 0,
          loading: false,
          error: 'No data returned',
        };
      } catch (e: any) {
        return {
          chartData: [],
          seriesKeys: [],
          seriesCount: 0,
          loading: false,
          error: safeError(e, 'prometheusQuery'),
        };
      }
    },
    [promBaseUrl, vmName, namespace]
  );

  const addPanel = useCallback(
    async (preset: MetricPreset) => {
      const key = preset.query;
      if (executingRef.current.has(key)) return;
      executingRef.current.add(key);
      const id = `panel-${++panelIdRef.current}`;
      setPanels(prev => {
        // Find column with fewest panels using current state
        const colCounts = Array.from(
          { length: columns },
          (_, i) => prev.filter(p => p.col === i).length
        );
        const minCol = colCounts.indexOf(Math.min(...colCounts));
        return [
          ...prev,
          {
            id,
            col: minCol,
            preset,
            chartData: [],
            seriesKeys: [],
            seriesCount: 0,
            loading: true,
            error: null,
          },
        ];
      });
      const result = await fetchPreset(preset, timeRange);
      executingRef.current.delete(key);
      setPanels(prev => prev.map(p => (p.id === id ? { ...p, ...result } : p)));
    },
    [fetchPreset, timeRange, columns]
  );

  const removePanel = useCallback((id: string) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  }, []);

  // When column count decreases, reassign panels that are in columns beyond the new count
  useEffect(() => {
    setPanels(prev => {
      const needsFix = prev.some(p => p.col >= columns);
      if (!needsFix) return prev;
      return prev.map(p => (p.col >= columns ? { ...p, col: 0 } : p));
    });
  }, [columns]);

  // Re-fetch all panels when time range or fetchPreset identity changes
  useEffect(() => {
    if (!promBaseUrl) return;
    setPanels(prev => {
      if (prev.length === 0) return prev;
      // Mark all loading; kick off fetches
      const toFetch = prev.map(p => ({ id: p.id, preset: p.preset }));
      Promise.all(
        toFetch.map(async ({ id, preset }) => {
          const result = await fetchPreset(preset, timeRange);
          return { id, result };
        })
      ).then(results => {
        setPanels(cur =>
          cur.map(p => {
            const r = results.find(r => r.id === p.id);
            return r ? { ...p, ...r.result } : p;
          })
        );
      });
      return prev.map(p => ({ ...p, loading: true }));
    });
  }, [timeRange, promBaseUrl, fetchPreset]);

  // --- Drag handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const el = (e.currentTarget as HTMLElement).closest('[data-panel-id]') as HTMLElement;
    if (el) {
      el.style.opacity = '0.4';
      e.dataTransfer.setDragImage(el, 20, 20);
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const el = (e.currentTarget as HTMLElement).closest('[data-panel-id]') as HTMLElement;
    if (el) el.style.opacity = '1';
    dragIdRef.current = null;
    setDropIndicator(null);
  }, []);

  // Card drag over: determines insert position within the column
  const handleCardDragOver = useCallback(
    (e: React.DragEvent, panel: ChartPanel, colPanels: ChartPanel[]) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (!dragIdRef.current || dragIdRef.current === panel.id) {
        setDropIndicator(null);
        return;
      }
      const card = e.currentTarget as HTMLElement;
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const idxInCol = colPanels.findIndex(p => p.id === panel.id);
      const insertIdx = e.clientY < midY ? idxInCol : idxInCol + 1;
      setDropIndicator({ col: panel.col, index: insertIdx });
    },
    []
  );

  // Empty column drop zone
  const handleColumnDragOver = useCallback((e: React.DragEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!dragIdRef.current) return;
    // Only set if not already over a card in this column
    setDropIndicator(prev => {
      if (prev && prev.col === col) return prev; // card handler takes priority
      return { col, index: 0 };
    });
  }, []);

  const handleColumnDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    const zone = e.currentTarget as HTMLElement;
    if (!related || !zone.contains(related)) {
      setDropIndicator(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, col: number) => {
      e.preventDefault();
      e.stopPropagation();
      const sourceId = e.dataTransfer.getData('text/plain') || dragIdRef.current;
      const indicator = dropIndicator;
      dragIdRef.current = null;
      setDropIndicator(null);
      if (!sourceId) return;

      const targetCol = indicator?.col ?? col;
      const insertIdx = indicator?.index ?? 0;

      setPanels(prev => {
        const source = prev.find(p => p.id === sourceId);
        if (!source) return prev;

        // Remove source from list
        const without = prev.filter(p => p.id !== sourceId);

        // Get panels in the target column (after removing source)
        const colPanels = without.filter(p => p.col === targetCol);
        const otherPanels = without.filter(p => p.col !== targetCol);

        // Clamp insert index
        const clampedIdx = Math.min(insertIdx, colPanels.length);

        // Insert the moved panel
        const movedPanel = { ...source, col: targetCol };
        colPanels.splice(clampedIdx, 0, movedPanel);

        return [...otherPanels, ...colPanels];
      });
    },
    [dropIndicator]
  );

  if (!promBaseUrl) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:database-search" />}>
        Prometheus not available. Install Prometheus to use the metric querier.
      </Alert>
    );
  }

  const addedQueries = new Set(panels.map(p => p.preset.query));
  const availablePresets = METRIC_PRESETS.filter(p => !addedQueries.has(p.query));
  const sortedPresets = [...availablePresets].sort((a, b) => a.group.localeCompare(b.group));
  const chartHeight = columns === 1 ? 220 : columns === 2 ? 180 : 150;

  // Build column arrays preserving order
  const colArrays: ChartPanel[][] = Array.from({ length: columns }, () => []);
  panels.forEach(p => {
    const c = Math.min(p.col, columns - 1);
    colArrays[c].push(p);
  });

  const renderCard = (panel: ChartPanel, colPanels: ChartPanel[]) => {
    const groupColor = GROUP_COLORS[panel.preset.group] || '#757575';
    return (
      <Card
        key={panel.id}
        data-panel-id={panel.id}
        variant="outlined"
        sx={{ borderLeft: `3px solid ${groupColor}` }}
        onDragOver={e => handleCardDragOver(e, panel, colPanels)}
        onDrop={e => handleDrop(e, panel.col)}
      >
        <CardContent sx={{ pb: '12px !important' }}>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            mb={1}
            draggable
            onDragStart={e => handleDragStart(e, panel.id)}
            onDragEnd={handleDragEnd}
            sx={{ cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}
          >
            <Icon
              icon="mdi:drag-horizontal-variant"
              width={16}
              style={{ opacity: 0.4, flexShrink: 0 }}
            />
            <Typography variant="subtitle2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
              {panel.preset.label}
            </Typography>
            {panel.seriesCount > 0 && (
              <Chip
                label={`${panel.seriesCount} series`}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.7rem', flexShrink: 0 }}
              />
            )}
            {panel.preset.unit && (
              <Chip
                label={panel.preset.unit}
                size="small"
                sx={{ fontSize: '0.7rem', bgcolor: 'action.selected', flexShrink: 0 }}
              />
            )}
            <Chip
              label={panel.preset.group}
              size="small"
              sx={{
                fontSize: '0.6rem',
                bgcolor: groupColor,
                color: '#fff',
                fontWeight: 600,
                flexShrink: 0,
              }}
            />
            <Box flex={1} />
            <IconButton
              size="small"
              aria-label="Remove chart panel"
              onClick={e => {
                e.stopPropagation();
                removePanel(panel.id);
              }}
              onMouseDown={e => e.stopPropagation()}
              sx={{ p: 0.25, flexShrink: 0 }}
            >
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Box>
          {panel.loading && (
            <Typography variant="body2" color="text.secondary">
              Loading...
            </Typography>
          )}
          {panel.error && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              {panel.error}
            </Alert>
          )}
          {panel.chartData.length > 0 && !panel.loading && (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={panel.chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: columns > 1 ? 9 : 11 }} />
                <YAxis tick={{ fontSize: columns > 1 ? 9 : 11 }} />
                <RechartsTooltip content={<CustomTooltip />} />
                {columns === 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {panel.seriesKeys.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={COLORS[i % COLORS.length]}
                    name={key}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
          {panel.chartData.length === 0 && !panel.loading && !panel.error && (
            <Typography variant="body2" color="text.secondary">
              No data available.
            </Typography>
          )}
        </CardContent>
      </Card>
    );
  };

  const dropLine = (
    <Box
      sx={{ height: 3, bgcolor: '#66bb6a', borderRadius: 1, mx: 0.5, transition: 'opacity 0.1s' }}
    />
  );

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={2}
      sx={{ overflow: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }}
    >
      {/* Toolbar */}
      <Box display="flex" gap={1} alignItems="center" flexShrink={0} flexWrap="wrap">
        <Autocomplete
          sx={{ flex: '1 1 50%', minWidth: 250, maxWidth: '50%' }}
          options={sortedPresets}
          groupBy={opt => opt.group}
          getOptionLabel={opt => opt.label}
          value={null}
          inputValue={inputValue}
          onInputChange={(_, newValue, reason) => {
            if (reason === 'reset') setInputValue('');
            else setInputValue(newValue);
          }}
          onChange={(_, value) => {
            if (value) {
              addPanel(value);
              setInputValue('');
            }
          }}
          blurOnSelect
          clearOnBlur
          renderOption={(props, opt) => (
            <li {...props} key={opt.query}>
              <Box display="flex" justifyContent="space-between" width="100%" alignItems="center">
                <Typography variant="body2">{opt.label}</Typography>
                <Box display="flex" gap={0.5} alignItems="center">
                  <Chip
                    label={opt.group}
                    size="small"
                    sx={{
                      fontSize: '0.6rem',
                      height: 18,
                      bgcolor: GROUP_COLORS[opt.group] || '#757575',
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  />
                  <Chip
                    label={opt.unit}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem', height: 20 }}
                  />
                </Box>
              </Box>
            </li>
          )}
          renderInput={params => (
            <TextField
              {...params}
              size="small"
              placeholder="Add a metric..."
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <Icon
                      icon="mdi:chart-line"
                      width={18}
                      style={{ marginRight: 8, opacity: 0.5 }}
                    />
                    {params.InputProps.startAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <FormControl size="small" sx={{ ml: 'auto' }}>
          <Select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="5m">5 min</MenuItem>
            <MenuItem value="15m">15 min</MenuItem>
            <MenuItem value="30m">30 min</MenuItem>
            <MenuItem value="1h">1 hour</MenuItem>
            <MenuItem value="3h">3 hours</MenuItem>
            <MenuItem value="6h">6 hours</MenuItem>
            <MenuItem value="12h">12 hours</MenuItem>
            <MenuItem value="24h">24 hours</MenuItem>
          </Select>
        </FormControl>
        <ToggleButtonGroup
          value={columns}
          exclusive
          onChange={(_, v) => {
            if (v !== null) setColumns(v);
          }}
          size="small"
          sx={{ flexShrink: 0 }}
        >
          <ToggleButton value={1} sx={{ px: 1, py: 0.5 }}>
            <Tooltip title="1 column" arrow>
              <Box display="flex">
                <Icon icon="mdi:view-sequential" width={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value={2} sx={{ px: 1, py: 0.5 }}>
            <Tooltip title="2 columns" arrow>
              <Box display="flex">
                <Icon icon="mdi:view-grid" width={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value={3} sx={{ px: 1, py: 0.5 }}>
            <Tooltip title="3 columns" arrow>
              <Box display="flex">
                <Icon icon="mdi:view-module" width={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Columns */}
      {panels.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          {colArrays.map((colPanels, colIdx) => (
            <Box
              key={colIdx}
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                minHeight: 100,
                borderRadius: 1,
                border:
                  dropIndicator?.col === colIdx && colPanels.length === 0
                    ? '2px dashed'
                    : '2px dashed transparent',
                borderColor:
                  dropIndicator?.col === colIdx && colPanels.length === 0
                    ? 'divider'
                    : 'transparent',
                p: dropIndicator?.col === colIdx && colPanels.length === 0 ? 1 : 0,
                transition: 'border-color 0.15s',
              }}
              onDragOver={e => handleColumnDragOver(e, colIdx)}
              onDragLeave={handleColumnDragLeave}
              onDrop={e => handleDrop(e, colIdx)}
            >
              {colPanels.length === 0 && dropIndicator?.col === colIdx && dropLine}
              {colPanels.map((panel, idx) => (
                <React.Fragment key={panel.id}>
                  {dropIndicator?.col === colIdx && dropIndicator.index === idx && dropLine}
                  {renderCard(panel, colPanels)}
                </React.Fragment>
              ))}
              {dropIndicator?.col === colIdx &&
                dropIndicator.index === colPanels.length &&
                colPanels.length > 0 &&
                dropLine}
            </Box>
          ))}
        </Box>
      )}

      {panels.length === 0 && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, minHeight: 0 }}
        >
          <Box sx={{ maxWidth: 560, textAlign: 'center' }}>
            <Icon icon="mdi:chart-line" width={56} style={{ opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
              Prometheus Querier
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
              Query KubeVirt metrics directly from Prometheus. Select pre-built metrics from the
              dropdown above to visualize CPU, memory, network, storage, and migration activity for
              this VM in real time.
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1.5,
                mt: 2.5,
                textAlign: 'left',
              }}
            >
              {[
                {
                  icon: 'mdi:menu-down',
                  text: 'Pick metrics from the dropdown — grouped by category',
                },
                {
                  icon: 'mdi:chart-multiple',
                  text: 'Add multiple charts side by side (1–3 columns)',
                },
                { icon: 'mdi:drag', text: 'Drag & drop to reorder charts between columns' },
                { icon: 'mdi:clock-outline', text: 'Adjust time range: 5m to 24h' },
                { icon: 'mdi:refresh', text: 'Auto-refresh every 30 seconds' },
                {
                  icon: 'mdi:database-search',
                  text: 'Pre-built PromQL — CPU, memory, network, storage, migration',
                },
              ].map((hint, i) => (
                <Box
                  key={i}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75 }}
                >
                  <Icon icon={hint.icon} width={18} style={{ opacity: 0.6, flexShrink: 0 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem' }}>
                    {hint.text}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
              Select a metric from the dropdown above to get started.
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}
