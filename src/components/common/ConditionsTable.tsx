import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import { KubeCondition } from '../../types';

const cellSx = { p: 1, borderBottom: '1px solid rgba(224, 224, 224, 1)' } as const;
const headerSx = { ...cellSx, textAlign: 'left' } as const;

interface ConditionsTableProps {
  conditions: KubeCondition[] | undefined | null;
  title?: string;
}

export default function ConditionsTable({
  conditions,
  title = 'Conditions',
}: ConditionsTableProps) {
  return (
    <SectionBox title={title}>
      {conditions && conditions.length > 0 ? (
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
          <Box component="thead">
            <Box component="tr">
              {['Type', 'Status', 'Reason', 'Message', 'Last Transition'].map(h => (
                <Box key={h} component="th" sx={headerSx}>
                  {h}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {conditions.map((c: KubeCondition) => (
              <Box component="tr" key={c.type}>
                <Box component="td" sx={cellSx}>
                  {c.type}
                </Box>
                <Box component="td" sx={cellSx}>
                  <Chip
                    label={c.status}
                    size="small"
                    color={c.status === 'True' ? 'success' : 'default'}
                  />
                </Box>
                <Box component="td" sx={cellSx}>
                  {c.reason || '-'}
                </Box>
                <Box component="td" sx={cellSx}>
                  {c.message || '-'}
                </Box>
                <Box component="td" sx={cellSx}>
                  {c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '-'}
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
  );
}
