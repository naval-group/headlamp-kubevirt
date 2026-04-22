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
import { getOperator, OperatorInfo } from '../../utils/operatorRegistry';

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
}

const STATUS_CHIP: Record<
  OperatorStatus,
  { label: string; color: 'success' | 'default' | 'warning' | 'info' }
> = {
  installed: { label: 'Installed', color: 'success' },
  available: { label: 'Available', color: 'default' },
  'requires-deps': { label: 'Requires dependencies', color: 'warning' },
  checking: { label: 'Checking...', color: 'info' },
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
}: OperatorCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderColor: enabled ? 'primary.main' : 'divider',
        borderWidth: enabled ? 2 : 1,
        opacity: enabled ? 1 : 0.7,
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
          {status && (
            <Chip
              label={STATUS_CHIP[status].label}
              color={STATUS_CHIP[status].color}
              size="small"
              variant="outlined"
            />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.8rem' }}>
          {operator.details}
        </Typography>

        {operator.dependencies.length > 0 && (
          <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
            <Typography variant="caption" color="text.secondary">
              Requires:
            </Typography>
            {operator.dependencies.map(dep => (
              <Chip
                key={dep}
                label={getOperator(dep)?.name || dep}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            ))}
          </Box>
        )}

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

      <Box px={2} pb={1.5} display="flex" justifyContent="flex-end">
        <Tooltip
          title={
            locked
              ? `Required by other selected operators`
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
                />
              }
              label={enabled ? 'Enabled' : 'Disabled'}
              sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
            />
          </span>
        </Tooltip>
      </Box>
    </Card>
  );
}
