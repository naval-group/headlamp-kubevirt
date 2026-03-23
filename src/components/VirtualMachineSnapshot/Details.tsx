import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { KubeCondition } from '../../types';
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../../utils/featureGates';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

// CreateExportDialog component for creating exports from snapshots
function CreateExportDialog({
  open,
  onClose,
  snapshotName,
  snapshotNamespace,
}: {
  open: boolean;
  onClose: () => void;
  snapshotName: string;
  snapshotNamespace: string;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [ttl, setTtl] = useState('2h');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const exportName = `${snapshotName}-export-${Date.now()}`;
      const exportResource = {
        apiVersion: 'export.kubevirt.io/v1beta1',
        kind: 'VirtualMachineExport',
        metadata: {
          name: exportName,
          namespace: snapshotNamespace,
        },
        spec: {
          source: {
            apiGroup: 'snapshot.kubevirt.io',
            kind: 'VirtualMachineSnapshot',
            name: snapshotName,
          },
          ttlDuration: ttl,
        },
      };

      await ApiProxy.request(
        `/apis/export.kubevirt.io/v1beta1/namespaces/${snapshotNamespace}/virtualmachineexports`,
        {
          method: 'POST',
          body: JSON.stringify(exportResource),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar(`Export ${exportName} created`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      enqueueSnackbar(`Failed to create export: ${(error as Error).message}`, { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
      }}
      onClick={onClose}
    >
      <Card sx={{ minWidth: 400, maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Create Export from Snapshot
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Snapshot: {snapshotName}
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              TTL Duration
            </Typography>
            <select
              value={ttl}
              onChange={e => setTtl(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px' }}
            >
              <option value="1h">1 hour</option>
              <option value="2h">2 hours</option>
              <option value="6h">6 hours</option>
              <option value="12h">12 hours</option>
              <option value="24h">24 hours</option>
              <option value="48h">48 hours</option>
              <option value="168h">1 week</option>
            </select>
          </Box>
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Export'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function VirtualMachineSnapshotDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [snapshot] = VirtualMachineSnapshot.useGet(name, namespace);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const [vmExportEnabled, setVmExportEnabled] = useState(isFeatureGateEnabled('VMExport'));
  useEffect(() => {
    setVmExportEnabled(isFeatureGateEnabled('VMExport'));
    return subscribeToFeatureGates(() => setVmExportEnabled(isFeatureGateEnabled('VMExport')));
  }, []);

  if (!snapshot) {
    return null;
  }

  const phase = snapshot.getPhase();
  const isReady = snapshot.isReadyToUse();
  let phaseColor: 'success' | 'info' | 'error' | 'default' = 'default';
  if (phase === 'Succeeded' && isReady) phaseColor = 'success';
  else if (phase === 'InProgress') phaseColor = 'info';
  else if (phase === 'Failed') phaseColor = 'error';

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineSnapshot}
        name={name}
        namespace={namespace}
        withEvents
        actions={
          vmExportEnabled
            ? [
                <Button
                  key="export"
                  variant="outlined"
                  size="small"
                  startIcon={<Icon icon="mdi:export" />}
                  onClick={() => setExportDialogOpen(true)}
                >
                  Export
                </Button>,
              ]
            : []
        }
      />
      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        {/* Overview */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:camera" />
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
                  Ready to Use
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip
                    label={isReady ? 'Yes' : 'No'}
                    size="small"
                    color={isReady ? 'success' : 'default'}
                  />
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Source VM
                </Typography>
                <Typography variant="body1">
                  <Link
                    routeName="virtualmachine"
                    params={{ name: snapshot.getSourceName(), namespace: snapshot.getNamespace() }}
                  >
                    {snapshot.getSourceName()}
                  </Link>
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Creation Time
                </Typography>
                <Typography variant="body1">
                  {snapshot.getCreationTime()
                    ? new Date(snapshot.getCreationTime()).toLocaleString()
                    : '-'}
                </Typography>
              </Box>

              {snapshot.getError() && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Error
                  </Typography>
                  <Typography variant="body1" color="error">
                    {snapshot.getError()}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Volumes */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:harddisk" />
                <Typography variant="h6">Snapshot Volumes</Typography>
              </Box>

              {snapshot.getIncludedVolumes().length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Included Volumes
                  </Typography>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    {snapshot.getIncludedVolumes().map((vol: string) => (
                      <Chip key={vol} label={vol} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>
              )}

              {snapshot.getExcludedVolumes().length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Excluded Volumes
                  </Typography>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    {snapshot.getExcludedVolumes().map((vol: string) => (
                      <Chip key={vol} label={vol} size="small" variant="outlined" color="warning" />
                    ))}
                  </Box>
                </Box>
              )}

              {snapshot.getIncludedVolumes().length === 0 &&
                snapshot.getExcludedVolumes().length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No volume information available
                  </Typography>
                )}
            </CardContent>
          </Card>
        </Grid>

        {/* Conditions */}
        <Grid item xs={12}>
          <SectionBox title="Conditions">
            {snapshot.status?.conditions && snapshot.status.conditions.length > 0 ? (
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
                  {snapshot.status.conditions.map((condition: KubeCondition, idx: number) => (
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

      <CreateExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        snapshotName={name || ''}
        snapshotNamespace={namespace || ''}
      />
    </>
  );
}
