import { Icon } from '@iconify/react';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  Typography,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import { formatDuration } from '../../utils/formatDuration';
import { safeError } from '../../utils/sanitize';
import ConditionsTable from '../common/ConditionsTable';
import VirtualMachineInstanceMigration from './VirtualMachineInstanceMigration';

function getPhaseColor(phase: string): 'default' | 'primary' | 'success' | 'error' | 'warning' {
  if (phase === 'Succeeded') return 'success';
  if (phase === 'Failed') return 'error';
  if (
    phase === 'Running' ||
    phase === 'Scheduling' ||
    phase === 'PreparingTarget' ||
    phase === 'TargetReady'
  )
    return 'primary';
  if (phase === 'Pending') return 'warning';
  return 'default';
}

export default function MigrationDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [migration, error] = VirtualMachineInstanceMigration.useGet(name, namespace);

  if (error) {
    return (
      <SectionBox title="Migration Details">
        <Typography color="error">
          Failed to load migration: {safeError(error, 'migration-details')}
        </Typography>
      </SectionBox>
    );
  }

  if (!migration) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
        <CircularProgress />
      </Box>
    );
  }

  const phase = migration.getPhase();
  const isActive = !migration.isCompleted();
  const migState = migration.status?.migrationState;
  const startTs = migration.getStartTime();
  const endTs = migration.getCompletionTime();
  const vmiName = migration.getVMIName();
  const sourceNode = migration.getSourceNode();
  const targetNode = migration.getTargetNode();
  const mode = migState?.mode || '-';
  const duration =
    startTs && startTs !== '-' ? formatDuration(startTs, endTs !== '-' ? endTs : undefined) : '-';

  const migConfig = migState?.migrationConfiguration;

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineInstanceMigration}
        name={name}
        namespace={namespace}
        withEvents
      />
      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        {/* Migration Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:swap-horizontal" />
                <Typography variant="h6">Migration Info</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box mt={0.5} display="flex" alignItems="center" gap={1}>
                  <Chip
                    label={phase}
                    size="small"
                    color={getPhaseColor(phase)}
                    icon={isActive ? <CircularProgress size={12} color="inherit" /> : undefined}
                  />
                </Box>
              </Box>

              {isActive && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Progress
                  </Typography>
                  <Box mt={0.5} display="flex" alignItems="center" gap={1}>
                    <LinearProgress
                      variant="indeterminate"
                      sx={{ flex: 1, height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="body2">{duration}</Typography>
                  </Box>
                </Box>
              )}

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Virtual Machine
                </Typography>
                <Typography variant="body1">
                  <Link
                    routeName="virtualmachine"
                    params={{ name: vmiName, namespace: namespace || '' }}
                  >
                    {vmiName}
                  </Link>
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Mode
                </Typography>
                <Typography variant="body1">{mode}</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Duration
                </Typography>
                <Typography variant="body1">{duration}</Typography>
              </Box>

              {startTs && startTs !== '-' && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Started
                  </Typography>
                  <Typography variant="body1">{new Date(startTs).toLocaleString()}</Typography>
                </Box>
              )}

              {endTs && endTs !== '-' && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Completed
                  </Typography>
                  <Typography variant="body1">{new Date(endTs).toLocaleString()}</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Node Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:server" />
                <Typography variant="h6">Node Info</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Source Node
                </Typography>
                <Typography variant="body1">{sourceNode}</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Target Node
                </Typography>
                <Typography variant="body1">{targetNode}</Typography>
              </Box>

              {migState?.sourcePod && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Source Pod
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {migState.sourcePod}
                  </Typography>
                </Box>
              )}

              {migState?.targetPod && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Target Pod
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {migState.targetPod}
                  </Typography>
                </Box>
              )}

              {migState?.targetNodeAddress && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Target Address
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {migState.targetNodeAddress}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Migration Configuration */}
        {migConfig && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Icon icon="mdi:cog" />
                  <Typography variant="h6">Migration Configuration</Typography>
                </Box>

                {[
                  { label: 'Allow Auto Converge', value: migConfig.allowAutoConverge },
                  { label: 'Allow Post Copy', value: migConfig.allowPostCopy },
                  { label: 'Allow Workload Disruption', value: migConfig.allowWorkloadDisruption },
                  { label: 'Unsafe Migration Override', value: migConfig.unsafeMigrationOverride },
                ].map(item => (
                  <Box key={item.label} mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      {item.label}
                    </Typography>
                    <Chip
                      label={item.value ? 'Yes' : 'No'}
                      size="small"
                      color={item.value ? 'success' : 'default'}
                    />
                  </Box>
                ))}

                {migConfig.bandwidthPerMigration && migConfig.bandwidthPerMigration !== '0' && (
                  <Box mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Bandwidth Limit
                    </Typography>
                    <Typography variant="body2">{migConfig.bandwidthPerMigration}</Typography>
                  </Box>
                )}

                {migConfig.completionTimeoutPerGiB !== undefined && (
                  <Box mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Completion Timeout / GiB
                    </Typography>
                    <Typography variant="body2">{migConfig.completionTimeoutPerGiB}s</Typography>
                  </Box>
                )}

                {migConfig.progressTimeout !== undefined && (
                  <Box mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Progress Timeout
                    </Typography>
                    <Typography variant="body2">{migConfig.progressTimeout}s</Typography>
                  </Box>
                )}

                {migConfig.parallelMigrationsPerCluster !== undefined && (
                  <Box mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Parallel Migrations / Cluster
                    </Typography>
                    <Typography variant="body2">
                      {migConfig.parallelMigrationsPerCluster}
                    </Typography>
                  </Box>
                )}

                {migConfig.parallelOutboundMigrationsPerNode !== undefined && (
                  <Box mb={1} display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Parallel Outbound / Node
                    </Typography>
                    <Typography variant="body2">
                      {migConfig.parallelOutboundMigrationsPerNode}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Conditions */}
        <Grid item xs={12}>
          <ConditionsTable conditions={migration.status?.conditions} />
        </Grid>
      </Grid>
    </>
  );
}
