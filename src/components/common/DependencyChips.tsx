import { Box, Chip, Typography } from '@mui/material';
import { getOperator } from '../../utils/operatorRegistry';

export default function DependencyChips({ dependencies }: { dependencies: string[] }) {
  if (dependencies.length === 0) return null;
  return (
    <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
      <Typography variant="caption" color="text.secondary">
        Requires:
      </Typography>
      {dependencies.map(dep => (
        <Chip
          key={dep}
          label={getOperator(dep)?.name || dep}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
      ))}
    </Box>
  );
}
