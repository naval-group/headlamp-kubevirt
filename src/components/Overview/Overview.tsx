import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  FormControl,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { KubeListResponse, PrometheusQueryResult } from '../../types';
import { discoverPrometheus } from '../../utils/prometheus';
import VirtualMachineInstanceMigration from '../Migrations/VirtualMachineInstanceMigration';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

type PromResult = PrometheusQueryResult['data']['result'][number];

// VM Status Colors - consistent across donut chart and legend
const VM_STATUS_COLORS = {
  error: '#c9190b', // Red
  running: '#3e8635', // Green
  stopped: '#6a6e73', // Gray
  migrating: '#2196f3', // Blue
  paused: '#f0ab00', // Orange/Yellow
} as const;

export default function VirtualizationOverview() {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('30m');
  const [prometheusAvailable, setPrometheusAvailable] = useState(false);
  const [prometheusInstalled, setPrometheusInstalled] = useState(false);
  const [serviceMonitorConfigured, setServiceMonitorConfigured] = useState(false);
  const [topCpuConsumers, setTopCpuConsumers] = useState<
    Array<{ name: string; value: number; vcpus?: number }>
  >([]);
  const [topMemoryConsumers, setTopMemoryConsumers] = useState<
    Array<{ name: string; value: number; total?: number }>
  >([]);
  const [topMemorySwap, setTopMemorySwap] = useState<
    Array<{ name: string; inValue: number; outValue: number }>
  >([]);
  const [topNetworkTraffic, setTopNetworkTraffic] = useState<
    Array<{ name: string; rxValue: number; txValue: number }>
  >([]);
  const [topNetworkPackets, setTopNetworkPackets] = useState<
    Array<{ name: string; rxValue: number; txValue: number }>
  >([]);
  const [topNetworkErrors, setTopNetworkErrors] = useState<
    Array<{ name: string; errorsValue: number; dropsValue: number }>
  >([]);
  const [topStorageThroughput, setTopStorageThroughput] = useState<
    Array<{ name: string; readValue: number; writeValue: number }>
  >([]);
  const [topStorageIOPS, setTopStorageIOPS] = useState<
    Array<{ name: string; readValue: number; writeValue: number }>
  >([]);

  // Fetch namespaces
  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<{ metadata: { name: string } }>) => {
        const nsList =
          response?.items?.map((ns: { metadata: { name: string } }) => ns.metadata.name) || [];
        setNamespaces(['all', ...nsList]);
      })
      .catch(() => {});
  }, []);

  // Check if KubeVirt ServiceMonitor is configured
  React.useEffect(() => {
    ApiProxy.request('/apis/kubevirt.io/v1/kubevirts')
      .then(
        (resp: {
          items?: Array<{ spec?: { monitorNamespace?: string; monitorAccount?: string } }>;
        }) => {
          const kv = resp?.items?.[0];
          setServiceMonitorConfigured(!!kv?.spec?.monitorNamespace && !!kv?.spec?.monitorAccount);
        }
      )
      .catch(() => setServiceMonitorConfigured(false));
  }, []);

  // Check if Prometheus is available and fetch metrics
  React.useEffect(() => {
    const fetchPrometheusMetrics = async () => {
      try {
        // Find Prometheus service dynamically
        const prom = await discoverPrometheus();
        setPrometheusInstalled(prom.installed);
        setPrometheusAvailable(prom.available);
        if (!prom.available) return;

        const promBaseUrl = prom.baseUrl;

        // Build namespace filter — sanitize to prevent PromQL injection
        const sanitizedNs = selectedNamespace.replace(/[\\}"]/g, '');
        const nsFilter = selectedNamespace === 'all' ? '' : `namespace="${sanitizedNs}"`;

        const promQuery = (query: string) =>
          ApiProxy.request(`${promBaseUrl}/api/v1/query?query=${encodeURIComponent(query)}`).catch(
            () => null
          );

        // Phase 1: Fire all top-level queries in parallel
        const [
          cpuResp,
          memResp,
          swapInResp,
          swapOutResp,
          networkRxResp,
          networkTxResp,
          packetsRxResp,
          packetsTxResp,
          networkErrorsResp,
          networkDropsResp,
          throughputReadResp,
          throughputWriteResp,
          iopsReadResp,
          iopsWriteResp,
        ] = await Promise.all([
          promQuery(`topk(5, rate(kubevirt_vmi_cpu_usage_seconds_total{${nsFilter}}[5m]))`),
          promQuery(
            `topk(5, kubevirt_vmi_memory_available_bytes{${nsFilter}} - on(name, namespace) kubevirt_vmi_memory_usable_bytes{${nsFilter}})`
          ),
          promQuery(`topk(5, rate(kubevirt_vmi_memory_swap_in_traffic_bytes{${nsFilter}}[5m]))`),
          promQuery(`topk(5, rate(kubevirt_vmi_memory_swap_out_traffic_bytes{${nsFilter}}[5m]))`),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_receive_bytes_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_transmit_bytes_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_receive_packets_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_transmit_packets_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_receive_errors_total{${nsFilter}}[5m]) + rate(kubevirt_vmi_network_transmit_errors_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_network_receive_packets_dropped_total{${nsFilter}}[5m]) + rate(kubevirt_vmi_network_transmit_packets_dropped_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_storage_read_traffic_bytes_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_storage_write_traffic_bytes_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_storage_iops_read_total{${nsFilter}}[5m])))`
          ),
          promQuery(
            `topk(5, sum by (name, namespace) (rate(kubevirt_vmi_storage_iops_write_total{${nsFilter}}[5m])))`
          ),
        ]);

        // Phase 2: Secondary per-VM queries (vCPU counts, total memory) — also in parallel
        const cpuDataPromise = cpuResp?.data?.result
          ? Promise.all(
              cpuResp.data.result.map(async (r: PromResult) => {
                const vmName = r.metric.name || r.metric.vmi || 'Unknown';
                const cpuUsage = parseFloat(r.value[1]) || 0;
                const vcpuResp = await promQuery(
                  `kubevirt_vm_resource_requests{name="${vmName.replace(
                    /[\\}"]/g,
                    ''
                  )}",resource="cpu"}`
                );
                const vcpus = vcpuResp?.data?.result?.[0]?.value?.[1]
                  ? parseFloat(vcpuResp.data.result[0].value[1])
                  : undefined;
                return { name: vmName, value: cpuUsage, vcpus };
              })
            )
          : Promise.resolve([]);

        const memDataPromise = memResp?.data?.result
          ? Promise.all(
              memResp.data.result.map(async (r: PromResult) => {
                const vmName = r.metric.name || r.metric.vmi || 'Unknown';
                const usedMemory = parseFloat(r.value[1]) || 0;
                const totalResp = await promQuery(
                  `kubevirt_vmi_memory_available_bytes{name="${vmName.replace(/[\\}"]/g, '')}"}`
                );
                const total = totalResp?.data?.result?.[0]?.value?.[1]
                  ? parseFloat(totalResp.data.result[0].value[1])
                  : undefined;
                return { name: vmName, value: usedMemory, total };
              })
            )
          : Promise.resolve([]);

        const [cpuData, memData] = await Promise.all([cpuDataPromise, memDataPromise]);

        // Phase 3: Process all results and merge paired data
        const mergePair = <A extends string, B extends string>(
          respA: any,
          respB: any,
          keyA: A,
          keyB: B
        ): ({ name: string } & Record<A, number> & Record<B, number>)[] => {
          const map = new Map<string, Record<A | B, number>>();
          respA?.data?.result?.forEach((r: PromResult) => {
            const name = r.metric.name || r.metric.vmi || 'Unknown';
            map.set(name, { [keyA]: parseFloat(r.value[1]) || 0, [keyB]: 0 } as Record<
              A | B,
              number
            >);
          });
          respB?.data?.result?.forEach((r: PromResult) => {
            const name = r.metric.name || r.metric.vmi || 'Unknown';
            const existing = map.get(name) || ({ [keyA]: 0, [keyB]: 0 } as Record<A | B, number>);
            map.set(name, { ...existing, [keyB]: parseFloat(r.value[1]) || 0 } as Record<
              A | B,
              number
            >);
          });
          return Array.from(map.entries())
            .map(
              ([name, values]) =>
                ({ name, ...values } as { name: string } & Record<A, number> & Record<B, number>)
            )
            .slice(0, 5);
        };

        // Phase 4: Set all state at once — no staggered rendering
        setTopCpuConsumers(cpuData);
        setTopMemoryConsumers(memData);
        setTopMemorySwap(mergePair(swapInResp, swapOutResp, 'inValue', 'outValue'));
        setTopNetworkTraffic(mergePair(networkRxResp, networkTxResp, 'rxValue', 'txValue'));
        setTopNetworkPackets(mergePair(packetsRxResp, packetsTxResp, 'rxValue', 'txValue'));
        setTopNetworkErrors(
          mergePair(networkErrorsResp, networkDropsResp, 'errorsValue', 'dropsValue')
        );
        setTopStorageThroughput(
          mergePair(throughputReadResp, throughputWriteResp, 'readValue', 'writeValue')
        );
        setTopStorageIOPS(mergePair(iopsReadResp, iopsWriteResp, 'readValue', 'writeValue'));
      } catch (err) {
        setPrometheusAvailable(false);
      }
    };

    fetchPrometheusMetrics();
    const interval = setInterval(fetchPrometheusMetrics, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, [selectedNamespace, timeRange]);

  const { items: allVms } = VirtualMachine.useList();
  const { items: migrations } = VirtualMachineInstanceMigration.useList();

  // Filter VMs by namespace
  const vms = React.useMemo(() => {
    if (!allVms || !Array.isArray(allVms)) return [];
    if (selectedNamespace === 'all') return allVms;
    return allVms.filter(vm => vm.getNamespace() === selectedNamespace);
  }, [allVms, selectedNamespace]);

  const stats = React.useMemo(() => {
    if (!vms || !Array.isArray(vms)) {
      return { total: 0, running: 0, stopped: 0, error: 0, migrating: 0, paused: 0 };
    }

    const counts = { total: vms.length, running: 0, stopped: 0, error: 0, migrating: 0, paused: 0 };

    vms.forEach(vm => {
      try {
        const status = vm.status?.printableStatus?.toLowerCase();

        if (status === 'running') {
          counts.running++;
        } else if (status === 'stopped' || status === 'halted') {
          counts.stopped++;
        } else if (status === 'paused') {
          counts.paused++;
        } else if (status === 'migrating') {
          counts.migrating++;
        } else if (status?.includes('error') || status?.includes('failed')) {
          counts.error++;
        } else {
          counts.stopped++;
        }
      } catch (e) {
        counts.stopped++;
      }
    });

    return counts;
  }, [vms]);

  // eslint-disable-next-line no-unused-vars
  const activeMigrations = React.useMemo(() => {
    if (!migrations || !Array.isArray(migrations)) return 0;
    return migrations.filter(m => !m.isCompleted()).length;
  }, [migrations]);

  // Calculate total allocated resources from VM specs
  const totalResources = React.useMemo(() => {
    if (!vms || !Array.isArray(vms)) {
      return { cpu: 0, memory: 0, storage: 0 };
    }

    let totalCpu = 0;
    let totalMemory = 0;
    const totalStorage = 0;

    vms.forEach(vm => {
      try {
        const spec = vm.jsonData?.spec?.template?.spec;

        // CPU cores (cores * sockets * threads)
        const cpu = spec?.domain?.cpu;
        if (cpu) {
          const cores = cpu.cores || 1;
          const sockets = cpu.sockets || 1;
          const threads = cpu.threads || 1;
          totalCpu += cores * sockets * threads;
        }

        // Memory from domain.memory.guest
        const memStr = spec?.domain?.memory?.guest;
        if (memStr) {
          // Parse memory string (e.g., "2Gi", "512Mi", "4G")
          const memMatch = memStr.match(/^(\d+(?:\.\d+)?)([KMGT]i?)/);
          if (memMatch) {
            const value = parseFloat(memMatch[1]);
            const unit = memMatch[2];
            let bytes = value;
            if (unit === 'K' || unit === 'Ki') bytes *= 1024;
            else if (unit === 'M' || unit === 'Mi') bytes *= 1024 * 1024;
            else if (unit === 'G' || unit === 'Gi') bytes *= 1024 * 1024 * 1024;
            else if (unit === 'T' || unit === 'Ti') bytes *= 1024 * 1024 * 1024 * 1024;
            totalMemory += bytes;
          }
        }

        // Storage from volumes
        if (spec?.volumes) {
          spec.volumes.forEach(
            (vol: {
              dataVolume?: { name: string };
              persistentVolumeClaim?: { claimName: string };
            }) => {
              if (vol.dataVolume?.name || vol.persistentVolumeClaim?.claimName) {
                // Note: We'd need to fetch PVC/DV to get actual size
                // For now, we'll skip storage calculation as it requires additional API calls
              }
            }
          );
        }
      } catch (e) {
        console.warn('Failed to parse VM resources:', e);
      }
    });

    return {
      cpu: totalCpu,
      memory: totalMemory,
      storage: totalStorage,
    };
  }, [vms]);

  return (
    <Box sx={{ p: 2 }}>
      {/* Header with namespace filter */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">Virtualization</Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={selectedNamespace}
              onChange={e => setSelectedNamespace(e.target.value)}
              displayEmpty
            >
              <MenuItem value="all">All Namespaces</MenuItem>
              {namespaces
                .filter(ns => ns !== 'all')
                .map(ns => (
                  <MenuItem key={ns} value={ns}>
                    {ns}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select value={timeRange} onChange={e => setTimeRange(e.target.value)}>
              <MenuItem value="30m">Last 30 minutes</MenuItem>
              <MenuItem value="1h">Last hour</MenuItem>
              <MenuItem value="6h">Last 6 hours</MenuItem>
              <MenuItem value="12h">Last 12 hours</MenuItem>
              <MenuItem value="1d">Last day</MenuItem>
              <MenuItem value="7d">Last 7 days</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Alert for Prometheus - tiered messages based on state */}
      {stats.total > 0 && !prometheusAvailable && !prometheusInstalled && (
        <Alert severity="info" sx={{ mb: 3 }} icon={<Icon icon="mdi:chart-line" />}>
          <Typography variant="body2">
            <strong>Enable metrics:</strong> Install Prometheus to view CPU, Memory, and Storage
            usage charts for your VirtualMachines.
          </Typography>
        </Alert>
      )}
      {stats.total > 0 && prometheusInstalled && !serviceMonitorConfigured && (
        <Alert
          severity="warning"
          sx={{ mb: 3, '& .MuiAlert-message': { color: '#ffb74d' } }}
          icon={<Icon icon="mdi:monitor-eye" />}
        >
          <Typography variant="body2">
            <strong>Prometheus detected</strong> but KubeVirt metrics are not enabled. Go to{' '}
            <strong>Settings → General Configuration → Prometheus Monitoring</strong> to configure
            the ServiceMonitor and start collecting VM metrics.
          </Typography>
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Top Consumers - Full Width */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Top consumers
            </Typography>

            <Grid container spacing={2}>
              {/* CPU */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:cpu-64-bit" width={24} color="#3e8635" />
                      <Typography variant="subtitle2" sx={{ color: '#3e8635', fontWeight: 600 }}>
                        CPU
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topCpuConsumers.length > 0 ? (
                        topCpuConsumers.map((consumer, idx) => (
                          <Box key={idx} sx={{ mb: 1 }}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.5,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                              <Typography variant="caption" fontWeight="bold" sx={{ ml: 1 }}>
                                {(consumer.value * 100).toFixed(1)}%
                                {consumer.vcpus ? ` / ${consumer.vcpus} vCPU` : ''}
                              </Typography>
                            </Box>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(consumer.value * 100, 100)}
                              sx={{
                                height: 6,
                                borderRadius: 1,
                                bgcolor: 'rgba(62, 134, 53, 0.2)', // Dark green background
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: '#3e8635', // Green for CPU
                                },
                              }}
                            />
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No metrics available' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Network Traffic */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:network" width={24} color="#00acc1" />
                      <Typography variant="subtitle2" sx={{ color: '#00acc1', fontWeight: 600 }}>
                        Network traffic
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topNetworkTraffic.length > 0 ? (
                        topNetworkTraffic.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="success.main">
                                ↓ {(consumer.rxValue / 1024).toFixed(1)} KB/s
                              </Typography>
                              <Typography variant="caption" color="info.main">
                                ↑ {(consumer.txValue / 1024).toFixed(1)} KB/s
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No network activity' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Network Packets */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:package-variant" width={24} color="#00acc1" />
                      <Typography variant="subtitle2" sx={{ color: '#00acc1', fontWeight: 600 }}>
                        Network packets
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topNetworkPackets.length > 0 ? (
                        topNetworkPackets.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="success.main">
                                ↓ {consumer.rxValue.toFixed(1)} pkt/s
                              </Typography>
                              <Typography variant="caption" color="info.main">
                                ↑ {consumer.txValue.toFixed(1)} pkt/s
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No network activity' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Network Errors/Drops */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:alert-circle" width={24} color="#00acc1" />
                      <Typography variant="subtitle2" sx={{ color: '#00acc1', fontWeight: 600 }}>
                        Network errors
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topNetworkErrors.length > 0 ? (
                        topNetworkErrors.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="error.main">
                                Err: {consumer.errorsValue.toFixed(1)}/s
                              </Typography>
                              <Typography variant="caption" color="warning.main">
                                Drop: {consumer.dropsValue.toFixed(1)}/s
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No network errors' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Memory */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:memory" width={24} color="#2196f3" />
                      <Typography variant="subtitle2" sx={{ color: '#2196f3', fontWeight: 600 }}>
                        Memory
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topMemoryConsumers.length > 0 ? (
                        topMemoryConsumers.map((consumer, idx) => {
                          const memGiB = consumer.value / (1024 * 1024 * 1024);
                          const totalGiB = consumer.total
                            ? consumer.total / (1024 * 1024 * 1024)
                            : undefined;
                          const percentage = totalGiB ? (memGiB / totalGiB) * 100 : 0;
                          return (
                            <Box key={idx} sx={{ mb: 1 }}>
                              <Box
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  mb: 0.5,
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: 1,
                                  }}
                                >
                                  {consumer.name}
                                </Typography>
                                <Typography variant="caption" fontWeight="bold" sx={{ ml: 1 }}>
                                  {memGiB.toFixed(1)} GiB
                                  {totalGiB ? ` / ${totalGiB.toFixed(1)} GiB` : ''}
                                </Typography>
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(percentage, 100)}
                                sx={{
                                  height: 6,
                                  borderRadius: 1,
                                  bgcolor: 'rgba(33, 150, 243, 0.2)', // Light blue background
                                  '& .MuiLinearProgress-bar': {
                                    bgcolor: '#2196f3', // Blue for Memory
                                  },
                                }}
                              />
                            </Box>
                          );
                        })
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No metrics available' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Memory swap traffic */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:swap-horizontal" width={24} color="#9c27b0" />
                      <Typography variant="subtitle2" sx={{ color: '#9c27b0', fontWeight: 600 }}>
                        Memory swap traffic
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topMemorySwap.length > 0 ? (
                        topMemorySwap.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="success.main">
                                ↓ {(consumer.inValue / 1024).toFixed(1)} KB/s
                              </Typography>
                              <Typography variant="caption" color="error.main">
                                ↑ {(consumer.outValue / 1024).toFixed(1)} KB/s
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No swap activity' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Storage throughput */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:chart-line" width={24} color="#f0ab00" />
                      <Typography variant="subtitle2" sx={{ color: '#f0ab00', fontWeight: 600 }}>
                        Storage throughput
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topStorageThroughput.length > 0 ? (
                        topStorageThroughput.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="success.main">
                                R: {(consumer.readValue / 1024).toFixed(1)} KB/s
                              </Typography>
                              <Typography variant="caption" color="warning.main">
                                W: {(consumer.writeValue / 1024).toFixed(1)} KB/s
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No storage activity' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Storage IOPS */}
              <Grid item xs={12} sm={6} lg={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon icon="mdi:database-arrow-up-outline" width={24} color="#f0ab00" />
                      <Typography variant="subtitle2" sx={{ color: '#f0ab00', fontWeight: 600 }}>
                        Storage IOPS
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 150,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      {topStorageIOPS.length > 0 ? (
                        topStorageIOPS.map((consumer, idx) => (
                          <Box key={idx}>
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 0.25,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {consumer.name}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, fontSize: '0.7rem' }}>
                              <Typography variant="caption" color="success.main">
                                R: {consumer.readValue.toFixed(1)} IOPS
                              </Typography>
                              <Typography variant="caption" color="warning.main">
                                W: {consumer.writeValue.toFixed(1)} IOPS
                              </Typography>
                            </Box>
                          </Box>
                        ))
                      ) : (
                        <Box
                          sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {prometheusAvailable ? 'No storage activity' : 'Requires Prometheus'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* VM Status & Resources */}
        <Grid item xs={12} md={6}>
          {/* VirtualMachine statuses */}
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              VirtualMachine statuses
            </Typography>

            {/* Status Donut Chart using conic-gradient for proper proportions */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mb: 3,
              }}
            >
              {(() => {
                const total = stats.total || 1; // Avoid division by zero
                const errorPct = (stats.error / total) * 100;
                const runningPct = (stats.running / total) * 100;
                const stoppedPct = (stats.stopped / total) * 100;
                const pausedPct = (stats.paused / total) * 100;
                const migratingPct = (stats.migrating / total) * 100;

                // Build conic-gradient
                let angle = 0;
                const segments = [];

                // Use same color order as legend: Error, Running, Stopped, Migrating, Paused
                if (stats.error > 0) {
                  segments.push(
                    `${VM_STATUS_COLORS.error} ${angle}deg ${angle + errorPct * 3.6}deg`
                  );
                  angle += errorPct * 3.6;
                }
                if (stats.running > 0) {
                  segments.push(
                    `${VM_STATUS_COLORS.running} ${angle}deg ${angle + runningPct * 3.6}deg`
                  );
                  angle += runningPct * 3.6;
                }
                if (stats.stopped > 0) {
                  segments.push(
                    `${VM_STATUS_COLORS.stopped} ${angle}deg ${angle + stoppedPct * 3.6}deg`
                  );
                  angle += stoppedPct * 3.6;
                }
                if (stats.migrating > 0) {
                  segments.push(
                    `${VM_STATUS_COLORS.migrating} ${angle}deg ${angle + migratingPct * 3.6}deg`
                  );
                  angle += migratingPct * 3.6;
                }
                if (stats.paused > 0) {
                  segments.push(
                    `${VM_STATUS_COLORS.paused} ${angle}deg ${angle + pausedPct * 3.6}deg`
                  );
                  angle += pausedPct * 3.6;
                }

                const gradient =
                  segments.length > 0
                    ? `conic-gradient(${segments.join(', ')})`
                    : 'conic-gradient(#e0e0e0 0deg 360deg)';

                return (
                  <Box
                    sx={{
                      width: 200,
                      height: 200,
                      borderRadius: '50%',
                      background: gradient,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <Box
                      sx={{
                        width: 140,
                        height: 140,
                        borderRadius: '50%',
                        bgcolor: 'background.paper',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3">{stats.total}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          VMs
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                );
              })()}
            </Box>

            {/* Status Legend - Colors match donut chart exactly - Always show all statuses */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: VM_STATUS_COLORS.error,
                    }}
                  />
                  <Typography variant="body2">Error</Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold">
                  {stats.error}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: VM_STATUS_COLORS.running,
                    }}
                  />
                  <Typography variant="body2">Running</Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold">
                  {stats.running}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: VM_STATUS_COLORS.stopped,
                    }}
                  />
                  <Typography variant="body2">Stopped</Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold">
                  {stats.stopped}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: VM_STATUS_COLORS.migrating,
                    }}
                  />
                  <Typography variant="body2">Migrating</Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold">
                  {stats.migrating}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: VM_STATUS_COLORS.paused,
                    }}
                  />
                  <Typography variant="body2">Paused</Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold">
                  {stats.paused}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Link routeName="virtualmachines">
                <Typography variant="body2" color="primary">
                  View all VirtualMachines →
                </Typography>
              </Link>
            </Box>
          </Paper>
        </Grid>

        {/* Resource consumption */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Total allocated resources
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* CPU */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Icon icon="mdi:cpu-64-bit" width={24} color="#3e8635" />
                  <Typography variant="subtitle2">CPU Cores</Typography>
                </Box>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                  }}
                >
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#3e8635' }}>
                    {totalResources.cpu}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    cores allocated across {stats.total} VMs
                  </Typography>
                </Box>
              </Box>

              <Divider />

              {/* Memory */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Icon icon="mdi:memory" width={24} color="#2196f3" />
                  <Typography variant="subtitle2">Memory</Typography>
                </Box>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                  }}
                >
                  {totalResources.memory > 0 ? (
                    <>
                      <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#2196f3' }}>
                        {(totalResources.memory / (1024 * 1024 * 1024)).toFixed(1)} GiB
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        allocated across {stats.total} VMs
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No memory allocated
                    </Typography>
                  )}
                </Box>
              </Box>

              <Divider />

              {/* Storage */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Icon icon="mdi:harddisk" width={24} color="#f0ab00" />
                  <Typography variant="subtitle2">Storage</Typography>
                </Box>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Calculation requires PVC data
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                    Will be implemented in future update
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
