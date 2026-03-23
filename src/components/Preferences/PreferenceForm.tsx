import {
  Box,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import useResourceEditor from '../../hooks/useResourceEditor';
import FormSection from '../common/FormSection';
import MandatoryTextField from '../common/MandatoryTextField';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface PreferenceFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function PreferenceForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: PreferenceFormProps) {
  const { updateMetadata } = useResourceEditor(resource, onChange);

  const updateAnnotation = (key: string, value: string) => {
    const annotations = { ...resource.metadata?.annotations };
    if (value) {
      annotations[key] = value;
    } else {
      delete annotations[key];
    }
    onChange({
      ...resource,
      metadata: {
        ...resource.metadata,
        annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
      },
    });
  };

  const updateSpecAnnotation = (key: string, value: string) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        annotations: {
          ...resource.spec?.annotations,
          [key]: value,
        },
      },
    });
  };

  const updateDevices = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        devices: {
          ...resource.spec?.devices,
          ...updates,
        },
      },
    });
  };

  const updateFirmware = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        firmware: updates,
      },
    });
  };

  const updateFeatures = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        features: updates,
      },
    });
  };

  const updateRequirements = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        requirements: updates,
      },
    });
  };

  // Parse minimum requirements
  const hasMinRequirements = !!resource.spec?.requirements;
  const minCpu = resource.spec?.requirements?.cpu?.guest ?? '';
  const memoryGuest = resource.spec?.requirements?.memory?.guest;
  const memoryMatch = memoryGuest?.match?.(/^(\d+)(Mi|Gi)$/);
  const minMemory = memoryMatch ? memoryMatch[1] : '';
  const minMemoryUnit = memoryMatch ? memoryMatch[2] : 'Gi';

  const toggleMinRequirements = (enabled: boolean) => {
    if (enabled) {
      updateRequirements({
        cpu: { guest: 1 },
        memory: { guest: '1Gi' },
      });
    } else {
      const newSpec = { ...resource.spec };
      delete newSpec.requirements;
      onChange({ ...resource, spec: newSpec });
    }
  };

  const handleMinMemoryChange = (value: string, unit: string) => {
    // Allow empty value temporarily
    if (value === '') {
      updateRequirements({
        ...resource.spec.requirements,
        memory: { guest: undefined },
      });
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) {
        updateRequirements({
          ...resource.spec.requirements,
          memory: { guest: `${num}${unit}` },
        });
      }
    }
  };

  // Check if minimum requirement fields are empty for validation styling
  const isMinCPUEmpty =
    hasMinRequirements &&
    (!resource.spec?.requirements?.cpu?.guest || resource.spec?.requirements?.cpu?.guest === '');
  const isMinMemoryEmpty =
    hasMinRequirements &&
    (!resource.spec?.requirements?.memory?.guest ||
      resource.spec?.requirements?.memory?.guest === '' ||
      minMemory === '');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Basic Information */}
      <FormSection
        icon="mdi:information-outline"
        title="Basic Information"
        color="other"
        spacing={2}
      >
        <Grid item xs={12}>
          <MandatoryTextField
            fullWidth
            label="Name"
            value={resource.metadata?.name || ''}
            onChange={e => updateMetadata('name', e.target.value)}
            showErrors={showErrors}
            helperText={
              editMode
                ? 'Name cannot be changed'
                : 'Unique identifier for this preference (e.g., my.custom.os)'
            }
            disabled={editMode}
          />
        </Grid>

        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Display Name"
            value={resource.metadata?.annotations?.['openshift.io/display-name'] || ''}
            onChange={e => updateAnnotation('openshift.io/display-name', e.target.value)}
            helperText="Human-readable name (e.g., My Custom OS)"
          />
        </Grid>

        <Grid item xs={12}>
          <TextField
            fullWidth
            select
            label="OS Type"
            value={resource.spec?.annotations?.['vm.kubevirt.io/os'] || 'linux'}
            onChange={e => updateSpecAnnotation('vm.kubevirt.io/os', e.target.value)}
            helperText="Operating system type for this preference"
          >
            <MenuItem value="linux">Linux</MenuItem>
            <MenuItem value="windows">Windows</MenuItem>
          </TextField>
        </Grid>
      </FormSection>

      <Divider />

      {/* Device Preferences */}
      <FormSection icon="mdi:devices" title="Device Preferences" color="device" spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            select
            label="Disk Bus"
            value={resource.spec?.devices?.preferredDiskBus || 'virtio'}
            onChange={e => updateDevices({ preferredDiskBus: e.target.value })}
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
            value={resource.spec?.devices?.preferredInterfaceModel || 'virtio'}
            onChange={e => updateDevices({ preferredInterfaceModel: e.target.value })}
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
                checked={resource.spec?.devices?.preferredDiskDedicatedIoThread || false}
                onChange={e =>
                  updateDevices({ preferredDiskDedicatedIoThread: e.target.checked || undefined })
                }
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
                checked={resource.spec?.devices?.preferredAutoattachInputDevice || false}
                onChange={e =>
                  updateDevices({ preferredAutoattachInputDevice: e.target.checked || undefined })
                }
              />
            }
            label="Auto-attach Input Device"
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
            Automatically attach input devices (keyboard, mouse)
          </Typography>
        </Grid>
      </FormSection>

      <Divider />

      {/* Firmware */}
      <FormSection icon="mdi:chip" title="Firmware" color="device" spacing={2}>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Switch
                checked={!!resource.spec?.firmware?.preferredEfi}
                onChange={e => {
                  if (e.target.checked) {
                    updateFirmware({ preferredEfi: {} });
                  } else {
                    const newSpec = { ...resource.spec };
                    delete newSpec.firmware;
                    onChange({ ...resource, spec: newSpec });
                  }
                }}
              />
            }
            label="Use EFI Boot"
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
            Use UEFI firmware instead of BIOS
          </Typography>
        </Grid>

        {resource.spec?.firmware?.preferredEfi && (
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={resource.spec.firmware.preferredEfi.secureBoot || false}
                  onChange={e =>
                    updateFirmware({
                      preferredEfi: {
                        ...resource.spec.firmware.preferredEfi,
                        secureBoot: e.target.checked || undefined,
                      },
                    })
                  }
                />
              }
              label="Enable Secure Boot"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
              Enable UEFI Secure Boot (requires EFI)
            </Typography>
          </Grid>
        )}

        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Switch
                checked={!!resource.spec?.features?.preferredSmm}
                onChange={e => {
                  if (e.target.checked) {
                    updateFeatures({ preferredSmm: {} });
                  } else {
                    const newSpec = { ...resource.spec };
                    delete newSpec.features;
                    onChange({ ...resource, spec: newSpec });
                  }
                }}
              />
            }
            label="Enable SMM (System Management Mode)"
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
            Required for Windows guests with Secure Boot
          </Typography>
        </Grid>
      </FormSection>

      <Divider />

      {/* Minimum Requirements */}
      <FormSection
        icon="mdi:alert-circle-outline"
        title="Minimum Requirements"
        color="compute"
        spacing={2}
      >
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Switch
                checked={hasMinRequirements}
                onChange={e => toggleMinRequirements(e.target.checked)}
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
                label="Minimum CPU Cores"
                value={minCpu}
                onChange={e => {
                  const val = e.target.value;
                  if (val === '') {
                    updateRequirements({
                      ...resource.spec.requirements,
                      cpu: { guest: undefined },
                    });
                  } else {
                    const num = parseInt(val);
                    if (!isNaN(num)) {
                      updateRequirements({
                        ...resource.spec.requirements,
                        cpu: { guest: num },
                      });
                    }
                  }
                }}
                inputProps={{ min: 1, type: 'number' }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': {
                      borderColor: isMinCPUEmpty ? 'warning.main' : undefined,
                    },
                    '&:hover fieldset': {
                      borderColor: isMinCPUEmpty ? 'warning.dark' : undefined,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: isMinCPUEmpty ? 'warning.main' : undefined,
                    },
                  },
                }}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Minimum Memory"
                value={minMemory}
                onChange={e => handleMinMemoryChange(e.target.value, minMemoryUnit)}
                inputProps={{ min: 1, type: 'number' }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': {
                      borderColor: isMinMemoryEmpty ? 'warning.main' : undefined,
                    },
                    '&:hover fieldset': {
                      borderColor: isMinMemoryEmpty ? 'warning.dark' : undefined,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: isMinMemoryEmpty ? 'warning.main' : undefined,
                    },
                  },
                }}
              />
            </Grid>

            <Grid item xs={12} sm={2}>
              <TextField
                fullWidth
                select
                label="Unit"
                value={minMemoryUnit}
                onChange={e => handleMinMemoryChange(minMemory, e.target.value)}
              >
                <MenuItem value="Mi">Mi</MenuItem>
                <MenuItem value="Gi">Gi</MenuItem>
              </TextField>
            </Grid>
          </>
        )}
      </FormSection>
    </Box>
  );
}
