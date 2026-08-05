/**
 * Reusable card for displaying an operator in the wizard and marketplace.
 */

import { Icon } from '@iconify/react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { OperatorStatus } from '../../utils/operatorDetection';
import { OperatorInfo } from '../../utils/operatorRegistry';
import DependencyChips from '../common/DependencyChips';

interface OperatorCardProps {
  operator: OperatorInfo;
  enabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  version?: string;
  onVersionChange?: (id: string, version: string) => void;
  status?: OperatorStatus;
  /** If true, the toggle is disabled (dependency required by another enabled operator) */
  locked?: boolean;
  /** Show version editor */
  showVersion?: boolean;
  /** Hide the toggle (catalog mode) */
  readOnly?: boolean;
  /** Category color for the card border/background */
  categoryColor?: string;
  /** Whether this operator is managed by our Helm chart (vs externally installed) */
  managed?: boolean;
}

const STATUS_CHIP: Record<
  string,
  { label: string; color: 'success' | 'default' | 'warning' | 'info' | 'primary' }
> = {
  installed: { label: 'Installed', color: 'success' },
  'installed-external': { label: 'External', color: 'default' },
  staged: { label: 'Staged', color: 'primary' },
  available: { label: 'Available', color: 'info' },
  'requires-deps': { label: 'Requires dependencies', color: 'warning' },
  checking: { label: 'Checking...', color: 'default' },
};

export default function OperatorCard({
  operator,
  enabled,
  onToggle,
  version,
  onVersionChange,
  status,
  locked,
  showVersion,
  readOnly,
  categoryColor,
  managed,
}: OperatorCardProps) {
  const isInstalled = status === 'installed';
  const isStaged = !isInstalled && enabled;
  const effectiveStatus = isInstalled && managed === false ? 'installed-external' : status;
  const cc = categoryColor || 'divider';
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `3px solid ${cc}`,
        borderColor: isStaged ? cc : isInstalled ? cc : 'divider',
        borderLeftColor: cc,
        borderWidth: isStaged ? 2 : isInstalled ? 1 : 1,
        opacity: isInstalled ? 1 : isStaged ? 1 : 0.5,
        bgcolor: isStaged ? `${cc}15` : 'background.paper',
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ flex: 1, pb: 1 }}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Icon icon={operator.icon} width={28} />
          <Box flex={1}>
            <Typography variant="subtitle2" fontWeight={600}>
              {operator.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {operator.description}
            </Typography>
          </Box>
          {(() => {
            // Show "Staged" when enabled in wizard but not installed on cluster
            const displayStatus =
              effectiveStatus === 'installed-external'
                ? 'installed-external'
                : status === 'installed'
                ? 'installed'
                : enabled
                ? 'staged'
                : status;
            const chip = displayStatus ? STATUS_CHIP[displayStatus] : null;
            return chip ? (
              <Chip
                label={chip.label}
                color={chip.color}
                size="small"
                variant={displayStatus === 'installed' ? 'filled' : 'outlined'}
              />
            ) : null;
          })()}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.8rem' }}>
          {operator.details}
        </Typography>

        <DependencyChips dependencies={operator.dependencies} />

        {showVersion && (
          <TextField
            size="small"
            label="Version"
            value={version || operator.version}
            onChange={e => onVersionChange?.(operator.id, e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
            InputProps={{ sx: { fontSize: '0.8rem' } }}
          />
        )}
      </CardContent>

      {!readOnly && (
        <Box px={2} pb={1.5} display="flex" justifyContent="flex-end">
          <Tooltip
            title={
              status === 'installed'
                ? 'Already installed on this cluster'
                : locked
                ? 'Required by other selected operators'
                : operator.id === 'kubevirt' || operator.id === 'cdi'
                ? `${operator.name} is always required`
                : ''
            }
          >
            <span>
              <FormControlLabel
                control={
                  <Switch
                    checked={enabled}
                    onChange={(_, checked) => onToggle(operator.id, checked)}
                    disabled={locked || operator.id === 'kubevirt' || operator.id === 'cdi'}
                    size="small"
                    color="success"
                  />
                }
                label={enabled ? 'Enabled' : 'Disabled'}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
              />
            </span>
          </Tooltip>
        </Box>
      )}
    </Card>
  );
}
