import { Icon } from '@iconify/react';
import { Tooltip } from '@mui/material';
import React from 'react';

interface InfoTooltipProps {
  text: string;
  size?: number;
}

export default function InfoTooltip({ text, size = 16 }: InfoTooltipProps) {
  return (
    <Tooltip title={text} arrow placement="top">
      <Icon
        icon="mdi:information-outline"
        width={size}
        style={{ color: '#9e9e9e', cursor: 'help', verticalAlign: 'middle', marginLeft: 4 }}
      />
    </Tooltip>
  );
}
