import { Icon } from '@iconify/react';
import { Box, ButtonBase, Typography } from '@mui/material';

interface CatalogButtonProps {
  onClick: () => void;
}

export default function CatalogButton({ onClick }: CatalogButtonProps) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        p: 2,
        borderRadius: 1,
        border: '1px dashed',
        borderColor: 'primary.main',
        bgcolor: theme =>
          theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        textAlign: 'left',
        transition: 'all 0.2s',
        '&:hover': {
          bgcolor: theme =>
            theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.16)' : 'rgba(33, 150, 243, 0.08)',
          borderStyle: 'solid',
        },
      }}
    >
      <Icon icon="mdi:bookshelf" width={36} height={36} color="#2196f3" />
      <Box>
        <Typography variant="subtitle2" fontWeight="bold" color="primary">
          Browse Image Catalog
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Pick from Fedora, Ubuntu, Debian, CentOS, Alpine and more
        </Typography>
      </Box>
      <Icon icon="mdi:chevron-right" width={24} style={{ marginLeft: 'auto', opacity: 0.5 }} />
    </ButtonBase>
  );
}
