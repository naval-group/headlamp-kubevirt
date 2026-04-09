import { Icon } from '@iconify/react';
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  IconButton,
  Link as MuiLink,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExportVolume, KubeCondition, KubeServiceSubset } from '../../types';
import VirtualMachineExport from './VirtualMachineExport';

/**
 * Replaces the internal service hostname in a URL with localhost:<port>.
 * e.g. https://virt-export-xxx.default.svc/volumes/disk.img → https://localhost:8443/volumes/disk.img
 */
function rewriteUrl(url: string, localPort: string): string {
  const port = /^\d{1,5}$/.test(localPort) ? localPort : '8443';
  try {
    const parsed = new URL(url);
    parsed.hostname = 'localhost';
    parsed.port = port;
    return parsed.toString();
  } catch {
    return url.replace(/https?:\/\/[^/]+/, `https://localhost:${port}`);
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton
        size="small"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
      </IconButton>
    </Tooltip>
  );
}

interface DownloadAccessProps {
  serviceName: string;
  namespace: string;
  volumes: ExportVolume[];
  tokenSecretRef?: string;
}

function DownloadAccess({ serviceName, namespace, volumes, tokenSecretRef }: DownloadAccessProps) {
  const [accessMode, setAccessMode] = useState<'portforward' | 'cli'>('portforward');
  const [localPort, setLocalPort] = useState('8443');
  const [portForwardActive, setPortForwardActive] = useState(false);
  const [portForwardId, setPortForwardId] = useState('');
  const [portForwardError, setPortForwardError] = useState('');
  const [serviceResource, setServiceResource] = useState<KubeServiceSubset | null>(null);
  const [podName, setPodName] = useState('');
  const [exportToken, setExportToken] = useState('');
  const cluster = K8s.useCluster();

  // Fetch the export token from the secret
  React.useEffect(() => {
    if (!tokenSecretRef || !namespace) return;
    ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets/${tokenSecretRef}`)
      .then((secret: KubeServiceSubset) => {
        const token = secret?.data?.token;
        if (token) {
          setExportToken(atob(token));
        }
      })
      .catch(() => setExportToken(''));
  }, [tokenSecretRef, namespace]);

  // Fetch the export service and its backing pod
  React.useEffect(() => {
    if (!serviceName || !namespace) return;
    ApiProxy.request(`/api/v1/namespaces/${namespace}/services/${serviceName}`)
      .then((svc: KubeServiceSubset) => {
        setServiceResource(svc);
        // Find the pod backing this service using its selector
        const selector = svc.spec?.selector;
        if (selector) {
          const labelSelector = Object.entries(selector)
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
          ApiProxy.request(
            `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(
              labelSelector
            )}`
          )
            .then((response: KubeServiceSubset) => {
              const pods = response?.items || [];
              if (pods.length > 0) {
                setPodName(pods[0].metadata.name);
              }
            })
            .catch(() => setPodName(''));
        }
      })
      .catch(() => setServiceResource(null));
  }, [serviceName, namespace]);

  const servicePort = serviceResource?.spec?.ports?.[0]?.port || 443;
  const targetPort = serviceResource?.spec?.ports?.[0]?.targetPort || 8443;

  const kubectlCommand = `kubectl port-forward svc/${serviceName} ${localPort}:${servicePort} -n ${namespace}`;

  const handleStartPortForward = async () => {
    try {
      setPortForwardError('');
      if (!cluster) {
        setPortForwardError('No cluster context found');
        return;
      }
      if (!podName) {
        setPortForwardError('No export pod found for this service');
        return;
      }
      const result = await ApiProxy.startPortForward(
        cluster,
        namespace,
        podName,
        targetPort,
        serviceName,
        namespace,
        localPort
      );
      if (result?.id) {
        setPortForwardId(result.id);
      }
      if (result?.port) {
        setLocalPort(result.port);
      }
      setPortForwardActive(true);
    } catch (err: unknown) {
      setPortForwardError((err as Error)?.message || 'Failed to start port forward');
    }
  };

  const handleStopPortForward = async () => {
    try {
      if (cluster && portForwardId) {
        await ApiProxy.stopOrDeletePortForward(cluster, portForwardId, true);
      }
      setPortForwardActive(false);
      setPortForwardId('');
    } catch (err: unknown) {
      setPortForwardError((err as Error)?.message || 'Failed to stop port forward');
    }
  };

  return (
    <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '4px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon="mdi:download-network" width={20} color="#2196f3" />
        <Typography variant="subtitle2">Download Access</Typography>
      </Box>

      <RadioGroup
        row
        value={accessMode}
        onChange={e => setAccessMode(e.target.value as 'portforward' | 'cli')}
        sx={{ mb: 2 }}
      >
        <FormControlLabel
          value="portforward"
          control={<Radio size="small" />}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Icon icon="mdi:play-network" width={16} />
              <Typography variant="body2">Port Forward</Typography>
            </Box>
          }
        />
        <FormControlLabel
          value="cli"
          control={<Radio size="small" />}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Icon icon="mdi:console" width={16} />
              <Typography variant="body2">CLI</Typography>
            </Box>
          }
        />
      </RadioGroup>

      {accessMode === 'cli' && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Run this command to forward the export service locally:
          </Typography>
          <Box sx={{ position: 'relative' }}>
            <Box
              sx={{
                p: 1.5,
                bgcolor: 'rgba(0, 0, 0, 0.06)',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                pr: 5,
                overflowX: 'auto',
              }}
            >
              {kubectlCommand}
            </Box>
            <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
              <CopyButton text={kubectlCommand} />
            </Box>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
            Then download volumes using:
          </Typography>
          {volumes.map((volume, idx) => (
            <Box key={idx} sx={{ mb: 1 }}>
              <Typography variant="body2" fontWeight="bold" sx={{ mb: 0.5 }}>
                {volume.name}
              </Typography>
              {volume.formats?.map((format, fIdx) => {
                const localUrl = rewriteUrl(format.url, localPort);
                const tokenHeader = exportToken
                  ? ` \\\n  -H "x-kubevirt-export-token: ${exportToken}"`
                  : '';
                const curlCmd = `curl -k${tokenHeader} \\\n  -o ${volume.name}.${
                  format.format === 'gzip' ? 'img.gz' : 'img'
                } \\\n  "${localUrl}"`;
                return (
                  <Box key={fIdx} sx={{ ml: 2, mb: 1, position: 'relative' }}>
                    <Typography variant="caption" color="text.secondary">
                      {format.format}:
                    </Typography>
                    <Box
                      sx={{
                        p: 1,
                        bgcolor: 'rgba(0, 0, 0, 0.06)',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        pr: 5,
                        overflowX: 'auto',
                      }}
                    >
                      {curlCmd}
                    </Box>
                    <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
                      <CopyButton text={curlCmd} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      {accessMode === 'portforward' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <TextField
              size="small"
              label="Local Port"
              value={localPort}
              onChange={e => {
                setLocalPort(e.target.value);
                setPortForwardActive(false);
              }}
              inputProps={{ type: 'number', min: 1024, max: 65535 }}
              sx={{ width: 120 }}
              helperText="1024–65535"
              disabled={portForwardActive}
            />
            {!portForwardActive ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<Icon icon="mdi:play-network" />}
                onClick={handleStartPortForward}
                sx={{ mt: -1 }}
              >
                Start Forward
              </Button>
            ) : (
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<Icon icon="mdi:stop-circle" />}
                onClick={handleStopPortForward}
                sx={{ mt: -1 }}
              >
                Stop Forward
              </Button>
            )}
          </Box>

          {portForwardError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {portForwardError}
            </Alert>
          )}

          {portForwardActive && (
            <Alert severity="success" icon={<Icon icon="mdi:check-circle" />} sx={{ mb: 2 }}>
              Port forward active on <strong>localhost:{localPort}</strong>
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {portForwardActive ? 'Download with curl:' : 'After starting, download with:'}
          </Typography>

          {volumes.map((volume, idx) => (
            <Box key={idx} sx={{ mb: 1 }}>
              <Typography variant="body2" fontWeight="bold" sx={{ mb: 0.5 }}>
                {volume.name}
              </Typography>
              {volume.formats?.map((format, fIdx) => {
                const localUrl = rewriteUrl(format.url, localPort);
                const tokenHeader = exportToken
                  ? ` \\\n  -H "x-kubevirt-export-token: ${exportToken}"`
                  : '';
                const curlCmd = `curl -k${tokenHeader} \\\n  -o ${volume.name}.${
                  format.format === 'gzip' ? 'img.gz' : 'img'
                } \\\n  "${localUrl}"`;
                return (
                  <Box key={fIdx} sx={{ ml: 2, mb: 1, position: 'relative' }}>
                    <Chip label={format.format} size="small" variant="outlined" sx={{ mb: 0.5 }} />
                    <Box
                      sx={{
                        p: 1,
                        bgcolor: portForwardActive
                          ? 'rgba(46, 125, 50, 0.06)'
                          : 'rgba(0, 0, 0, 0.06)',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        pr: 5,
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {curlCmd}
                    </Box>
                    <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
                      <CopyButton text={curlCmd} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function VirtualMachineExportDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [vmExport] = VirtualMachineExport.useGet(name, namespace);

  if (!vmExport) {
    return null;
  }

  const phase = vmExport.getPhase();
  const isReady = vmExport.isReady();
  let phaseColor: 'success' | 'info' | 'error' | 'warning' | 'default' = 'default';
  if (phase === 'Ready' && isReady) phaseColor = 'success';
  else if (phase === 'Pending') phaseColor = 'info';
  else if (phase === 'Failed') phaseColor = 'error';
  else if (phase === 'Terminated') phaseColor = 'warning';

  const internalLinks = vmExport.getInternalLinks();
  const externalLinks = vmExport.getExternalLinks();
  const serviceName = vmExport.getServiceName();
  const exportNamespace = vmExport.getNamespace();

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineExport}
        name={name}
        namespace={namespace}
        withEvents
      />
      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        {/* Overview */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:export" />
                <Typography variant="h6">Overview</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Phase
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip label={phase} size="small" color={phaseColor} />
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Source
                </Typography>
                <Typography variant="body1">
                  {vmExport.getSourceKind()} / {vmExport.getSourceName()}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  VM Name
                </Typography>
                <Typography variant="body1">{vmExport.getVirtualMachineName() || '-'}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  TTL Duration
                </Typography>
                <Typography variant="body1">{vmExport.getTTLDuration() || '-'}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Expires At
                </Typography>
                <Typography variant="body1">
                  {vmExport.getTTLExpirationTime()
                    ? new Date(vmExport.getTTLExpirationTime()).toLocaleString()
                    : '-'}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Service Name
                </Typography>
                <Typography variant="body1">{serviceName || '-'}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Export Links */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:link-variant" />
                <Typography variant="h6">Export Links</Typography>
              </Box>

              {externalLinks && (
                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Icon icon="mdi:earth" width={18} color="#4caf50" />
                    <Typography variant="subtitle2">External Links</Typography>
                  </Box>
                  {externalLinks.volumes?.map((volume: ExportVolume, idx: number) => (
                    <Box key={idx} sx={{ mb: 2 }}>
                      <Typography variant="body2" fontWeight="bold">
                        {volume.name}
                      </Typography>
                      {volume.formats?.map(
                        (format: { format: string; url: string }, fIdx: number) => (
                          <Box
                            key={fIdx}
                            sx={{ ml: 2, mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}
                          >
                            <Chip label={format.format} size="small" variant="outlined" />
                            <MuiLink
                              href={format.url}
                              target="_blank"
                              rel="noopener"
                              sx={{ fontSize: '0.85rem' }}
                            >
                              {format.url}
                            </MuiLink>
                          </Box>
                        )
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {internalLinks && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Icon icon="mdi:server-network" width={18} color="#ff9800" />
                    <Typography variant="subtitle2">Internal Links</Typography>
                  </Box>
                  {internalLinks.volumes?.map((volume: ExportVolume, idx: number) => (
                    <Box key={idx} sx={{ mb: 1 }}>
                      <Typography variant="body2" fontWeight="bold">
                        {volume.name}
                      </Typography>
                      {volume.formats?.map(
                        (format: { format: string; url: string }, fIdx: number) => (
                          <Box key={fIdx} sx={{ ml: 2, mt: 0.5 }}>
                            <Typography variant="body2" component="span" color="text.secondary">
                              {format.format}:{' '}
                            </Typography>
                            <Typography
                              variant="body2"
                              component="span"
                              sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                            >
                              {format.url}
                            </Typography>
                          </Box>
                        )
                      )}
                    </Box>
                  ))}

                  {/* Download Access section */}
                  {internalLinks.volumes && internalLinks.volumes.length > 0 && serviceName && (
                    <DownloadAccess
                      serviceName={serviceName}
                      namespace={exportNamespace}
                      volumes={internalLinks.volumes}
                      tokenSecretRef={vmExport.status?.tokenSecretRef}
                    />
                  )}
                </Box>
              )}

              {!externalLinks && !internalLinks && (
                <Typography variant="body2" color="text.secondary">
                  No export links available yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Conditions */}
        <Grid item xs={12}>
          <SectionBox title="Conditions">
            {vmExport.status?.conditions && vmExport.status.conditions.length > 0 ? (
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <Box component="thead">
                  <Box component="tr">
                    <Box
                      component="th"
                      sx={{
                        textAlign: 'left',
                        p: 1,
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                      }}
                    >
                      Type
                    </Box>
                    <Box
                      component="th"
                      sx={{
                        textAlign: 'left',
                        p: 1,
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                      }}
                    >
                      Status
                    </Box>
                    <Box
                      component="th"
                      sx={{
                        textAlign: 'left',
                        p: 1,
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                      }}
                    >
                      Reason
                    </Box>
                    <Box
                      component="th"
                      sx={{
                        textAlign: 'left',
                        p: 1,
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                      }}
                    >
                      Message
                    </Box>
                    <Box
                      component="th"
                      sx={{
                        textAlign: 'left',
                        p: 1,
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                      }}
                    >
                      Last Transition
                    </Box>
                  </Box>
                </Box>
                <Box component="tbody">
                  {vmExport.status.conditions.map((condition: KubeCondition, idx: number) => (
                    <Box component="tr" key={idx}>
                      <Box
                        component="td"
                        sx={{ p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}
                      >
                        {condition.type}
                      </Box>
                      <Box
                        component="td"
                        sx={{ p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}
                      >
                        <Chip
                          label={condition.status}
                          size="small"
                          color={condition.status === 'True' ? 'success' : 'default'}
                        />
                      </Box>
                      <Box
                        component="td"
                        sx={{ p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}
                      >
                        {condition.reason || '-'}
                      </Box>
                      <Box
                        component="td"
                        sx={{ p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}
                      >
                        {condition.message || '-'}
                      </Box>
                      <Box
                        component="td"
                        sx={{ p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}
                      >
                        {condition.lastTransitionTime
                          ? new Date(condition.lastTransitionTime).toLocaleString()
                          : '-'}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No conditions available
              </Typography>
            )}
          </SectionBox>
        </Grid>
      </Grid>
    </>
  );
}
