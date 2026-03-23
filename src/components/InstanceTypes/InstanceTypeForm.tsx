import {
  Box,
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

interface InstanceTypeFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function InstanceTypeForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: InstanceTypeFormProps) {
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

  const updateCPU = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        cpu: {
          ...resource.spec.cpu,
          ...updates,
        },
      },
    });
  };

  const updateMemory = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        memory: {
          ...resource.spec.memory,
          ...updates,
        },
      },
    });
  };

  const updateSpec = (field: string, value: unknown) => {
    if (value === '' || value === undefined) {
      const newSpec = { ...resource.spec };
      delete newSpec[field];
      onChange({ ...resource, spec: newSpec });
    } else {
      onChange({
        ...resource,
        spec: {
          ...resource.spec,
          [field]: value,
        },
      });
    }
  };

  // Parse memory value and unit
  const memoryGuest = resource.spec?.memory?.guest;
  const memoryMatch = memoryGuest?.match?.(/^(\d+)(Mi|Gi)$/);
  const memoryValue = memoryMatch ? memoryMatch[1] : '';
  const memoryUnit = memoryMatch ? memoryMatch[2] : 'Gi';

  const handleMemoryChange = (value: string, unit: string) => {
    // Allow empty value temporarily
    if (value === '') {
      updateMemory({ guest: undefined });
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) {
        updateMemory({ guest: `${num}${unit}` });
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Basic Information */}
      <FormSection icon="mdi:information-outline" title="Basic Information" color="other">
        <Grid item xs={12} md={6}>
          <MandatoryTextField
            fullWidth
            label="Name"
            value={resource.metadata?.name || ''}
            onChange={e => updateMetadata('name', e.target.value)}
            showErrors={showErrors}
            helperText={
              editMode ? 'Name cannot be changed' : 'Unique identifier for this instance type'
            }
            placeholder="custom.large"
            disabled={editMode}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            label="Display Name"
            value={resource.metadata?.annotations?.['instancetype.kubevirt.io/displayName'] || ''}
            onChange={e => updateAnnotation('instancetype.kubevirt.io/displayName', e.target.value)}
            helperText="Human-readable name"
            placeholder="Custom Large"
          />
        </Grid>

        <Grid item xs={12}>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Description"
            value={resource.metadata?.annotations?.['instancetype.kubevirt.io/description'] || ''}
            onChange={e => updateAnnotation('instancetype.kubevirt.io/description', e.target.value)}
            helperText="Detailed description of this instance type"
          />
        </Grid>
      </FormSection>

      {/* CPU & Memory */}
      <FormSection icon="mdi:chip" title="CPU & Memory" color="compute">
        <Grid item xs={12} sm={4}>
          <MandatoryTextField
            fullWidth
            label="CPU Cores"
            value={resource.spec?.cpu?.guest ?? ''}
            onChange={e => {
              const val = e.target.value;
              if (val === '') {
                updateCPU({ guest: undefined });
              } else {
                const num = parseInt(val);
                if (!isNaN(num)) {
                  updateCPU({ guest: num });
                }
              }
            }}
            inputProps={{ min: 1, type: 'number' }}
            showErrors={showErrors}
            helperText="Number of virtual CPU cores"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <MandatoryTextField
            fullWidth
            label="Memory"
            value={memoryValue}
            onChange={e => handleMemoryChange(e.target.value, memoryUnit)}
            inputProps={{ min: 1, type: 'number' }}
            showErrors={showErrors}
            helperText="Amount of memory"
          />
        </Grid>

        <Grid item xs={12} sm={2}>
          <TextField
            fullWidth
            select
            label="Unit"
            value={memoryUnit}
            onChange={e => handleMemoryChange(memoryValue, e.target.value)}
          >
            <MenuItem value="Mi">Mi</MenuItem>
            <MenuItem value="Gi">Gi</MenuItem>
          </TextField>
        </Grid>
      </FormSection>

      {/* Advanced CPU Options */}
      <FormSection icon="mdi:cpu-64-bit" title="Advanced CPU Options" color="compute" noGrid>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={resource.spec?.cpu?.dedicatedCPUPlacement || false}
                onChange={e => updateCPU({ dedicatedCPUPlacement: e.target.checked || undefined })}
              />
            }
            label={
              <Box>
                <Typography>Dedicated CPU Placement</Typography>
                <Typography variant="caption" color="text.secondary">
                  Pins vCPUs to physical CPU cores for better performance
                </Typography>
              </Box>
            }
          />

          <FormControlLabel
            control={
              <Switch
                checked={resource.spec?.cpu?.isolateEmulatorThread || false}
                onChange={e => updateCPU({ isolateEmulatorThread: e.target.checked || undefined })}
              />
            }
            label={
              <Box>
                <Typography>Isolate Emulator Thread</Typography>
                <Typography variant="caption" color="text.secondary">
                  Runs emulator thread on separate core (requires dedicated CPU)
                </Typography>
              </Box>
            }
          />

          <TextField
            fullWidth
            select
            label="IO Threads Policy"
            value={resource.spec?.ioThreadsPolicy || ''}
            onChange={e => updateSpec('ioThreadsPolicy', e.target.value || undefined)}
            helperText="Controls how IO threads are allocated"
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="auto">Auto</MenuItem>
            <MenuItem value="shared">Shared</MenuItem>
          </TextField>
        </Box>
      </FormSection>

      {/* Memory Features */}
      <FormSection icon="mdi:memory" title="Memory Features" color="compute" noGrid>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!resource.spec?.memory?.hugepages}
                onChange={e => {
                  if (e.target.checked) {
                    updateMemory({ hugepages: { pageSize: '2Mi' } });
                  } else {
                    const newMemory = { ...resource.spec.memory };
                    delete newMemory.hugepages;
                    onChange({ ...resource, spec: { ...resource.spec, memory: newMemory } });
                  }
                }}
              />
            }
            label={
              <Box>
                <Typography>Use Hugepages</Typography>
                <Typography variant="caption" color="text.secondary">
                  Use larger memory pages for improved performance
                </Typography>
              </Box>
            }
          />

          {resource.spec?.memory?.hugepages && (
            <TextField
              fullWidth
              select
              label="Hugepages Size"
              value={resource.spec.memory.hugepages.pageSize || '2Mi'}
              onChange={e => updateMemory({ hugepages: { pageSize: e.target.value } })}
            >
              <MenuItem value="2Mi">2 MiB</MenuItem>
              <MenuItem value="1Gi">1 GiB</MenuItem>
            </TextField>
          )}
        </Box>
      </FormSection>
    </Box>
  );
}
