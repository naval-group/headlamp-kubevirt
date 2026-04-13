import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import InfoTooltip from '../../components/common/InfoTooltip';
import { MigrationConfig } from '../../types';
import { TOOLTIPS } from '../../utils/tooltips';

interface MigrationConfigCardProps {
  initialConfig: MigrationConfig;
  updating: boolean;
  onUpdate: (config: MigrationConfig) => Promise<void>;
}

const MigrationConfigCard = React.memo(function MigrationConfigCard({
  initialConfig,
  updating,
  onUpdate,
}: MigrationConfigCardProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [expanded, setExpanded] = useState(false);
  const [localConfig, setLocalConfig] = useState({
    parallelMigrationsPerCluster: initialConfig.parallelMigrationsPerCluster ?? '',
    parallelOutboundMigrationsPerNode: initialConfig.parallelOutboundMigrationsPerNode ?? '',
    bandwidthPerMigration: initialConfig.bandwidthPerMigration ?? '',
    network: initialConfig.network ?? '',
    progressTimeout: initialConfig.progressTimeout ?? '',
    completionTimeoutPerGiB: initialConfig.completionTimeoutPerGiB ?? '',
    allowAutoConverge: initialConfig.allowAutoConverge ?? false,
    allowPostCopy: initialConfig.allowPostCopy ?? false,
  });

  const handleApply = async () => {
    const config: Record<string, unknown> = {};
    if (localConfig.parallelMigrationsPerCluster !== '')
      config.parallelMigrationsPerCluster = parseInt(
        String(localConfig.parallelMigrationsPerCluster)
      );
    if (localConfig.parallelOutboundMigrationsPerNode !== '')
      config.parallelOutboundMigrationsPerNode = parseInt(
        String(localConfig.parallelOutboundMigrationsPerNode)
      );
    if (localConfig.bandwidthPerMigration)
      config.bandwidthPerMigration = localConfig.bandwidthPerMigration;
    if (localConfig.network) config.network = localConfig.network;
    if (localConfig.progressTimeout !== '')
      config.progressTimeout = parseInt(String(localConfig.progressTimeout));
    if (localConfig.completionTimeoutPerGiB !== '')
      config.completionTimeoutPerGiB = parseInt(String(localConfig.completionTimeoutPerGiB));
    config.allowAutoConverge = localConfig.allowAutoConverge;
    config.allowPostCopy = localConfig.allowPostCopy;
    try {
      await onUpdate(config as MigrationConfig);
      enqueueSnackbar('Migration configuration updated successfully', { variant: 'success' });
    } catch {
      enqueueSnackbar('Failed to update migration configuration.', { variant: 'error' });
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          mb={2}
          sx={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon
            icon="mdi:swap-horizontal"
            width={20}
            height={20}
            style={{ color: expanded ? '#2196f3' : '#9e9e9e' }}
          />
          <Typography variant="body1" fontWeight={500} flex={1}>
            Live Migration Configuration
          </Typography>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={20} height={20} />
        </Box>
        <Typography variant="body2" color="text.secondary" mb={1}>
          Configure live migration limits, bandwidth, timeouts, and strategies
        </Typography>
        <Collapse in={expanded}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Max Migrations per Cluster"
                type="number"
                size="small"
                placeholder="5"
                value={localConfig.parallelMigrationsPerCluster}
                onChange={e =>
                  setLocalConfig({ ...localConfig, parallelMigrationsPerCluster: e.target.value })
                }
                helperText="Maximum concurrent migrations cluster-wide"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Max Migrations per Node"
                type="number"
                size="small"
                placeholder="2"
                value={localConfig.parallelOutboundMigrationsPerNode}
                onChange={e =>
                  setLocalConfig({
                    ...localConfig,
                    parallelOutboundMigrationsPerNode: e.target.value,
                  })
                }
                helperText="Maximum outbound migrations per node"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Bandwidth per Migration"
                size="small"
                placeholder="0 (unlimited)"
                value={localConfig.bandwidthPerMigration}
                onChange={e =>
                  setLocalConfig({ ...localConfig, bandwidthPerMigration: e.target.value })
                }
                helperText="e.g., 64Mi, 1Gi"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Migration Network"
                size="small"
                placeholder="Leave empty for pod network"
                value={localConfig.network}
                onChange={e => setLocalConfig({ ...localConfig, network: e.target.value })}
                helperText="Dedicated network for migration traffic"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Progress Timeout"
                type="number"
                size="small"
                placeholder="150"
                value={localConfig.progressTimeout}
                onChange={e => setLocalConfig({ ...localConfig, progressTimeout: e.target.value })}
                helperText="Seconds before migration is cancelled if no progress"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Completion Timeout per GiB"
                type="number"
                size="small"
                placeholder="150"
                value={localConfig.completionTimeoutPerGiB}
                onChange={e =>
                  setLocalConfig({ ...localConfig, completionTimeoutPerGiB: e.target.value })
                }
                helperText="Seconds per GiB before migration times out"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!localConfig.allowAutoConverge}
                    onChange={e =>
                      setLocalConfig({ ...localConfig, allowAutoConverge: e.target.checked })
                    }
                    color="success"
                  />
                }
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    Allow Auto-Converge
                    <InfoTooltip text={TOOLTIPS.autoConverge} />
                  </Box>
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!localConfig.allowPostCopy}
                    onChange={e =>
                      setLocalConfig({ ...localConfig, allowPostCopy: e.target.checked })
                    }
                    color="success"
                  />
                }
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    Allow Post-Copy
                    <InfoTooltip text={TOOLTIPS.postCopy} />
                  </Box>
                }
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" justifyContent="flex-end" gap={1}>
                <Button variant="outlined" size="small" onClick={() => setExpanded(false)}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleApply}
                  disabled={updating}
                  sx={{ backgroundColor: '#4caf50', '&:hover': { backgroundColor: '#45a049' } }}
                >
                  Apply
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Collapse>
      </CardContent>
    </Card>
  );
});

export default MigrationConfigCard;
