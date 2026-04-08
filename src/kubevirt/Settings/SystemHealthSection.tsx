import { Icon } from '@iconify/react';
import ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  FormControl,
  Grid,
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
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { discoverPrometheus } from '../../utils/prometheus';
import { sanitizePromQL } from '../../utils/sanitize';

type ChartDataPoint = { time: string; [key: string]: string | number };
type SingleDataPoint = { time: string; value: number };

type HealthChartsState = {
  restErrors: ChartDataPoint[];
  apiLatency: ChartDataPoint[];
  vmiPhaseTransitions: ChartDataPoint[];
  outdatedVMs: SingleDataPoint[];
  vcpuWait: SingleDataPoint[];
  storagePending: SingleDataPoint[];
};

type HealthComponent = {
  name: string;
  up: boolean;
  restErrors: number;
};

type RangeResult = {
  metric: Record<string, string>;
  values: Array<[number, string]>;
};

interface SystemHealthSectionProps {
  kubevirtNamespace: string;
}

const SystemHealthSection = React.memo(function SystemHealthSection({
  kubevirtNamespace,
}: SystemHealthSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [healthTimeRange, setHealthTimeRange] = useState('1h');
  const [healthPromAvailable, setHealthPromAvailable] = useState<boolean | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, Set<string>>>({});
  const [healthComponents, setHealthComponents] = useState<HealthComponent[]>([]);
  const [healthCharts, setHealthCharts] = useState<HealthChartsState>({
    restErrors: [],
    apiLatency: [],
    vmiPhaseTransitions: [],
    outdatedVMs: [],
    vcpuWait: [],
    storagePending: [],
  });

  const toggleSeries = (chartId: string, seriesName: string) => {
    setHiddenSeries(prev => {
      const current = new Set(prev[chartId] || []);
      if (current.has(seriesName)) {
        current.delete(seriesName);
      } else {
        current.add(seriesName);
      }
      return { ...prev, [chartId]: current };
    });
  };

  const isSeriesHidden = (chartId: string, seriesName: string) =>
    hiddenSeries[chartId]?.has(seriesName) ?? false;

  // Fetch system health chart data from Prometheus
  useEffect(() => {
    if (!expanded) return;

    const getTimeRangeSeconds = (range: string): number => {
      const value = parseInt(range);
      const unit = range.slice(-1);
      const multipliers: Record<string, number> = { m: 60, h: 3600, d: 86400 };
      return value * (multipliers[unit] || 60);
    };

    const fetchHealthCharts = async () => {
      try {
        // Find Prometheus service
        const prom = await discoverPrometheus();
        setHealthPromAvailable(prom.available);
        if (!prom.available) return;

        const promBase = prom.baseUrl;

        const now = Math.floor(Date.now() / 1000);
        const rangeSeconds = getTimeRangeSeconds(healthTimeRange);
        const start = now - rangeSeconds;
        const step = Math.max(Math.floor(rangeSeconds / 60), 15);

        const queryRange = async (query: string): Promise<RangeResult[]> => {
          const resp = await ApiProxy.request(
            `${promBase}/api/v1/query_range?query=${encodeURIComponent(
              query
            )}&start=${start}&end=${now}&step=${step}`
          ).catch(() => null);
          return resp?.data?.result || [];
        };

        const queryInstant = async (query: string) => {
          const resp = await ApiProxy.request(
            `${promBase}/api/v1/query?query=${encodeURIComponent(query)}`
          ).catch(() => null);
          return resp?.data?.result || [];
        };

        // Fetch component status (instant queries)
        const [compUp, compErrors] = await Promise.all([
          queryInstant(`up{namespace="${sanitizePromQL(kubevirtNamespace)}"}`),
          queryInstant(`sum by (pod) (kubevirt_rest_client_requests_total{code=~"4..|5.."})`),
        ]);

        const componentNames = ['virt-api', 'virt-controller', 'virt-handler', 'virt-operator'];
        setHealthComponents(
          componentNames.map(name => {
            // Check if at least one pod for this component is up
            const upEntries = compUp.filter((r: { metric: Record<string, string> }) =>
              r.metric.pod?.startsWith(name)
            );
            const isUp = upEntries.some(
              (r: { value: [number, string] }) => parseFloat(r.value[1]) === 1
            );
            // Sum errors across all pods for this component
            const errEntries = compErrors.filter((r: { metric: Record<string, string> }) =>
              r.metric.pod?.startsWith(name)
            );
            const totalErrors = errEntries.reduce(
              (sum: number, r: { value: [number, string] }) => sum + parseFloat(r.value[1]),
              0
            );
            return {
              name,
              up: isUp,
              restErrors: totalErrors,
            };
          })
        );

        // Fetch all charts in parallel
        const [
          restErrorsData,
          apiLatencyData,
          vmiTransitionsData,
          outdatedData,
          vcpuWaitData,
          storagePendingData,
        ] = await Promise.all([
          queryRange(
            `sum by (container) (increase(kubevirt_rest_client_requests_total{code=~"4..|5.."}[5m]))`
          ),
          queryRange(
            `histogram_quantile(0.99, sum by (le, verb) (rate(kubevirt_rest_client_request_latency_seconds_bucket[5m])))`
          ),
          queryRange(
            `sum by (phase) (rate(kubevirt_vmi_phase_transition_time_from_creation_seconds_count[5m]))`
          ),
          queryRange(`kubevirt_vmi_outdated_count or vector(0)`),
          queryRange(`sum(rate(kubevirt_vmi_vcpu_wait_seconds_total[5m]))`),
          queryRange(`sum(kubevirt_vmi_migration_data_remaining_bytes) or vector(0)`),
        ]);

        // Parse REST errors (multi-series by container/component)
        const restErrors: ChartDataPoint[] = [];
        const restTimestamps = new Set<number>();
        restErrorsData.forEach(series => {
          series.values.forEach(([ts]) => restTimestamps.add(ts));
        });
        Array.from(restTimestamps)
          .sort()
          .forEach(ts => {
            const point: ChartDataPoint = {
              time: new Date(ts * 1000).toLocaleTimeString(),
            };
            restErrorsData.forEach(series => {
              const label = series.metric.container || 'unknown';
              const val = series.values.find(([t]) => t === ts);
              point[label] = val ? parseFloat(parseFloat(val[1]).toFixed(2)) : 0;
            });
            restErrors.push(point);
          });

        // Parse API latency (multi-series by verb, filter out "none")
        const filteredLatencyData = apiLatencyData.filter(
          series => series.metric.verb && series.metric.verb !== 'none'
        );
        const apiLatency: ChartDataPoint[] = [];
        const latencyTimestamps = new Set<number>();
        filteredLatencyData.forEach(series => {
          series.values.forEach(([ts]) => latencyTimestamps.add(ts));
        });
        Array.from(latencyTimestamps)
          .sort()
          .forEach(ts => {
            const point: ChartDataPoint = {
              time: new Date(ts * 1000).toLocaleTimeString(),
            };
            filteredLatencyData.forEach(series => {
              const label = series.metric.verb || 'unknown';
              const val = series.values.find(([t]) => t === ts);
              const v = val ? parseFloat(val[1]) : 0;
              point[label] = isFinite(v) ? parseFloat((v * 1000).toFixed(2)) : 0; // convert to ms
            });
            apiLatency.push(point);
          });

        // Parse VMI phase transitions (multi-series by phase)
        const vmiPhaseTransitions: ChartDataPoint[] = [];
        const phaseTimestamps = new Set<number>();
        vmiTransitionsData.forEach(series => {
          series.values.forEach(([ts]) => phaseTimestamps.add(ts));
        });
        Array.from(phaseTimestamps)
          .sort()
          .forEach(ts => {
            const point: ChartDataPoint = {
              time: new Date(ts * 1000).toLocaleTimeString(),
            };
            vmiTransitionsData.forEach(series => {
              const label = series.metric.phase || 'unknown';
              const val = series.values.find(([t]) => t === ts);
              point[label] = val ? parseFloat(parseFloat(val[1]).toFixed(4)) : 0;
            });
            vmiPhaseTransitions.push(point);
          });

        // Parse simple single-series
        const parseSingle = (data: RangeResult[]) =>
          (data[0]?.values || []).map(([ts, val]: [number, string]) => ({
            time: new Date(ts * 1000).toLocaleTimeString(),
            value: parseFloat(parseFloat(val).toFixed(4)),
          }));

        setHealthCharts({
          restErrors,
          apiLatency,
          vmiPhaseTransitions,
          outdatedVMs: parseSingle(outdatedData),
          vcpuWait: parseSingle(vcpuWaitData),
          storagePending: parseSingle(storagePendingData),
        });
      } catch (err) {
        console.error('Failed to fetch health charts:', err);
        setHealthPromAvailable(false);
      }
    };

    fetchHealthCharts();
    const interval = setInterval(fetchHealthCharts, 30000);
    return () => clearInterval(interval);
  }, [expanded, healthTimeRange]);

  return (
    <Box
      mt={3}
      sx={{
        backgroundColor: 'rgba(76, 175, 80, 0.05)',
        borderRadius: '4px',
        border: '1px solid rgba(76, 175, 80, 0.2)',
      }}
    >
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        p={2}
        sx={{ cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          icon="mdi:heart-pulse"
          width={28}
          height={28}
          style={{ color: expanded ? '#4caf50' : '#9e9e9e' }}
        />
        <Typography variant="h6" flex={1}>
          System Health
        </Typography>
        <Chip label="Requires Prometheus" size="small" variant="outlined" />
        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={24} />
      </Box>
      <Collapse in={expanded}>
        <Box p={2} pt={0}>
          {healthPromAvailable === null ? (
            <Box display="flex" justifyContent="center" py={3}>
              <Typography variant="body2" color="text.secondary">
                Checking Prometheus availability...
              </Typography>
            </Box>
          ) : !healthPromAvailable ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                Prometheus is not available. Configure monitoring in{' '}
                <strong>General Configuration &rarr; Prometheus Monitoring</strong> to enable system
                health metrics.
              </Typography>
            </Alert>
          ) : (
            <>
              {/* Component Status */}
              {healthComponents.length > 0 && (
                <Grid container spacing={1.5} mb={2}>
                  {healthComponents.map(comp => (
                    <Grid item xs={6} sm={3} key={comp.name}>
                      <Box
                        sx={{
                          p: 1.5,
                          borderRadius: 1,
                          bgcolor: comp.up ? 'rgba(76, 175, 80, 0.08)' : 'rgba(244, 67, 54, 0.08)',
                          border: 1,
                          borderColor: comp.up
                            ? 'rgba(76, 175, 80, 0.3)'
                            : 'rgba(244, 67, 54, 0.3)',
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1}>
                          <Icon
                            icon={comp.up ? 'mdi:check-circle' : 'mdi:close-circle'}
                            width={18}
                            height={18}
                            color={comp.up ? '#4caf50' : '#f44336'}
                          />
                          <Typography variant="body2" fontWeight={600}>
                            {comp.name}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* Time range selector */}
              <Box display="flex" justifyContent="flex-end" mb={2}>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <Select
                    value={healthTimeRange}
                    onChange={e => setHealthTimeRange(e.target.value)}
                  >
                    <MenuItem value="30m">Last 30 minutes</MenuItem>
                    <MenuItem value="1h">Last hour</MenuItem>
                    <MenuItem value="6h">Last 6 hours</MenuItem>
                    <MenuItem value="12h">Last 12 hours</MenuItem>
                    <MenuItem value="1d">Last day</MenuItem>
                    <MenuItem value="7d">Last 7 days</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Grid container spacing={2}>
                {/* REST Client Errors */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:lan-disconnect" width={20} color="#f44336" />
                        <Typography variant="body2" fontWeight={600}>
                          REST Client Errors by Component
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        4xx/5xx HTTP responses per 5-min window, by KubeVirt component. Spikes
                        indicate API issues — check pod logs for details.
                      </Typography>
                      {healthCharts.restErrors.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.restErrors}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                              formatter={(value: number, name: string) => [
                                `${value.toFixed(1)} errors`,
                                name,
                              ]}
                            />
                            <Legend
                              onClick={e => toggleSeries('restErrors', e.dataKey as string)}
                              formatter={(value: string) => (
                                <span
                                  style={{
                                    color: isSeriesHidden('restErrors', value) ? '#666' : undefined,
                                    textDecoration: isSeriesHidden('restErrors', value)
                                      ? 'line-through'
                                      : undefined,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {value}
                                </span>
                              )}
                            />
                            {Object.keys(healthCharts.restErrors[0] || {})
                              .filter(k => k !== 'time')
                              .map((key, i) => {
                                const compColors: Record<string, string> = {
                                  'virt-api': '#2196f3',
                                  'virt-controller': '#ff9800',
                                  'virt-handler': '#4caf50',
                                  'virt-operator': '#9c27b0',
                                };
                                return (
                                  <Line
                                    key={key}
                                    type="monotone"
                                    dataKey={key}
                                    stroke={
                                      compColors[key] ||
                                      ['#f44336', '#ff9800', '#2196f3', '#4caf50'][i % 4]
                                    }
                                    dot={false}
                                    strokeWidth={2}
                                    hide={isSeriesHidden('restErrors', key)}
                                  />
                                );
                              })}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No error data — all clear
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                {/* API Latency p99 */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:timer-outline" width={20} color="#ff9800" />
                        <Typography variant="body2" fontWeight={600}>
                          API Latency p99 (ms)
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        99th percentile REST client request latency by verb. High values indicate
                        API server performance degradation.
                      </Typography>
                      {healthCharts.apiLatency.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.apiLatency}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} unit="ms" />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                              formatter={(value: number, name: string) => [`${value} ms`, name]}
                            />
                            <Legend
                              onClick={e => toggleSeries('apiLatency', e.dataKey as string)}
                              formatter={(value: string) => (
                                <span
                                  style={{
                                    color: isSeriesHidden('apiLatency', value) ? '#666' : undefined,
                                    textDecoration: isSeriesHidden('apiLatency', value)
                                      ? 'line-through'
                                      : undefined,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {value}
                                </span>
                              )}
                            />
                            {Object.keys(healthCharts.apiLatency[0] || {})
                              .filter(k => k !== 'time')
                              .map((key, i) => {
                                const verbColors: Record<string, string> = {
                                  GET: '#4caf50',
                                  LIST: '#2196f3',
                                  CREATE: '#ff9800',
                                  UPDATE: '#e040fb',
                                  PATCH: '#f44336',
                                  DELETE: '#00bcd4',
                                  WATCH: '#ffeb3b',
                                };
                                return (
                                  <Line
                                    key={key}
                                    type="monotone"
                                    dataKey={key}
                                    stroke={
                                      verbColors[key] ||
                                      [
                                        '#ff9800',
                                        '#2196f3',
                                        '#4caf50',
                                        '#9c27b0',
                                        '#f44336',
                                        '#00bcd4',
                                        '#e040fb',
                                      ][i % 7]
                                    }
                                    dot={false}
                                    strokeWidth={2}
                                    hide={isSeriesHidden('apiLatency', key)}
                                  />
                                );
                              })}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No latency data available
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                {/* VMI Phase Transitions */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:swap-horizontal" width={20} color="#2196f3" />
                        <Typography variant="body2" fontWeight={600}>
                          VMI Phase Transition Rate
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Rate of VMI phase transitions by target phase. Helps track scheduling and
                        lifecycle activity.
                      </Typography>
                      {healthCharts.vmiPhaseTransitions.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.vmiPhaseTransitions}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                            />
                            <Legend
                              onClick={e =>
                                toggleSeries('vmiPhaseTransitions', e.dataKey as string)
                              }
                              formatter={(value: string) => (
                                <span
                                  style={{
                                    color: isSeriesHidden('vmiPhaseTransitions', value)
                                      ? '#666'
                                      : undefined,
                                    textDecoration: isSeriesHidden('vmiPhaseTransitions', value)
                                      ? 'line-through'
                                      : undefined,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {value}
                                </span>
                              )}
                            />
                            {Object.keys(healthCharts.vmiPhaseTransitions[0] || {})
                              .filter(k => k !== 'time')
                              .map((key, i) => (
                                <Line
                                  key={key}
                                  type="monotone"
                                  dataKey={key}
                                  stroke={
                                    ['#4caf50', '#2196f3', '#ff9800', '#f44336', '#9c27b0'][i % 5]
                                  }
                                  dot={false}
                                  strokeWidth={2}
                                  hide={isSeriesHidden('vmiPhaseTransitions', key)}
                                />
                              ))}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No transition data
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                {/* vCPU Wait Time */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:timer-sand" width={20} color="#9c27b0" />
                        <Typography variant="body2" fontWeight={600}>
                          vCPU Wait Time (rate)
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Rate of time vCPUs spend waiting. High values indicate host CPU contention
                        or overcommitment.
                      </Typography>
                      {healthCharts.vcpuWait.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.vcpuWait}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} unit="s" />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                              formatter={(value: number, name: string) => [`${value} s`, name]}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#9c27b0"
                              dot={false}
                              strokeWidth={2}
                              name="vCPU wait"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No vCPU wait data
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                {/* Outdated VMs */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:update" width={20} color="#ff5722" />
                        <Typography variant="body2" fontWeight={600}>
                          Outdated VMIs
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Number of VMIs running with an outdated virt-launcher. These need a restart
                        to pick up the latest KubeVirt version.
                      </Typography>
                      {healthCharts.outdatedVMs.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.outdatedVMs}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#ff5722"
                              dot={false}
                              strokeWidth={2}
                              name="Outdated VMIs"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No outdated VM data
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                {/* Migration Data Remaining */}
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:transfer" width={20} color="#00bcd4" />
                        <Typography variant="body2" fontWeight={600}>
                          Migration Data Remaining
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Bytes remaining to transfer for active migrations. Persistently high values
                        may indicate bandwidth or convergence issues.
                      </Typography>
                      {healthCharts.storagePending.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={healthCharts.storagePending}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis
                              tick={{ fontSize: 10 }}
                              tickFormatter={v =>
                                v >= 1073741824
                                  ? `${(v / 1073741824).toFixed(1)}G`
                                  : v >= 1048576
                                  ? `${(v / 1048576).toFixed(1)}M`
                                  : v >= 1024
                                  ? `${(v / 1024).toFixed(1)}K`
                                  : `${v}B`
                              }
                            />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #444',
                                fontSize: '0.75rem',
                              }}
                              formatter={(v: number) => [
                                v >= 1073741824
                                  ? `${(v / 1073741824).toFixed(1)} GiB`
                                  : v >= 1048576
                                  ? `${(v / 1048576).toFixed(1)} MiB`
                                  : v >= 1024
                                  ? `${(v / 1024).toFixed(1)} KiB`
                                  : `${v} B`,
                              ]}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#00bcd4"
                              dot={false}
                              strokeWidth={2}
                              name="Remaining bytes"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box
                          height={200}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Typography variant="body2" color="text.secondary">
                            No active migrations
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
});

export default SystemHealthSection;
