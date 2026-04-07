import { Icon } from '@iconify/react';
import { CircularProgress } from '@mui/material';

interface VMStatusConfig {
  bgcolor: string;
  color: string;
  icon: React.ReactElement;
}

const iconStyle = { verticalAlign: 'middle', marginTop: -2 };

export function getVMStatusConfig(status: string): VMStatusConfig {
  switch (status) {
    case 'Running':
      return {
        bgcolor: '#4caf50',
        color: '#000',
        icon: <Icon icon="mdi:play" width={16} style={iconStyle} />,
      };
    case 'Stopped':
      return {
        bgcolor: '#616161',
        color: '#fff',
        icon: <Icon icon="mdi:stop" width={16} style={iconStyle} />,
      };
    case 'Starting':
      return {
        bgcolor: '#c8e6c9',
        color: '#000',
        icon: <CircularProgress size={14} sx={{ color: '#000' }} />,
      };
    case 'Stopping':
      return {
        bgcolor: '#9e9e9e',
        color: '#fff',
        icon: <CircularProgress size={14} sx={{ color: '#fff' }} />,
      };
    case 'Migrating':
      return {
        bgcolor: '#bbdefb',
        color: '#000',
        icon: <CircularProgress size={14} sx={{ color: '#000' }} />,
      };
    case 'Paused':
      return {
        bgcolor: '#fff9c4',
        color: '#000',
        icon: <Icon icon="mdi:pause" width={16} style={iconStyle} />,
      };
    case 'Provisioning':
      return {
        bgcolor: '#b3e5fc',
        color: '#000',
        icon: <CircularProgress size={14} sx={{ color: '#000' }} />,
      };
    case 'Error':
    case 'CrashLoopBackOff':
    case 'ErrImagePull':
    case 'ImagePullBackOff':
      return {
        bgcolor: '#ef5350',
        color: '#000',
        icon: <Icon icon="mdi:alert-circle" width={16} style={iconStyle} />,
      };
    case 'ErrorUnschedulable':
    case 'WaitingForVolumeBinding':
      return {
        bgcolor: '#ff9800',
        color: '#000',
        icon: <Icon icon="mdi:alert" width={16} style={iconStyle} />,
      };
    default:
      return {
        bgcolor: '#757575',
        color: '#fff',
        icon: <Icon icon="mdi:help-circle-outline" width={16} style={iconStyle} />,
      };
  }
}
