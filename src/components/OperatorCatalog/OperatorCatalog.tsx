import { Icon } from '@iconify/react';
import { SectionBox, SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Grid,
  IconButton,
  Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import { useOperatorDetection } from '../../utils/operatorDetection';
import {
  CATEGORY_COLORS,
  getOperatorsByCategory,
  OperatorCategory,
  OperatorInfo,
} from '../../utils/operatorRegistry';
import DependencyChips from '../common/DependencyChips';
import { getPluginLib } from '../OwnerLinks';

const CATEGORY_META: Record<OperatorCategory, { label: string; icon: string }> = {
  core: { label: 'Core', icon: 'mdi:server' },
  networking: { label: 'Networking', icon: 'mdi:lan' },
  storage: { label: 'Storage', icon: 'mdi:harddisk' },
  migration: { label: 'Migration', icon: 'mdi:airplane' },
  extras: { label: 'Extras', icon: 'mdi:puzzle' },
};

const CATEGORY_ORDER: OperatorCategory[] = ['core', 'networking', 'storage', 'migration', 'extras'];

function useNavigateToWizard() {
  const lib = getPluginLib();
  const history = lib?.ReactRouter?.useHistory();
  return useCallback(
    (operatorId?: string) => {
      // Extract the cluster prefix from current URL (e.g. /c/baremetal-new)
      const hash = window.location.hash || '';
      const match = hash.match(/#(\/c\/[^/]+)/);
      const clusterPrefix = match ? match[1] : '';
      const path = operatorId
        ? `${clusterPrefix}/kubevirt/install-wizard?enable=${operatorId}`
        : `${clusterPrefix}/kubevirt/install-wizard`;
      if (history) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (history as any).push(path);
      }
    },
    [history]
  );
}

function OperatorTile({
  operator,
  installed,
  categoryColor,
  onInstall,
}: {
  operator: OperatorInfo;
  installed: boolean;
  categoryColor: string;
  onInstall: (id: string) => void;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `3px solid ${categoryColor}`,
        borderColor: installed ? categoryColor : 'divider',
        borderLeftColor: categoryColor,
        opacity: installed ? 1 : 0.65,
        transition: 'all 0.2s',
        '&:hover': { opacity: 1, borderColor: categoryColor },
      }}
    >
      <CardContent sx={{ flex: 1, pb: 1 }}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Icon icon={operator.icon} width={24} />
          <Box flex={1} minWidth={0}>
            <Typography variant="subtitle2" fontWeight={600} noWrap>
              {operator.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {operator.description}
            </Typography>
          </Box>
          <Chip
            label={installed ? 'Installed' : 'Available'}
            color={installed ? 'success' : 'info'}
            size="small"
            variant={installed ? 'filled' : 'outlined'}
          />
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1, fontSize: '0.8rem', lineHeight: 1.4 }}
        >
          {operator.details}
        </Typography>

        <DependencyChips dependencies={operator.dependencies} />
      </CardContent>

      {!installed && (
        <Box px={2} pb={1.5} display="flex" justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => onInstall(operator.id)}
          >
            Install
          </Button>
        </Box>
      )}
    </Card>
  );
}

function CategorySection({
  category,
  operators,
  detection,
  onInstall,
}: {
  category: OperatorCategory;
  operators: OperatorInfo[];
  detection: ReturnType<typeof useOperatorDetection>;
  onInstall: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = CATEGORY_META[category];
  const installedCount = operators.filter(
    op => detection.operators[op.id]?.status === 'installed'
  ).length;

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          cursor: 'pointer',
          py: 1,
          px: 1.5,
          borderRadius: 1,
          borderLeft: `3px solid ${CATEGORY_COLORS[category]}`,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Icon icon={meta.icon} width={22} color={CATEGORY_COLORS[category]} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {meta.label}
        </Typography>
        <Chip
          size="small"
          label={`${installedCount}/${operators.length}`}
          sx={{
            bgcolor:
              installedCount === operators.length
                ? `${CATEGORY_COLORS[category]}22`
                : 'transparent',
            color: CATEGORY_COLORS[category],
            borderColor: CATEGORY_COLORS[category],
            fontWeight: 600,
          }}
          variant="outlined"
        />
        <IconButton size="small">
          <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Grid container spacing={2} sx={{ mt: 0.5, pl: 1 }}>
          {operators.map(op => (
            <Grid item xs={12} sm={6} md={4} key={op.id}>
              <OperatorTile
                operator={op}
                installed={detection.operators[op.id]?.status === 'installed'}
                categoryColor={CATEGORY_COLORS[category]}
                onInstall={onInstall}
              />
            </Grid>
          ))}
        </Grid>
      </Collapse>
    </Box>
  );
}

export default function OperatorCatalog() {
  const detection = useOperatorDetection();
  const grouped = getOperatorsByCategory();
  const navigateToWizard = useNavigateToWizard();

  const totalOperators = Object.values(grouped).reduce((sum, ops) => sum + ops.length, 0);
  const totalInstalled = Object.values(detection.operators).filter(
    s => s.status === 'installed'
  ).length;

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Operator Catalog"
          titleSideActions={[
            <Chip
              key="summary"
              icon={<Icon icon="mdi:check-circle" />}
              label={`${totalInstalled}/${totalOperators} installed`}
              color={totalInstalled === totalOperators ? 'success' : 'default'}
              variant="outlined"
            />,
            <Button
              key="wizard"
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:rocket-launch" />}
              onClick={() => navigateToWizard()}
            >
              Install Wizard
            </Button>,
          ]}
        />
      }
    >
      {detection.loading ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:loading" width={32} className="spin" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Detecting installed operators...
          </Typography>
        </Box>
      ) : (
        CATEGORY_ORDER.filter(cat => grouped[cat].length > 0).map(cat => (
          <CategorySection
            key={cat}
            category={cat}
            operators={grouped[cat]}
            detection={detection}
            onInstall={navigateToWizard}
          />
        ))
      )}
    </SectionBox>
  );
}
