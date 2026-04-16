import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import {
  clearMetricsEndpoint,
  saveMetricsEndpoint,
  testMetricsEndpoint,
  TestResult,
  useMetricsEndpoint,
} from '../../utils/metricsEndpoint';
import { discoverPrometheus } from '../../utils/prometheus';

const CONFIGMAP_NAME = 'headlamp-kubevirt-config';

interface ServiceInfo {
  name: string;
  namespace: string;
  ports: Array<{ port: number; name?: string; protocol?: string }>;
}

export default function MetricsEndpointConfig({ compact }: { compact?: boolean }) {
  const endpoint = useMetricsEndpoint();
  const [mode, setMode] = useState<'picker' | 'manual'>('picker');
  const [url, setUrl] = useState(endpoint.baseUrl || '');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Service picker state
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const [allServices, setAllServices] = useState<ServiceInfo[]>([]);
  const [selectedNs, setSelectedNs] = useState('');
  const [selectedSvc, setSelectedSvc] = useState('');
  const [selectedPort, setSelectedPort] = useState('');
  const [mimirPrefix, setMimirPrefix] = useState(false);

  // Advanced settings
  const [orgIdEnabled, setOrgIdEnabled] = useState(false);
  const [orgId, setOrgId] = useState('');

  // ConfigMap save modal
  const [cmModalOpen, setCmModalOpen] = useState(false);
  const [cmNamespace, setCmNamespace] = useState('');

  // Sync URL field and pre-fill picker when endpoint changes externally
  useEffect(() => {
    if (endpoint.baseUrl && !url) {
      setUrl(endpoint.baseUrl);
      // Parse URL to pre-fill picker: /api/v1/namespaces/{ns}/services/{svc}:{port}/proxy[/prometheus]
      const match = endpoint.baseUrl.match(
        /^\/api\/v1\/namespaces\/([^/]+)\/services\/([^:]+):(\d+)\/proxy(\/prometheus)?$/
      );
      if (match) {
        setSelectedNs(match[1]);
        setSelectedSvc(match[2]);
        setSelectedPort(match[3]);
        setMimirPrefix(!!match[4]);
        setMode('picker');
      } else {
        setMode('manual');
      }
    }
    if (endpoint.orgId) {
      setOrgIdEnabled(true);
      setOrgId(endpoint.orgId);
    }
  }, [endpoint.baseUrl, endpoint.orgId]);

  // Fetch namespaces on mount
  useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
        const nsList = resp?.items?.map(ns => ns.metadata.name) || [];
        setAllNamespaces(nsList.sort());
      })
      .catch(() => {});
  }, []);

  // Fetch services when namespace changes
  useEffect(() => {
    if (!selectedNs) {
      setAllServices([]);
      return;
    }
    ApiProxy.request(`/api/v1/namespaces/${selectedNs}/services`)
      .then(
        (resp: {
          items?: Array<{
            metadata: { name: string; namespace: string };
            spec: { ports: Array<{ port: number; name?: string }> };
          }>;
        }) => {
          const svcs: ServiceInfo[] = (resp?.items || [])
            .filter(s => s.spec?.ports?.length > 0)
            .map(s => ({
              name: s.metadata.name,
              namespace: s.metadata.namespace,
              ports: s.spec.ports,
            }));
          setAllServices(svcs.sort((a, b) => a.name.localeCompare(b.name)));
        }
      )
      .catch(() => setAllServices([]));
  }, [selectedNs]);

  // Build URL from picker selections
  useEffect(() => {
    if (mode !== 'picker' || !selectedNs || !selectedSvc || !selectedPort) return;
    const prefix = mimirPrefix ? '/prometheus' : '';
    const built = `/api/v1/namespaces/${selectedNs}/services/${selectedSvc}:${selectedPort}/proxy${prefix}`;
    setUrl(built);
    setTestResult(null);
  }, [selectedNs, selectedSvc, selectedPort, mimirPrefix, mode]);

  const selectedSvcObj = allServices.find(s => s.name === selectedSvc);

  const handleAutoDetect = async () => {
    setDetecting(true);
    setTestResult(null);
    setSaveError('');
    try {
      const prom = await discoverPrometheus();
      if (prom.available) {
        setUrl(prom.baseUrl);
        setMode('manual');
        const result = await testMetricsEndpoint(prom.baseUrl);
        setTestResult(result);
      } else if (prom.installed) {
        setSaveError('Prometheus service found but not reachable. Check service health.');
      } else {
        setSaveError('No Prometheus-compatible service found in the cluster.');
      }
    } catch {
      setSaveError('Auto-detect failed.');
    } finally {
      setDetecting(false);
    }
  };

  const handleTest = async () => {
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    setSaveError('');
    const result = await testMetricsEndpoint(url, orgId || undefined);
    setTestResult(result);
    setTesting(false);
  };

  const handleSaveLocal = async () => {
    if (!url) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveMetricsEndpoint(url, 'localstorage', undefined, orgId || undefined);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCluster = async () => {
    if (!url || !cmNamespace) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveMetricsEndpoint(url, 'configmap', cmNamespace, orgId || undefined);
      setCmModalOpen(false);
    } catch (err) {
      setSaveError(`Failed to save ConfigMap: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await clearMetricsEndpoint();
    setUrl('');
    setSelectedNs('');
    setSelectedSvc('');
    setSelectedPort('');
    setOrgId('');
    setOrgIdEnabled(false);
    setMimirPrefix(false);
    setTestResult(null);
    setSaveError('');
  };

  const sourceLabel =
    endpoint.source === 'configmap'
      ? 'From ConfigMap'
      : endpoint.source === 'localstorage'
      ? 'From browser'
      : 'Not configured';

  const sourceColor =
    endpoint.source === 'none' ? 'warning' : endpoint.available ? 'success' : 'error';

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="mdi:chart-line" width={20} style={{ color: '#2196f3' }} />
          <Typography variant={compact ? 'body1' : 'subtitle1'} fontWeight={500} flex={1}>
            Metrics Endpoint
          </Typography>
          <Chip
            label={sourceLabel}
            size="small"
            color={sourceColor as 'warning' | 'success' | 'error'}
            variant="outlined"
          />
        </Box>

        {!compact && (
          <Typography variant="body2" color="text.secondary">
            Configure the Prometheus-compatible API endpoint for VM metrics. Supports Prometheus,
            Thanos, and Grafana Mimir.
          </Typography>
        )}

        {/* Mode selector */}
        <RadioGroup row value={mode} onChange={e => setMode(e.target.value as 'picker' | 'manual')}>
          <FormControlLabel
            value="picker"
            control={<Radio size="small" />}
            label={<Typography variant="body2">Service Picker</Typography>}
          />
          <FormControlLabel
            value="manual"
            control={<Radio size="small" />}
            label={<Typography variant="body2">Manual URL</Typography>}
          />
        </RadioGroup>

        {mode === 'picker' ? (
          <Box display="flex" gap={1} flexWrap="wrap">
            <Autocomplete
              size="small"
              sx={{ minWidth: 160 }}
              options={allNamespaces}
              value={selectedNs || null}
              onChange={(_e, val) => {
                setSelectedNs(val || '');
                setSelectedSvc('');
                setSelectedPort('');
              }}
              renderInput={params => <TextField {...params} label="Namespace" />}
            />

            <Autocomplete
              size="small"
              sx={{ minWidth: 250 }}
              options={allServices.map(s => s.name)}
              value={selectedSvc || null}
              onChange={(_e, val) => {
                setSelectedSvc(val || '');
                setSelectedPort('');
              }}
              disabled={!selectedNs}
              renderInput={params => <TextField {...params} label="Service" />}
            />

            <Autocomplete
              size="small"
              sx={{ minWidth: 140 }}
              options={(selectedSvcObj?.ports || []).map(p => {
                const label = p.name ? `${p.port} (${p.name})` : String(p.port);
                return label;
              })}
              value={
                selectedPort
                  ? ((p): string => {
                      const name = p?.name;
                      return name ? `${selectedPort} (${name})` : selectedPort;
                    })(selectedSvcObj?.ports.find(p => String(p.port) === selectedPort))
                  : null
              }
              onChange={(_e, val) => setSelectedPort(val ? val.split(' ')[0] : '')}
              disabled={!selectedSvc}
              renderInput={params => <TextField {...params} label="Port" />}
            />

            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={mimirPrefix}
                  onChange={e => setMimirPrefix(e.target.checked)}
                />
              }
              label={
                <Tooltip title="Mimir serves its Prometheus API at /prometheus. Enable this for Mimir endpoints.">
                  <Typography variant="body2">/prometheus prefix</Typography>
                </Tooltip>
              }
            />
          </Box>
        ) : (
          <TextField
            size="small"
            fullWidth
            label="Endpoint URL"
            placeholder="/api/v1/namespaces/monitoring/services/prometheus:9090/proxy"
            InputLabelProps={{ shrink: true }}
            value={url}
            onChange={e => {
              setUrl(e.target.value);
              setTestResult(null);
            }}
            helperText="K8s API proxy path — e.g., /api/v1/namespaces/monitoring/services/prometheus:9090/proxy"
          />
        )}

        {/* Constructed URL preview (picker mode) */}
        {mode === 'picker' && url && (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}
          >
            {url}
          </Typography>
        )}

        {/* Advanced settings */}
        <Accordion
          disableGutters
          elevation={0}
          sx={{ border: 'none', '&:before': { display: 'none' }, bgcolor: 'transparent' }}
        >
          <AccordionSummary
            expandIcon={<Icon icon="mdi:chevron-down" width={18} />}
            sx={{ px: 0, minHeight: 0, '& .MuiAccordionSummary-content': { my: 0.5 } }}
          >
            <Typography variant="body2" color="text.secondary">
              Advanced
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={orgIdEnabled}
                  onChange={e => {
                    setOrgIdEnabled(e.target.checked);
                    if (!e.target.checked) setOrgId('');
                  }}
                />
              }
              label={<Typography variant="body2">Send tenant header (X-Scope-OrgID)</Typography>}
            />
            {orgIdEnabled && (
              <TextField
                size="small"
                label="Tenant ID"
                placeholder="anonymous"
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                helperText="Required for Mimir multi-tenancy. Common values: anonymous, your-tenant-name."
                sx={{ maxWidth: 300 }}
                InputLabelProps={{ shrink: true }}
              />
            )}
          </AccordionDetails>
        </Accordion>

        <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <Button
            size="small"
            variant="outlined"
            startIcon={<Icon icon="mdi:magnify" width={16} />}
            onClick={handleAutoDetect}
            disabled={detecting}
          >
            {detecting ? 'Scanning...' : 'Auto-Detect'}
          </Button>

          <Button
            size="small"
            variant="outlined"
            startIcon={<Icon icon="mdi:play" width={16} />}
            onClick={handleTest}
            disabled={testing || !url}
          >
            {testing ? 'Testing...' : 'Test'}
          </Button>

          <Box sx={{ flex: 1 }} />

          <Tooltip title="Save to your browser's local storage. Only applies to this browser.">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={<Icon icon="mdi:content-save" width={16} />}
                onClick={handleSaveLocal}
                disabled={saving || !url}
              >
                Save to Browser
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Save as a ConfigMap in the cluster. All users will use this configuration.">
            <span>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<Icon icon="mdi:kubernetes" width={16} />}
                onClick={() => {
                  setCmNamespace('');
                  setCmModalOpen(true);
                }}
                disabled={saving || !url}
              >
                Save to Cluster
              </Button>
            </span>
          </Tooltip>

          {endpoint.source !== 'none' && (
            <Tooltip title="Remove saved endpoint configuration">
              <IconButton size="small" onClick={handleClear} color="error">
                <Icon icon="mdi:delete" width={18} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {testResult && (
          <Typography
            variant="body2"
            sx={{
              color: testResult.ok ? '#4caf50' : '#f44336',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Icon icon={testResult.ok ? 'mdi:check-circle' : 'mdi:alert-circle'} width={16} />
            {testResult.ok
              ? `OK — found ${testResult.count} metric targets`
              : `Failed: ${testResult.error}`}
          </Typography>
        )}

        {saveError && (
          <Alert severity="error" variant="filled" onClose={() => setSaveError('')}>
            {saveError}
          </Alert>
        )}
      </Box>

      {/* ConfigMap Save Modal */}
      <Dialog open={cmModalOpen} onClose={() => setCmModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Save Metrics Endpoint to Cluster</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            This will create or update a ConfigMap named <code>{CONFIGMAP_NAME}</code> in the
            selected namespace. All plugin users on this cluster will use this endpoint.
          </Typography>

          <Autocomplete
            size="small"
            fullWidth
            options={allNamespaces}
            value={cmNamespace || null}
            onChange={(_e, val) => setCmNamespace(val || '')}
            renderInput={params => <TextField {...params} label="Namespace" />}
            sx={{ mb: 2 }}
          />

          <Typography variant="subtitle2" mb={1}>
            ConfigMap Preview
          </Typography>
          <Box
            sx={{
              bgcolor: 'rgba(0,0,0,0.05)',
              p: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {`apiVersion: v1
kind: ConfigMap
metadata:
  name: ${CONFIGMAP_NAME}
  namespace: ${cmNamespace || '<select namespace>'}
data:
  metricsEndpoint: "${url}"${orgId ? `\n  metricsOrgId: "${orgId}"` : ''}`}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCmModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveCluster} disabled={saving || !cmNamespace}>
            {saving ? 'Saving...' : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
