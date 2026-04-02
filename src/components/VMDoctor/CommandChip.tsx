import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import React, { useState } from 'react';

export interface CommandDef {
  label: string;
  command: string;
  requiresAgent?: boolean;
}

interface CommandChipProps {
  cmd: CommandDef;
  onExec: (command: string) => void;
  disabled?: boolean;
}

export default function CommandChip({ cmd, onExec, disabled = false }: CommandChipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(cmd.command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: disabled ? 'transparent' : 'action.hover',
        borderRadius: 1,
        px: 1,
        py: 0.5,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
        border: '1px solid transparent',
        opacity: disabled ? 0.45 : 1,
        ...(!disabled && {
          '&:hover': {
            bgcolor: 'action.selected',
            borderColor: 'divider',
          },
        }),
      }}
      onClick={disabled ? undefined : () => onExec(cmd.command)}
    >
      {!disabled && (
        <Icon icon="mdi:console-line" width={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      )}
      <Typography
        variant="caption"
        sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 500, flex: 1 }}
      >
        {cmd.label}
      </Typography>
      {disabled ? (
        <Tooltip title="QEMU Guest Agent is not connected" arrow placement="left">
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Icon icon="mdi:information-outline" width={14} style={{ opacity: 0.7 }} />
          </Box>
        </Tooltip>
      ) : (
        <IconButton
          size="small"
          onClick={handleCopy}
          sx={{ p: 0.25, flexShrink: 0 }}
          aria-label="Copy command"
        >
          <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={12} />
        </IconButton>
      )}
    </Box>
  );
}
