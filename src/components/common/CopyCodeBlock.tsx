import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';

interface CopyCodeBlockProps {
  title: string;
  code: string;
}

export default function CopyCodeBlock({ title, code }: CopyCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 0.5,
        }}
      >
        <Typography variant="caption" fontWeight={600}>
          {title}
        </Typography>
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton size="small" onClick={handleCopy}>
            <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} height={16} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{
          p: 1.5,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontSize: '0.8rem',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          m: 0,
        }}
      >
        {code}
      </Box>
    </Box>
  );
}
