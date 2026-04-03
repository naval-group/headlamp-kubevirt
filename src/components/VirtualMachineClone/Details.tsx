import { Icon } from '@iconify/react';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, Chip, CircularProgress, Grid, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { safeError } from '../../utils/sanitize';
import { getCloneStatusColor } from '../../utils/statusColors';
import ConditionsTable from '../common/ConditionsTable';
import VirtualMachineClone from './VirtualMachineClone';

export default function VirtualMachineCloneDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [clone, error] = VirtualMachineClone.useGet(name, namespace);

  if (error) {
    return (
      <SectionBox title="Clone Details">
        <Typography color="error">
          Failed to load clone: {safeError(error, 'clone-details')}
        </Typography>
      </SectionBox>
    );
  }

  if (!clone) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
        <CircularProgress />
      </Box>
    );
  }

  const status = clone.getEffectiveStatus();
  const reason = clone.getStatusReason();
  const sourceName = clone.getSourceName();
  const targetName = clone.getTargetName();

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineClone}
        name={name}
        namespace={namespace}
        withEvents
      />
      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:content-copy" />
                <Typography variant="h6">Clone Info</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box mt={0.5}>
                  <Chip
                    label={status || 'Unknown'}
                    size="small"
                    color={getCloneStatusColor(status)}
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
                  Source VM
                </Typography>
                <Typography variant="body1">
                  <Link
                    routeName="virtualmachine"
                    params={{ name: sourceName, namespace: clone.getNamespace() }}
                  >
                    {sourceName}
                  </Link>
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Target VM
                </Typography>
                <Typography variant="body1">
                  {status === 'Succeeded' && targetName !== '-' ? (
                    <Link
                      routeName="virtualmachine"
                      params={{ name: targetName, namespace: clone.getNamespace() }}
                    >
                      {targetName}
                    </Link>
                  ) : (
                    targetName
                  )}
                </Typography>
              </Box>

              {clone.getSnapshotName() !== '-' && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Snapshot
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {clone.getSnapshotName()}
                  </Typography>
                </Box>
              )}

              {clone.getRestoreName() !== '-' && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Restore
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {clone.getRestoreName()}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <ConditionsTable conditions={clone.status?.conditions} />
        </Grid>
      </Grid>
    </>
  );
}
