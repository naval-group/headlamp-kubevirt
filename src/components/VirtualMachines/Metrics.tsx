import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, CardContent, FormControl, MenuItem, Select, Typography } from '@mui/material';
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
import VirtualMachine from './VirtualMachine';

interface MetricsProps {
  vmName: string;
  namespace: string;
  vmiData?: Record<string, any> | null;
  vmItem?: VirtualMachine | null;
}

interface TimeSeriesData {
  time: string;
  value: number;
}

export default function VMMetrics({ vmName, namespace, vmiData, vmItem }: MetricsProps) {
  const [timeRange, setTimeRange] = useState<string>('30m');
  const [prometheusAvailable, setPrometheusAvailable] = useState(false);

  // Time series data for graphs
  const [cpuTimeSeries, setCpuTimeSeries] = useState<TimeSeriesData[]>([]);
  const [memoryTimeSeries, setMemoryTimeSeries] = useState<
    Array<{ time: string; used: number; total: number }>
  >([]);
  const [networkTimeSeries, setNetworkTimeSeries] = useState<
    Array<{ time: string; rx: number; tx: number }>
  >([]);
  const [storageTimeSeries, setStorageTimeSeries] = useState<
    Array<{ time: string; read: number; write: number }>
  >([]);

  // Current values for display
  const [cpuCurrent, setCpuCurrent] = useState<{ usage: number; total: number } | null>(null);
  const [memoryCurrent, setMemoryCurrent] = useState<{ used: number; total: number } | null>(null);
  const [networkCurrent, setNetworkCurrent] = useState<{ rx: number; tx: number } | null>(null);
  const [storageCurrent, setStorageCurrent] = useState<{ read: number; write: number } | null>(
    null
  );

  // Convert time range to seconds for Prometheus query_range
  const getTimeRangeSeconds = (range: string): number => {
    const value = parseInt(range);
    const unit = range.slice(-1);
    const multipliers: { [key: string]: number } = { m: 60, h: 3600 };
    return value * (multipliers[unit] || 60);
  };

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Find Prometheus service dynamically
        const svcResp = (await ApiProxy.request('/api/v1/services').catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const svcItems = (svcResp?.items || []) as Array<Record<string, unknown>>;
        const promSvc = svcItems.find(svc => {
          const meta = svc.metadata as Record<string, unknown> | undefined;
          const spec = svc.spec as Record<string, unknown> | undefined;
          const name = (meta?.name as string) || '';
          const ports = (spec?.ports || []) as Array<{ port: number }>;
          return name.includes('prometheus') && ports.some(p => p.port === 9090);
        });

        if (!promSvc) {
          setPrometheusAvailable(false);
          return;
        }

        const promMeta = promSvc.metadata as Record<string, unknown>;
        const promBaseUrl = `/api/v1/namespaces/${promMeta.namespace}/services/${promMeta.name}:9090/proxy`;

        // Verify Prometheus is actually reachable
        const healthCheck = await ApiProxy.request(`${promBaseUrl}/api/v1/query?query=up`).catch(
          () => null
        );
        if (!healthCheck?.data) {
          setPrometheusAvailable(false);
          return;
        }

        setPrometheusAvailable(true);

        const now = Math.floor(Date.now() / 1000);
        const rangeSeconds = getTimeRangeSeconds(timeRange);
        const start = now - rangeSeconds;
        const step = Math.max(Math.floor(rangeSeconds / 60), 15); // Max 60 data points, min 15s step

        // Fetch CPU time series and current value
        const cpuQuery = `rate(kubevirt_vmi_cpu_usage_seconds_total{name="${vmName}",namespace="${namespace}"}[5m]) * 100`;
        const cpuRangeResp = await ApiProxy.request(
          `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
            cpuQuery
          )}&start=${start}&end=${now}&step=${step}`
        ).catch(() => null);

        if (cpuRangeResp?.data?.result?.[0]) {
          const values = cpuRangeResp.data.result[0].values || [];
          const formatted = values.map(([timestamp, value]: [number, string]) => ({
            time: new Date(timestamp * 1000).toLocaleTimeString(),
            value: parseFloat(value),
          }));
          setCpuTimeSeries(formatted);

          // Set current value from last point
          if (formatted.length > 0) {
            const lastValue = formatted[formatted.length - 1].value;

            // Calculate total vCPUs from topology (same logic as top section)
            let vCpuCount = 1; // Default to 1 vCPU

            // Try runtime topology first (from VMI)
            const vmiStatus = vmiData?.status as Record<string, unknown> | undefined;
            const currentCPUTopology = vmiStatus?.currentCPUTopology as
              | { sockets: number; cores: number; threads: number }
              | undefined;
            if (currentCPUTopology) {
              vCpuCount =
                (currentCPUTopology.sockets || 1) *
                (currentCPUTopology.cores || 1) *
                (currentCPUTopology.threads || 1);
            }
            // Fall back to configured topology (from VM spec)
            else {
              const vmSpec = vmItem?.spec as Record<string, unknown> | undefined;
              const vmTemplate = vmSpec?.template as Record<string, unknown> | undefined;
              const vmTemplateSpec = vmTemplate?.spec as Record<string, unknown> | undefined;
              const vmDomain = vmTemplateSpec?.domain as Record<string, unknown> | undefined;
              const cpu = vmDomain?.cpu as
                | { sockets?: number; cores?: number; threads?: number }
                | undefined;
              if (cpu) {
                vCpuCount = (cpu.sockets || 1) * (cpu.cores || 1) * (cpu.threads || 1);
              }
              // else: No CPU topology found, using default
            }

            setCpuCurrent({ usage: lastValue, total: vCpuCount });
          }
        }

        // Fetch Memory time series
        const memUsedQuery = `(kubevirt_vmi_memory_domain_bytes{name="${vmName}",namespace="${namespace}"} - on(name, exported_namespace) kubevirt_vmi_memory_available_bytes{name="${vmName}",namespace="${namespace}"}) / (1024^3)`;
        const memTotalQuery = `kubevirt_vmi_memory_domain_bytes{name="${vmName}",namespace="${namespace}"} / (1024^3)`;

        const [memUsedResp, memTotalResp] = await Promise.all([
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              memUsedQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              memTotalQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
        ]);

        if (memUsedResp?.data?.result?.[0] && memTotalResp?.data?.result?.[0]) {
          const usedValues = memUsedResp.data.result[0].values || [];
          const totalValues = memTotalResp.data.result[0].values || [];

          const formatted = usedValues.map(
            ([timestamp, usedValue]: [number, string], idx: number) => ({
              time: new Date(timestamp * 1000).toLocaleTimeString(),
              used: parseFloat(usedValue),
              total: totalValues[idx] ? parseFloat(totalValues[idx][1]) : 0,
            })
          );
          setMemoryTimeSeries(formatted);

          if (formatted.length > 0) {
            const last = formatted[formatted.length - 1];
            setMemoryCurrent({ used: last.used, total: last.total });
          }
        }

        // Fetch Network time series
        const networkRxQuery = `sum(rate(kubevirt_vmi_network_receive_bytes_total{name="${vmName}",namespace="${namespace}"}[5m])) / 1024`;
        const networkTxQuery = `sum(rate(kubevirt_vmi_network_transmit_bytes_total{name="${vmName}",namespace="${namespace}"}[5m])) / 1024`;

        const [rxResp, txResp] = await Promise.all([
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              networkRxQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              networkTxQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
        ]);

        if (rxResp?.data?.result?.[0] && txResp?.data?.result?.[0]) {
          const rxValues = rxResp.data.result[0].values || [];
          const txValues = txResp.data.result[0].values || [];

          const formatted = rxValues.map(([timestamp, rxValue]: [number, string], idx: number) => ({
            time: new Date(timestamp * 1000).toLocaleTimeString(),
            rx: parseFloat(rxValue),
            tx: txValues[idx] ? parseFloat(txValues[idx][1]) : 0,
          }));
          setNetworkTimeSeries(formatted);

          if (formatted.length > 0) {
            const last = formatted[formatted.length - 1];
            setNetworkCurrent({ rx: last.rx, tx: last.tx });
          }
        }

        // Fetch Storage time series
        const storageReadQuery = `sum(rate(kubevirt_vmi_storage_read_traffic_bytes_total{name="${vmName}",namespace="${namespace}"}[5m])) / 1024`;
        const storageWriteQuery = `sum(rate(kubevirt_vmi_storage_write_traffic_bytes_total{name="${vmName}",namespace="${namespace}"}[5m])) / 1024`;

        const [readResp, writeResp] = await Promise.all([
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              storageReadQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
          ApiProxy.request(
            `${promBaseUrl}/api/v1/query_range?query=${encodeURIComponent(
              storageWriteQuery
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null),
        ]);

        if (readResp?.data?.result?.[0] && writeResp?.data?.result?.[0]) {
          const readValues = readResp.data.result[0].values || [];
          const writeValues = writeResp.data.result[0].values || [];

          const formatted = readValues.map(
            ([timestamp, readValue]: [number, string], idx: number) => ({
              time: new Date(timestamp * 1000).toLocaleTimeString(),
              read: parseFloat(readValue),
              write: writeValues[idx] ? parseFloat(writeValues[idx][1]) : 0,
            })
          );
          setStorageTimeSeries(formatted);

          if (formatted.length > 0) {
            const last = formatted[formatted.length - 1];
            setStorageCurrent({ read: last.read, write: last.write });
          }
        }
      } catch (err) {
        setPrometheusAvailable(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [vmName, namespace, timeRange]);

  if (!prometheusAvailable) {
    return (
      <Box p={3}>
        <Typography variant="body1" color="text.secondary">
          Prometheus is not available. Install Prometheus to view VM metrics.
        </Typography>
      </Box>
    );
  }

  // Custom tooltip formatter to round to 2 decimals
  const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <Box sx={{ bgcolor: 'background.paper', p: 1, border: '1px solid #ccc', borderRadius: 1 }}>
          <Typography variant="caption" display="block">
            {label}
          </Typography>
          {payload.map((entry: ChartTooltipProps['payload'][number], index: number) => (
            <Typography key={index} variant="caption" display="block" sx={{ color: entry.color }}>
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
            </Typography>
          ))}
        </Box>
      );
    }
    return null;
  };

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" alignItems="center" mb={2}>
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
        {/* CPU Chart */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" color="#3e8635" fontWeight={600} mb={1}>
              CPU Usage
            </Typography>
            {cpuCurrent ? (
              <Typography variant="body2" color="text.secondary" mb={2}>
                Current: {cpuCurrent.usage.toFixed(1)}% of {cpuCurrent.total} vCPU
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" mb={2}>
                No data
              </Typography>
            )}
            {cpuTimeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cpuTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    domain={[0, 100]}
                    label={{ value: '%', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3e8635"
                    name="CPU %"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No chart data available
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Memory Chart */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" color="#2196f3" fontWeight={600} mb={1}>
              Memory Usage
            </Typography>
            {memoryCurrent ? (
              <Typography variant="body2" color="text.secondary" mb={2}>
                Current: {memoryCurrent.used.toFixed(1)} GiB / {memoryCurrent.total.toFixed(1)} GiB
                ({((memoryCurrent.used / memoryCurrent.total) * 100).toFixed(1)}%)
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" mb={2}>
                No data
              </Typography>
            )}
            {memoryTimeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={memoryTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    label={{ value: 'GiB', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="used"
                    stroke="#2196f3"
                    name="Used"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#cccccc"
                    name="Total"
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No chart data available
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Network Chart */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" color="#00acc1" fontWeight={600} mb={1}>
              Network Traffic
            </Typography>
            {networkCurrent ? (
              <Typography variant="body2" color="text.secondary" mb={2}>
                Current: ↓ {networkCurrent.rx.toFixed(1)} KB/s | ↑ {networkCurrent.tx.toFixed(1)}{' '}
                KB/s
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" mb={2}>
                No data
              </Typography>
            )}
            {networkTimeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={networkTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    label={{ value: 'KB/s', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="rx"
                    stroke="#3e8635"
                    name="Receive"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="tx"
                    stroke="#2196f3"
                    name="Transmit"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No chart data available
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Storage Chart */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" color="#f0ab00" fontWeight={600} mb={1}>
              Storage Throughput
            </Typography>
            {storageCurrent ? (
              <Typography variant="body2" color="text.secondary" mb={2}>
                Current: R {storageCurrent.read.toFixed(1)} KB/s | W{' '}
                {storageCurrent.write.toFixed(1)} KB/s
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" mb={2}>
                No data
              </Typography>
            )}
            {storageTimeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={storageTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    label={{ value: 'KB/s', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="read"
                    stroke="#3e8635"
                    name="Read"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="write"
                    stroke="#f0ab00"
                    name="Write"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No chart data available
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      <Box mt={3}>
        <Typography variant="caption" color="text.secondary">
          Metrics refresh every 30 seconds. Adjust the time range selector to view different
          historical periods.
        </Typography>
      </Box>
    </Box>
  );
}
