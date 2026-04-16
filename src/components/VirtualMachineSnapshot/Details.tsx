import { Icon } from '@iconify/react';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useFeatureGate from '../../hooks/useFeatureGate';
import { KubeCondition } from '../../types';
import CreateExportDialog from '../VirtualMachineExport/CreateExportDialog';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

export default function VirtualMachineSnapshotDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [snapshot] = VirtualMachineSnapshot.useGet(name, namespace);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const vmExportEnabled = useFeatureGate('VMExport');

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

              {snapshot.getSourceIndications().length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Consistency
                  </Typography>
                  <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {snapshot.getSourceIndications().map((ind, i) => {
                      const color =
                        ind.indication === 'GuestAgent'
                          ? 'success'
                          : ind.indication === 'NoGuestAgent'
                          ? 'warning'
                          : 'default';
                      return (
                        <Chip
                          key={i}
                          label={ind.indication}
                          size="small"
                          color={color as 'success' | 'warning' | 'default'}
                          variant="outlined"
                          title={ind.message}
                        />
                      );
                    })}
                  </Box>
                </Box>
              )}

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
