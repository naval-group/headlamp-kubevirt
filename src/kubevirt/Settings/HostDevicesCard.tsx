import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import InfoTooltip from '../../components/common/InfoTooltip';
import { MediatedDevice, PciDevice, PermittedHostDevices } from '../../types';
import { isValidMdevSelector, isValidPciSelector, isValidResourceName } from '../../utils/sanitize';
import { TOOLTIPS } from '../../utils/tooltips';

// Generic device input section — used for both PCI and Mediated devices
function DeviceInputSection<
  T extends { resourceName: string; externalResourceProvider?: boolean }
>(props: {
  title: string;
  selectorLabel: string;
  selectorPlaceholder: string;
  selectorValue: string;
  selectorValid: (v: string) => boolean;
  selectorErrorText: string;
  resourcePlaceholder: string;
  newDevice: T;
  onSelectorChange: (v: string) => void;
  onResourceChange: (v: string) => void;
  onExternalChange: (v: boolean) => void;
  onAdd: () => void;
  devices: T[];
  onRemove: (idx: number) => void;
  onToggleExternal: (idx: number, checked: boolean) => void;
  displaySelector: (dev: T) => string;
}) {
  const {
    title,
    selectorLabel,
    selectorPlaceholder,
    selectorValue,
    selectorValid,
    selectorErrorText,
    resourcePlaceholder,
    newDevice,
    onSelectorChange,
    onResourceChange,
    onExternalChange,
    onAdd,
    devices,
    onRemove,
    onToggleExternal,
    displaySelector,
  } = props;

  return (
    <>
      <Typography variant="subtitle2" fontWeight={600} mt={1} mb={1}>
        {title}
      </Typography>
      <Box display="flex" gap={1} mb={1} alignItems="flex-start">
        <TextField
          size="small"
          label={selectorLabel}
          placeholder={selectorPlaceholder}
          value={selectorValue}
          onChange={e => onSelectorChange(e.target.value)}
          error={!!selectorValue && !selectorValid(selectorValue)}
          helperText={selectorValue && !selectorValid(selectorValue) ? selectorErrorText : ''}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Resource Name"
          placeholder={resourcePlaceholder}
          value={newDevice.resourceName}
          onChange={e => onResourceChange(e.target.value)}
          error={!!newDevice.resourceName && !isValidResourceName(newDevice.resourceName)}
          helperText={
            newDevice.resourceName && !isValidResourceName(newDevice.resourceName)
              ? 'Format: domain/name'
              : ''
          }
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={
            !selectorValue ||
            !newDevice.resourceName ||
            !selectorValid(selectorValue) ||
            !isValidResourceName(newDevice.resourceName)
          }
          onClick={onAdd}
          sx={{ mt: 0.5 }}
        >
          Add
        </Button>
      </Box>
      <Box display="flex" alignItems="center" mt={-1} mb={1}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={!!newDevice.externalResourceProvider}
              onChange={e => onExternalChange(e.target.checked)}
            />
          }
          label={
            <Box display="flex" alignItems="center" gap={0.5}>
              <Typography variant="body2">External Resource Provider</Typography>
              <InfoTooltip text={TOOLTIPS.externalResourceProvider} />
            </Box>
          }
        />
      </Box>
      {devices.length > 0 && (
        <Box mb={2}>
          {devices.map((dev, idx) => (
            <Box
              key={idx}
              display="flex"
              alignItems="center"
              gap={1}
              p={1}
              sx={{ backgroundColor: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px', mb: 0.5 }}
            >
              <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>
                {displaySelector(dev)}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>
                {dev.resourceName}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={!!dev.externalResourceProvider}
                    onChange={e => onToggleExternal(idx, e.target.checked)}
                  />
                }
                label={<Typography variant="body2">External</Typography>}
              />
              <IconButton size="small" color="error" onClick={() => onRemove(idx)}>
                <Icon icon="mdi:delete" width={18} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}

interface HostDevicesCardProps {
  initialPciDevices: PciDevice[];
  initialMediatedDevices: MediatedDevice[];
  updating: boolean;
  onUpdate: (permittedHostDevices?: PermittedHostDevices) => Promise<void>;
}

const HostDevicesCard = React.memo(function HostDevicesCard({
  initialPciDevices,
  initialMediatedDevices,
  updating,
  onUpdate,
}: HostDevicesCardProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [expanded, setExpanded] = useState(false);
  const [localPciDevices, setLocalPciDevices] = useState<PciDevice[]>(initialPciDevices);
  const [localMediatedDevices, setLocalMediatedDevices] =
    useState<MediatedDevice[]>(initialMediatedDevices);
  const [newPciDevice, setNewPciDevice] = useState<PciDevice>({
    pciVendorSelector: '',
    resourceName: '',
    externalResourceProvider: false,
  });
  const [newMediatedDevice, setNewMediatedDevice] = useState<MediatedDevice>({
    mdevNameSelector: '',
    resourceName: '',
    externalResourceProvider: false,
  });

  const handleApply = async () => {
    const permittedHostDevices: PermittedHostDevices = {};
    if (localPciDevices.length > 0) permittedHostDevices.pciHostDevices = localPciDevices;
    if (localMediatedDevices.length > 0)
      permittedHostDevices.mediatedDevices = localMediatedDevices;
    try {
      await onUpdate(
        Object.keys(permittedHostDevices).length > 0 ? permittedHostDevices : undefined
      );
      enqueueSnackbar('Host devices configuration updated successfully', { variant: 'success' });
    } catch {
      enqueueSnackbar('Failed to update host devices configuration.', { variant: 'error' });
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          mb={2}
          sx={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon
            icon="mdi:expansion-card"
            width={20}
            height={20}
            style={{ color: expanded ? '#2196f3' : '#9e9e9e' }}
          />
          <Typography variant="body1" fontWeight={500} flex={1}>
            Permitted Host Devices
          </Typography>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={20} height={20} />
        </Box>
        <Typography variant="body2" color="text.secondary" mb={1}>
          Configure PCI devices and mediated devices (vGPUs) that can be assigned to VMs
        </Typography>
        <Collapse in={expanded}>
          <DeviceInputSection<PciDevice>
            title="PCI Host Devices"
            selectorLabel="PCI Vendor Selector"
            selectorPlaceholder="e.g., 10de:1eb8"
            selectorValue={newPciDevice.pciVendorSelector}
            selectorValid={isValidPciSelector}
            selectorErrorText="Format: vendor:device (hex)"
            resourcePlaceholder="e.g., nvidia.com/GP102GL"
            newDevice={newPciDevice}
            onSelectorChange={v => setNewPciDevice({ ...newPciDevice, pciVendorSelector: v })}
            onResourceChange={v => setNewPciDevice({ ...newPciDevice, resourceName: v })}
            onExternalChange={v =>
              setNewPciDevice({ ...newPciDevice, externalResourceProvider: v })
            }
            onAdd={() => {
              setLocalPciDevices([...localPciDevices, { ...newPciDevice }]);
              setNewPciDevice({
                pciVendorSelector: '',
                resourceName: '',
                externalResourceProvider: false,
              });
            }}
            devices={localPciDevices}
            onRemove={idx => setLocalPciDevices(localPciDevices.filter((_, i) => i !== idx))}
            onToggleExternal={(idx, checked) =>
              setLocalPciDevices(
                localPciDevices.map((d, i) =>
                  i === idx ? { ...d, externalResourceProvider: checked } : d
                )
              )
            }
            displaySelector={dev => dev.pciVendorSelector}
          />

          <Divider sx={{ my: 2 }} />

          <DeviceInputSection<MediatedDevice>
            title="Mediated Devices (vGPU)"
            selectorLabel="MDEV Name Selector"
            selectorPlaceholder="e.g., GRID T4-2Q"
            selectorValue={newMediatedDevice.mdevNameSelector}
            selectorValid={isValidMdevSelector}
            selectorErrorText="Invalid MDEV selector"
            resourcePlaceholder="e.g., nvidia.com/GRID_T4-2Q"
            newDevice={newMediatedDevice}
            onSelectorChange={v =>
              setNewMediatedDevice({ ...newMediatedDevice, mdevNameSelector: v })
            }
            onResourceChange={v => setNewMediatedDevice({ ...newMediatedDevice, resourceName: v })}
            onExternalChange={v =>
              setNewMediatedDevice({ ...newMediatedDevice, externalResourceProvider: v })
            }
            onAdd={() => {
              setLocalMediatedDevices([...localMediatedDevices, { ...newMediatedDevice }]);
              setNewMediatedDevice({
                mdevNameSelector: '',
                resourceName: '',
                externalResourceProvider: false,
              });
            }}
            devices={localMediatedDevices}
            onRemove={idx =>
              setLocalMediatedDevices(localMediatedDevices.filter((_, i) => i !== idx))
            }
            onToggleExternal={(idx, checked) =>
              setLocalMediatedDevices(
                localMediatedDevices.map((d, i) =>
                  i === idx ? { ...d, externalResourceProvider: checked } : d
                )
              )
            }
            displaySelector={dev => dev.mdevNameSelector}
          />

          <Box display="flex" justifyContent="flex-end" gap={1} mt={2}>
            <Button variant="outlined" size="small" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleApply}
              disabled={updating}
              sx={{ backgroundColor: '#4caf50', '&:hover': { backgroundColor: '#45a049' } }}
            >
              Apply
            </Button>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
});

export default HostDevicesCard;
