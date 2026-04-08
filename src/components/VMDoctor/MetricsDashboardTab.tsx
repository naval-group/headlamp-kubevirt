import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Card,
  CardContent,
  FormControl,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltipProps } from '../../types';
import { discoverPrometheus } from '../../utils/prometheus';
import { sanitizePromQL } from '../../utils/sanitize';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface MetricsDashboardTabProps {
  vmName: string;
  namespace: string;
  vmiData?: Record<string, any> | null;
  vmItem?: VirtualMachine | null;
}

interface TimeSeriesPoint {
  time: string;
  [key: string]: string | number;
}

const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <Box sx={{ bgcolor: 'background.paper', p: 1, border: '1px solid #ccc', borderRadius: 1 }}>
        <Typography variant="caption" display="block">
          {label}
        </Typography>
        {payload.map((entry: ChartTooltipProps['payload'][number], idx: number) => (
          <Typography key={idx} variant="caption" display="block" sx={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
          </Typography>
        ))}
      </Box>
    );
  }
  return null;
};

export default function MetricsDashboardTab({
  vmName,
  namespace,
  vmiData,
  vmItem,
}: MetricsDashboardTabProps) {
  const [timeRange, setTimeRange] = useState('1h');
  const [prometheusAvailable, setPrometheusAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  // All metrics time series
  const [cpuData, setCpuData] = useState<TimeSeriesPoint[]>([]);
  const [memoryData, setMemoryData] = useState<TimeSeriesPoint[]>([]);
  const [networkData, setNetworkData] = useState<TimeSeriesPoint[]>([]);
  const [storageData, setStorageData] = useState<TimeSeriesPoint[]>([]);
  const [iopsData, setIopsData] = useState<TimeSeriesPoint[]>([]);
  const [swapData, setSwapData] = useState<TimeSeriesPoint[]>([]);
  const [netErrorData, setNetErrorData] = useState<TimeSeriesPoint[]>([]);
  const [netPacketData, setNetPacketData] = useState<TimeSeriesPoint[]>([]);

  const getTimeRangeSeconds = (range: string): number => {
    const value = parseInt(range);
    const unit = range.slice(-1);
    const multipliers: Record<string, number> = { m: 60, h: 3600 };
    return value * (multipliers[unit] || 60);
  };

  useEffect(() => {
    if (!vmName || !namespace) return;
    const safeVmName = sanitizePromQL(vmName);
    const safeNs = sanitizePromQL(namespace);
    let cancelled = false;

    const fetchMetrics = async () => {
      try {
        // Find Prometheus
        const prom = await discoverPrometheus();
        if (!cancelled) setPrometheusAvailable(prom.available);
        if (!prom.available) {
          if (!cancelled) setLoading(false);
          return;
        }

        const promBaseUrl = prom.baseUrl;

        const now = Math.floor(Date.now() / 1000);
        const rangeSeconds = getTimeRangeSeconds(timeRange);
        const start = now - rangeSeconds;
        const step = Math.max(Math.floor(rangeSeconds / 60), 15);

        // vCPU count
        let vCpuCount = 1;
        const currentTopology = vmiData?.status?.currentCPUTopology;
        if (currentTopology) {
          vCpuCount =
            (currentTopology.sockets || 1) *
            (currentTopology.cores || 1) *
            (currentTopology.threads || 1);
        } else {
          const cpu = vmItem?.spec?.template?.spec?.domain?.cpu;
          if (cpu) vCpuCount = (cpu.sockets || 1) * (cpu.cores || 1) * (cpu.threads || 1);
        }

        const queryRange = async (query: string) => {
          const resp = await ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              query
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null);
          return resp?.data?.result?.[0]?.values || [];
        };

        const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

        // Fire all queries in parallel
        const [
          cpuValues,
          memDomainValues,
          memUsableValues,
          netRxValues,
          netTxValues,
          storReadValues,
          storWriteValues,
          iopsReadValues,
          iopsWriteValues,
          swapInValues,
          swapOutValues,
          netRxErrValues,
          netTxErrValues,
          netRxPktValues,
          netTxPktValues,
        ] = await Promise.all([
          queryRange(
            `sum(rate(kubevirt_vmi_vcpu_seconds_total{name="${safeVmName}",namespace="${safeNs}",state="running"}[5m])) / ${vCpuCount} * 100`
          ),
          queryRange(
            `kubevirt_vmi_memory_available_bytes{name="${safeVmName}",namespace="${safeNs}"} / (1024*1024*1024)`
          ),
          queryRange(
            `kubevirt_vmi_memory_usable_bytes{name="${safeVmName}",namespace="${safeNs}"} / (1024*1024*1024)`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_receive_bytes_total{name="${safeVmName}",namespace="${safeNs}"}[5m])) / 1024`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_transmit_bytes_total{name="${safeVmName}",namespace="${safeNs}"}[5m])) / 1024`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_storage_read_traffic_bytes_total{name="${safeVmName}",namespace="${safeNs}"}[5m])) / 1024`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_storage_write_traffic_bytes_total{name="${safeVmName}",namespace="${safeNs}"}[5m])) / 1024`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_storage_iops_read_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_storage_iops_write_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
          queryRange(
            `rate(kubevirt_vmi_memory_swap_in_traffic_bytes{name="${safeVmName}",namespace="${safeNs}"}[5m]) / 1024`
          ),
          queryRange(
            `rate(kubevirt_vmi_memory_swap_out_traffic_bytes{name="${safeVmName}",namespace="${safeNs}"}[5m]) / 1024`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_receive_errors_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_transmit_errors_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_receive_packets_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
          queryRange(
            `sum(rate(kubevirt_vmi_network_transmit_packets_total{name="${safeVmName}",namespace="${safeNs}"}[5m]))`
          ),
        ]);

        if (cancelled) return;

        // Helper to merge two time series by timestamp
        const mergeSeries = (
          aValues: Array<[number, string]>,
          bValues: Array<[number, string]>,
          aKey: string,
          bKey: string
        ): TimeSeriesPoint[] => {
          const bMap = new Map<number, number>();
          bValues.forEach(([ts, v]: [number, string]) => bMap.set(ts, parseFloat(v)));
          // Use whichever series has data, preferring aValues timestamps
          const base = aValues.length > 0 ? aValues : bValues;
          if (base.length === 0) return [];
          if (base === bValues) {
            // Only B has data
            return bValues.map(([ts, v]: [number, string]) => ({
              time: formatTime(ts),
              [aKey]: 0,
              [bKey]: parseFloat(v),
            }));
          }
          return aValues.map(([ts, v]: [number, string]) => ({
            time: formatTime(ts),
            [aKey]: parseFloat(v),
            [bKey]: bMap.get(ts) ?? 0,
          }));
        };

        // CPU
        setCpuData(
          cpuValues.map(([ts, v]: [number, string]) => ({
            time: formatTime(ts),
            value: parseFloat(v),
          }))
        );

        // Memory
        const memMap = new Map<number, number>();
        memUsableValues.forEach(([ts, v]: [number, string]) => memMap.set(ts, parseFloat(v)));
        setMemoryData(
          memDomainValues.map(([ts, v]: [number, string]) => ({
            time: formatTime(ts),
            used: Math.max(0, parseFloat(v) - (memMap.get(ts) ?? 0)),
            total: parseFloat(v),
          }))
        );

        // Network throughput
        setNetworkData(mergeSeries(netRxValues, netTxValues, 'rx', 'tx'));

        // Storage throughput
        setStorageData(mergeSeries(storReadValues, storWriteValues, 'read', 'write'));

        // IOPS
        setIopsData(mergeSeries(iopsReadValues, iopsWriteValues, 'read', 'write'));

        // Swap
        setSwapData(mergeSeries(swapInValues, swapOutValues, 'swapIn', 'swapOut'));

        // Network errors
        setNetErrorData(mergeSeries(netRxErrValues, netTxErrValues, 'rxErrors', 'txErrors'));

        // Network packets
        setNetPacketData(mergeSeries(netRxPktValues, netTxPktValues, 'rxPackets', 'txPackets'));

        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setPrometheusAvailable(false);
          setLoading(false);
        }
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vmName, namespace, timeRange, vmiData, vmItem]);

  if (!prometheusAvailable && !loading) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:chart-line" />}>
        Prometheus not available. Install Prometheus to view VM metrics.
      </Alert>
    );
  }

  if (loading) {
    return <Typography color="text.secondary">Loading metrics...</Typography>;
  }

  const charts: Array<{
    title: string;
    color: string;
    icon: string;
    data: TimeSeriesPoint[];
    lines: Array<{ key: string; name: string; color: string; dash?: string }>;
    yLabel: string;
    yDomain?: [number, number];
  }> = [
    {
      title: 'CPU Usage',
      color: '#3e8635',
      icon: 'mdi:chip',
      data: cpuData,
      lines: [{ key: 'value', name: 'CPU %', color: '#3e8635' }],
      yLabel: '%',
      yDomain: [0, 100],
    },
    {
      title: 'Memory Usage',
      color: '#2196f3',
      icon: 'mdi:memory',
      data: memoryData,
      lines: [
        { key: 'used', name: 'Used', color: '#2196f3' },
        { key: 'total', name: 'Total', color: '#cccccc', dash: '5 5' },
      ],
      yLabel: 'GiB',
    },
    {
      title: 'Network Throughput',
      color: '#00acc1',
      icon: 'mdi:lan',
      data: networkData,
      lines: [
        { key: 'rx', name: 'Receive', color: '#3e8635' },
        { key: 'tx', name: 'Transmit', color: '#2196f3' },
      ],
      yLabel: 'KB/s',
    },
    {
      title: 'Storage Throughput',
      color: '#f0ab00',
      icon: 'mdi:harddisk',
      data: storageData,
      lines: [
        { key: 'read', name: 'Read', color: '#3e8635' },
        { key: 'write', name: 'Write', color: '#f0ab00' },
      ],
      yLabel: 'KB/s',
    },
    {
      title: 'Storage IOPS',
      color: '#9c27b0',
      icon: 'mdi:speedometer',
      data: iopsData,
      lines: [
        { key: 'read', name: 'Read IOPS', color: '#9c27b0' },
        { key: 'write', name: 'Write IOPS', color: '#f0ab00' },
      ],
      yLabel: 'ops/s',
    },
    {
      title: 'Swap Activity',
      color: '#c9190b',
      icon: 'mdi:swap-vertical',
      data: swapData,
      lines: [
        { key: 'swapIn', name: 'Swap In', color: '#c9190b' },
        { key: 'swapOut', name: 'Swap Out', color: '#f0ab00' },
      ],
      yLabel: 'KB/s',
    },
    {
      title: 'Network Packets',
      color: '#00acc1',
      icon: 'mdi:package-variant',
      data: netPacketData,
      lines: [
        { key: 'rxPackets', name: 'RX pkt/s', color: '#3e8635' },
        { key: 'txPackets', name: 'TX pkt/s', color: '#2196f3' },
      ],
      yLabel: 'pkt/s',
    },
    {
      title: 'Network Errors',
      color: '#c9190b',
      icon: 'mdi:alert-circle',
      data: netErrorData,
      lines: [
        { key: 'rxErrors', name: 'RX Errors', color: '#c9190b' },
        { key: 'txErrors', name: 'TX Errors', color: '#f0ab00' },
      ],
      yLabel: 'err/s',
    },
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <FormControl size="small">
          <Select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="5m">Last 5 minutes</MenuItem>
            <MenuItem value="15m">Last 15 minutes</MenuItem>
            <MenuItem value="30m">Last 30 minutes</MenuItem>
            <MenuItem value="1h">Last 1 hour</MenuItem>
            <MenuItem value="3h">Last 3 hours</MenuItem>
            <MenuItem value="6h">Last 6 hours</MenuItem>
            <MenuItem value="12h">Last 12 hours</MenuItem>
            <MenuItem value="24h">Last 24 hours</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        {charts.map(chart => (
          <Card key={chart.title} variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" color={chart.color} fontWeight={600} mb={1}>
                <Icon
                  icon={chart.icon}
                  width={16}
                  style={{ verticalAlign: 'middle', marginRight: 4 }}
                />
                {chart.title}
              </Typography>
              {chart.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chart.data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      domain={chart.yDomain}
                      label={{
                        value: chart.yLabel,
                        angle: -90,
                        position: 'insideLeft',
                        style: { fontSize: 11 },
                      }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chart.lines.map(line => (
                      <Line
                        key={line.key}
                        type="monotone"
                        dataKey={line.key}
                        stroke={line.color}
                        name={line.name}
                        dot={false}
                        strokeWidth={2}
                        strokeDasharray={line.dash}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No data
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box mt={2}>
        <Typography variant="caption" color="text.secondary">
          Metrics refresh every 30 seconds. All rates use a 5-minute window.
        </Typography>
      </Box>
    </Box>
  );
}
