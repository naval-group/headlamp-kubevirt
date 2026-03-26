import { Icon } from '@iconify/react';
import { DialogTitle } from '@mui/material';
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import VirtualMachineClusterPreference from './VirtualMachineClusterPreference';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface CreatePreferenceProps {
  onClose: () => void;
}

export default function CreatePreference({ onClose }: CreatePreferenceProps) {
  const { enqueueSnackbar } = useSnackbar();

  // Basic Info
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [osType, setOsType] = useState('linux');

  // Device Preferences
  const [diskBus, setDiskBus] = useState('virtio');
  const [interfaceModel, setInterfaceModel] = useState('virtio');
  const [inputBus, setInputBus] = useState('');
  const [inputType, setInputType] = useState('');
  const [autoattachInput, setAutoattachInput] = useState(false);
  const [diskDedicatedIo, setDiskDedicatedIo] = useState(false);

  // Firmware
  const [useEfi, setUseEfi] = useState(false);
  const [useSecureBoot, setUseSecureBoot] = useState(false);
  const [useSmm, setUseSmm] = useState(false);

  // Minimum Requirements
  const [hasMinRequirements, setHasMinRequirements] = useState(false);
  const [minCpu, setMinCpu] = useState('1');
  const [minMemory, setMinMemory] = useState('1');
  const [minMemoryUnit, setMinMemoryUnit] = useState('Gi');

  const handleCreate = async () => {
    if (!name) {
      enqueueSnackbar('Name is required', { variant: 'error' });
      return;
    }

    const spec: KubeResourceBuilder = {
      annotations: {
        'vm.kubevirt.io/os': osType,
      },
      devices: {
        preferredDiskBus: diskBus,
        preferredInterfaceModel: interfaceModel,
        preferredRng: {},
      },
    };

    if (diskDedicatedIo) {
      spec.devices.preferredDiskDedicatedIoThread = true;
    }

    if (autoattachInput) {
      spec.devices.preferredAutoattachInputDevice = true;
    }

    if (inputBus) {
      spec.devices.preferredInputBus = inputBus;
    }

    if (inputType) {
      spec.devices.preferredInputType = inputType;
    }

    // Firmware
    if (useEfi || useSecureBoot) {
      spec.firmware = {};
      if (useEfi || useSecureBoot) {
        spec.firmware.preferredEfi = {};
        if (useSecureBoot) {
          spec.firmware.preferredEfi.secureBoot = true;
        }
      }
    }

    if (useSmm) {
      spec.features = {
        preferredSmm: {},
      };
    }

    // Requirements
    if (hasMinRequirements) {
      spec.requirements = {
        cpu: {
          guest: parseInt(minCpu),
        },
        memory: {
          guest: `${minMemory}${minMemoryUnit}`,
        },
      };
    }

    const annotations: Record<string, string> = {};
    if (displayName) {
      annotations['openshift.io/display-name'] = displayName;
    }

    const payload = {
      apiVersion: 'instancetype.kubevirt.io/v1beta1',
      kind: 'VirtualMachineClusterPreference',
      metadata: {
        name,
        ...(Object.keys(annotations).length > 0 && { annotations }),
      },
      spec,
    };

    try {
      await VirtualMachineClusterPreference.apiEndpoint.post(payload);
      enqueueSnackbar(`Preference ${name} created successfully`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      console.error('Failed to create Preference:', error);
      enqueueSnackbar('Failed to create Preference.', {
        variant: 'error',
      });
    }
  };

  return (
    <>
      <DialogTitle>Create Preference</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          {/* Basic Information */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Icon icon="mdi:information-outline" />
              <Typography variant="h6">Basic Information</Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  required
                  label="Name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  helperText="Unique identifier for this preference (e.g., my.custom.os)"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Display Name"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  helperText="Human-readable name (e.g., My Custom OS)"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  select
                  label="OS Type"
                  value={osType}
                  onChange={e => setOsType(e.target.value)}
                  helperText="Operating system type for this preference"
                >
                  <MenuItem value="linux">Linux</MenuItem>
                  <MenuItem value="windows">Windows</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </Box>

          <Divider />

          {/* Device Preferences */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Icon icon="mdi:devices" />
              <Typography variant="h6">Device Preferences</Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  select
                  label="Disk Bus"
                  value={diskBus}
                  onChange={e => setDiskBus(e.target.value)}
                  helperText="Preferred disk bus type"
                >
                  <MenuItem value="virtio">VirtIO</MenuItem>
                  <MenuItem value="sata">SATA</MenuItem>
                  <MenuItem value="scsi">SCSI</MenuItem>
                </TextField>
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  select
                  label="Network Interface Model"
                  value={interfaceModel}
                  onChange={e => setInterfaceModel(e.target.value)}
                  helperText="Preferred network interface model"
                >
                  <MenuItem value="virtio">VirtIO</MenuItem>
                  <MenuItem value="e1000e">E1000e</MenuItem>
                  <MenuItem value="rtl8139">RTL8139</MenuItem>
                </TextField>
              </Grid>

              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={diskDedicatedIo}
                      onChange={e => setDiskDedicatedIo(e.target.checked)}
                    />
                  }
                  label="Disk Dedicated IO Thread"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Use dedicated IO threads for disk operations
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoattachInput}
                      onChange={e => setAutoattachInput(e.target.checked)}
                    />
                  }
                  label="Auto-attach Input Device"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Automatically attach input devices (keyboard, mouse)
                </Typography>
              </Grid>

              {autoattachInput && (
                <>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      select
                      label="Input Bus"
                      value={inputBus}
                      onChange={e => setInputBus(e.target.value)}
                    >
                      <MenuItem value="">Default</MenuItem>
                      <MenuItem value="virtio">VirtIO</MenuItem>
                      <MenuItem value="usb">USB</MenuItem>
                    </TextField>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      select
                      label="Input Type"
                      value={inputType}
                      onChange={e => setInputType(e.target.value)}
                    >
                      <MenuItem value="">Default</MenuItem>
                      <MenuItem value="tablet">Tablet</MenuItem>
                      <MenuItem value="mouse">Mouse</MenuItem>
                    </TextField>
                  </Grid>
                </>
              )}
            </Grid>
          </Box>

          <Divider />

          {/* Firmware */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Icon icon="mdi:chip" />
              <Typography variant="h6">Firmware</Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={useEfi} onChange={e => setUseEfi(e.target.checked)} />}
                  label="Use EFI Boot"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Use UEFI firmware instead of BIOS
                </Typography>
              </Grid>

              {useEfi && (
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={useSecureBoot}
                        onChange={e => setUseSecureBoot(e.target.checked)}
                      />
                    }
                    label="Enable Secure Boot"
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ ml: 4 }}
                  >
                    Enable UEFI Secure Boot (requires EFI)
                  </Typography>
                </Grid>
              )}

              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={useSmm} onChange={e => setUseSmm(e.target.checked)} />}
                  label="Enable SMM (System Management Mode)"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Required for Windows guests with Secure Boot
                </Typography>
              </Grid>
            </Grid>
          </Box>

          <Divider />

          {/* Minimum Requirements */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Icon icon="mdi:alert-circle-outline" />
              <Typography variant="h6">Minimum Requirements</Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={hasMinRequirements}
                      onChange={e => setHasMinRequirements(e.target.checked)}
                    />
                  }
                  label="Specify Minimum Requirements"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Define minimum CPU and memory for VMs using this preference
                </Typography>
              </Grid>

              {hasMinRequirements && (
                <>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Minimum CPU Cores"
                      value={minCpu}
                      onChange={e => setMinCpu(e.target.value)}
                      inputProps={{ min: 1 }}
                    />
                  </Grid>

                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Minimum Memory"
                      value={minMemory}
                      onChange={e => setMinMemory(e.target.value)}
                      inputProps={{ min: 1 }}
                    />
                  </Grid>

                  <Grid item xs={12} sm={2}>
                    <TextField
                      fullWidth
                      select
                      label="Unit"
                      value={minMemoryUnit}
                      onChange={e => setMinMemoryUnit(e.target.value)}
                    >
                      <MenuItem value="Mi">Mi</MenuItem>
                      <MenuItem value="Gi">Gi</MenuItem>
                    </TextField>
                  </Grid>
                </>
              )}
            </Grid>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<Icon icon="mdi:check" />} onClick={handleCreate}>
          Create
        </Button>
      </DialogActions>
    </>
  );
}
