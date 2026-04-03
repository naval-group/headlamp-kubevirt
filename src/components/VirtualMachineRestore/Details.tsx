import { Icon } from '@iconify/react';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, Chip, CircularProgress, Grid, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { safeError } from '../../utils/sanitize';
import { getRestoreStatusColor } from '../../utils/statusColors';
import ConditionsTable from '../common/ConditionsTable';
import VirtualMachineRestore from './VirtualMachineRestore';

export default function VirtualMachineRestoreDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [restore, error] = VirtualMachineRestore.useGet(name, namespace);

  if (error) {
    return (
      <SectionBox title="Restore Details">
        <Typography color="error">
          Failed to load restore: {safeError(error, 'restore-details')}
        </Typography>
      </SectionBox>
    );
  }

  if (!restore) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
        <CircularProgress />
      </Box>
    );
  }

  const status = restore.getEffectiveStatus();
  const reason = restore.getStatusReason();
  const targetName = restore.getTargetName();
  const snapshotName = restore.getSnapshotName();
  const restoreTime = restore.getRestoreTime();
  const restoredVolumes = restore.getRestoredVolumes();

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineRestore}
        name={name}
        namespace={namespace}
        withEvents
      />
      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:restore" />
                <Typography variant="h6">Restore Info</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box mt={0.5}>
                  <Chip
                    label={status || 'Unknown'}
                    size="small"
                    color={getRestoreStatusColor(status)}
                  />
                </Box>
              </Box>

              {reason && status === 'Failed' && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Reason
                  </Typography>
                  <Typography variant="body2" color="error">
                    {reason}
                  </Typography>
                </Box>
              )}

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Target VM
                </Typography>
                <Typography variant="body1">
                  <Link
                    routeName="virtualmachine"
                    params={{ name: targetName, namespace: restore.getNamespace() }}
                  >
                    {targetName}
                  </Link>
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Snapshot
                </Typography>
                <Typography variant="body1">
                  <Link
                    routeName="snapshot"
                    params={{ name: snapshotName, namespace: restore.getNamespace() }}
                  >
                    {snapshotName}
                  </Link>
                </Typography>
              </Box>

              {restoreTime && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Restore Time
                  </Typography>
                  <Typography variant="body2">{new Date(restoreTime).toLocaleString()}</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {restoredVolumes.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Icon icon="mdi:harddisk" />
                  <Typography variant="h6">Restored Volumes</Typography>
                </Box>
                {restoredVolumes.map(vol => (
                  <Box key={vol.volumeName} mb={1}>
                    <Typography variant="body2" color="text.secondary">
                      {vol.volumeName}
                    </Typography>
                    <Typography variant="body2" fontFamily="monospace">
                      {vol.persistentVolumeClaim}
                    </Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
        )}

        <Grid item xs={12}>
          <ConditionsTable conditions={restore.status?.conditions} />
        </Grid>
      </Grid>
    </>
  );
}
