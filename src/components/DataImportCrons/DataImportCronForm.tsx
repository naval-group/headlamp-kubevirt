import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import useResourceEditor from '../../hooks/useResourceEditor';
import { KubeListResponse } from '../../types';
import FormSection from '../common/FormSection';
import MandatoryTextField from '../common/MandatoryTextField';
import { CRON_PRESETS, parseCronExpression } from './cronUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface KubeNamedItem {
  metadata: { name: string };
}

interface DataImportCronFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function DataImportCronForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: DataImportCronFormProps) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<string[]>([]);
  const { updateMetadata, updateSpec } = useResourceEditor(resource, onChange);

  const updateLabel = (key: string, value: string) => {
    const labels = { ...resource.metadata?.labels };
    if (value) {
      labels[key] = value;
    } else {
      delete labels[key];
    }
    onChange({
      ...resource,
      metadata: { ...resource.metadata, labels },
    });
  };

  // Schedule mode: preset or custom
  const presetValues = CRON_PRESETS.map(p => p.value);
  const currentSchedule = resource.spec?.schedule || '0 0 * * *';
  const isCurrentSchedulePreset = presetValues.includes(currentSchedule);
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom'>(
    isCurrentSchedulePreset ? 'preset' : 'custom'
  );

  // Auto-switch to custom mode if schedule doesn't match any preset (e.g. edit mode)
  useEffect(() => {
    const schedule = resource.spec?.schedule;
    if (schedule && !presetValues.includes(schedule) && scheduleMode === 'preset') {
      setScheduleMode('custom');
    }
  }, [resource.spec?.schedule]);

  // Fetch namespaces and storage classes
  useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const nsList = response?.items?.map(ns => ns.metadata.name) || [];
        setNamespaces(nsList);
      })
      .catch(err => console.error('Failed to fetch namespaces:', err));

    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const scList = response?.items?.map(sc => sc.metadata.name) || [];
        setStorageClasses(scList);
      })
      .catch(err => console.error('Failed to fetch storage classes:', err));

    ApiProxy.request('/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterpreferences')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const prefList = response?.items?.map(p => p.metadata.name) || [];
        setPreferences(prefList);
      })
      .catch(err => console.error('Failed to fetch preferences:', err));
  }, []);

  const updateGarbageCollect = (value: string) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        garbageCollect: value,
      },
    });
  };

  const updateSource = (sourceType: string, sourceData: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            source: {
              [sourceType]: sourceData,
            },
          },
        },
      },
    });
  };

  const updateStorage = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            storage: {
              ...resource.spec?.template?.spec?.storage,
              ...updates,
            },
          },
        },
      },
    });
  };

  // Parse storage size
  const storageSize = resource.spec?.template?.spec?.storage?.resources?.requests?.storage;
  const storageSizeMatch = storageSize?.match(/^(\d+)(Gi|Mi|Ti)$/);
  const storageSizeValue = storageSizeMatch ? storageSizeMatch[1] : '';
  const storageSizeUnit = storageSizeMatch ? storageSizeMatch[2] : 'Gi';

  const handleStorageSizeChange = (value: string, unit: string) => {
    if (value === '') {
      updateStorage({
        resources: {
          requests: {
            storage: undefined,
          },
        },
      });
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) {
        updateStorage({
          resources: {
            requests: {
              storage: `${num}${unit}`,
            },
          },
        });
      }
    }
  };

  // Get source type from template.spec.source
  const templateSource = resource.spec?.template?.spec?.source;
  const sourceType = templateSource ? Object.keys(templateSource)[0] : 'registry';

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
            helperText={editMode ? 'Name cannot be changed' : 'Unique name for the DataImportCron'}
            disabled={editMode}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <MandatoryTextField
            fullWidth
            select
            label="Namespace"
            value={resource.metadata?.namespace || 'default'}
            onChange={e => updateMetadata('namespace', e.target.value)}
            showErrors={showErrors}
            helperText={
              editMode ? 'Namespace cannot be changed' : 'Namespace for the DataImportCron'
            }
            disabled={editMode}
          >
            {namespaces.map(ns => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </MandatoryTextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <MandatoryTextField
            fullWidth
            label="Managed DataSource"
            value={resource.spec?.managedDataSource || ''}
            onChange={e => updateSpec({ managedDataSource: e.target.value })}
            showErrors={showErrors}
            helperText="Name of the DataSource to manage"
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            label="Operating System"
            value={resource.metadata?.labels?.['os.template.kubevirt.io/name'] || ''}
            onChange={e => updateLabel('os.template.kubevirt.io/name', e.target.value)}
            helperText="OS name (propagated to managed DataSource)"
            placeholder="e.g. fedora, ubuntu, windows"
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            select
            label="Default Preference"
            value={resource.metadata?.labels?.['instancetype.kubevirt.io/default-preference'] || ''}
            onChange={e =>
              updateLabel('instancetype.kubevirt.io/default-preference', e.target.value)
            }
            helperText="Default VirtualMachineClusterPreference for VMs using this source"
          >
            <MenuItem value="">None</MenuItem>
            {preferences.map(p => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <FormControl component="fieldset" fullWidth>
            <FormLabel component="legend" sx={{ mb: 0.5, fontSize: '0.85rem' }}>
              Schedule
            </FormLabel>
            <RadioGroup
              row
              value={scheduleMode}
              onChange={e => {
                const mode = e.target.value as 'preset' | 'custom';
                setScheduleMode(mode);
                if (mode === 'preset') {
                  // Reset to a default preset if current value isn't one
                  if (!presetValues.includes(currentSchedule)) {
                    updateSpec({ schedule: '0 0 * * *' });
                  }
                }
              }}
              sx={{ mb: 1 }}
            >
              <FormControlLabel value="preset" control={<Radio size="small" />} label="Preset" />
              <FormControlLabel value="custom" control={<Radio size="small" />} label="Custom" />
            </RadioGroup>

            {scheduleMode === 'preset' ? (
              <MandatoryTextField
                fullWidth
                select
                label="Cron Preset"
                value={currentSchedule}
                onChange={e => updateSpec({ schedule: e.target.value })}
                showErrors={showErrors}
                helperText="Select a predefined schedule"
                size="small"
              >
                {CRON_PRESETS.map(preset => (
                  <MenuItem key={preset.value} value={preset.value}>
                    {preset.label} ({preset.value})
                  </MenuItem>
                ))}
              </MandatoryTextField>
            ) : (
              <MandatoryTextField
                fullWidth
                label="Cron Expression"
                value={currentSchedule}
                onChange={e => updateSpec({ schedule: e.target.value })}
                placeholder="*/3 * * * *"
                showErrors={showErrors}
                helperText={parseCronExpression(currentSchedule)}
                size="small"
              />
            )}
          </FormControl>
        </Grid>
      </FormSection>

      {/* Garbage Collection */}
      <FormSection icon="mdi:delete-sweep" title="Garbage Collection" color="migration">
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            select
            label="Garbage Collect"
            value={resource.spec?.garbageCollect || 'Outdated'}
            onChange={e => updateGarbageCollect(e.target.value)}
            helperText="When to garbage collect old imports"
          >
            <MenuItem value="Outdated">Outdated</MenuItem>
            <MenuItem value="Never">Never</MenuItem>
          </TextField>
        </Grid>

        {(resource.spec?.garbageCollect || 'Outdated') === 'Outdated' && (
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Imports to Keep"
              value={resource.spec?.importsToKeep ?? ''}
              onChange={e => {
                const val = e.target.value;
                if (val === '') {
                  updateSpec({ importsToKeep: undefined });
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num)) {
                    updateSpec({ importsToKeep: num });
                  }
                }
              }}
              inputProps={{ min: 0, type: 'number' }}
              helperText="Number of old imports to keep"
            />
          </Grid>
        )}
      </FormSection>

      {/* Source Configuration */}
      <FormSection icon="mdi:source-branch" title="Source Configuration" color="storage">
        <Grid item xs={12}>
          <FormControl>
            <FormLabel>Source Type</FormLabel>
            <RadioGroup
              row
              value={sourceType}
              onChange={e => {
                const type = e.target.value;
                if (type === 'registry') {
                  updateSource('registry', { url: '' });
                } else if (type === 'http') {
                  updateSource('http', { url: '' });
                } else if (type === 's3') {
                  updateSource('s3', { url: '' });
                } else if (type === 'blank') {
                  updateSource('blank', {});
                }
              }}
            >
              <FormControlLabel value="registry" control={<Radio />} label="Container Registry" />
              <FormControlLabel value="http" control={<Radio />} label="HTTP" />
              <FormControlLabel value="s3" control={<Radio />} label="S3" />
              <FormControlLabel value="blank" control={<Radio />} label="Blank" />
            </RadioGroup>
          </FormControl>
        </Grid>

        {sourceType === 'registry' && (
          <Grid item xs={12}>
            <MandatoryTextField
              fullWidth
              label="Registry URL"
              value={resource.spec?.template?.spec?.source?.registry?.url || ''}
              onChange={e =>
                updateSource('registry', {
                  ...resource.spec?.template?.spec?.source?.registry,
                  url: e.target.value,
                })
              }
              placeholder="docker://registry.example.com/image:tag"
              showErrors={showErrors}
              helperText="Container image URL (docker:// or oci-archive://)"
            />
          </Grid>
        )}

        {sourceType === 'http' && (
          <Grid item xs={12}>
            <MandatoryTextField
              fullWidth
              label="HTTP URL"
              value={resource.spec?.template?.spec?.source?.http?.url || ''}
              onChange={e =>
                updateSource('http', {
                  ...resource.spec?.template?.spec?.source?.http,
                  url: e.target.value,
                })
              }
              placeholder="https://example.com/image.img"
              showErrors={showErrors}
              helperText="HTTP(S) URL to the disk image"
            />
          </Grid>
        )}

        {sourceType === 's3' && (
          <Grid item xs={12}>
            <MandatoryTextField
              fullWidth
              label="S3 URL"
              value={resource.spec?.template?.spec?.source?.s3?.url || ''}
              onChange={e =>
                updateSource('s3', {
                  ...resource.spec?.template?.spec?.source?.s3,
                  url: e.target.value,
                })
              }
              placeholder="s3://bucket/path/to/image.img"
              showErrors={showErrors}
              helperText="S3 URL to the disk image"
            />
          </Grid>
        )}
      </FormSection>

      {/* Storage Configuration */}
      <FormSection icon="mdi:harddisk" title="Storage Configuration" color="storage">
        <Grid item xs={12} sm={6}>
          <MandatoryTextField
            fullWidth
            label="Storage Size"
            value={storageSizeValue}
            onChange={e => handleStorageSizeChange(e.target.value, storageSizeUnit)}
            inputProps={{ min: 1, type: 'number' }}
            showErrors={showErrors}
            helperText="Size of the storage volume"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            select
            label="Unit"
            value={storageSizeUnit}
            onChange={e => handleStorageSizeChange(storageSizeValue, e.target.value)}
          >
            <MenuItem value="Mi">Mi</MenuItem>
            <MenuItem value="Gi">Gi</MenuItem>
            <MenuItem value="Ti">Ti</MenuItem>
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            select
            label="Storage Class"
            value={resource.spec?.template?.spec?.storage?.storageClassName || ''}
            onChange={e => updateStorage({ storageClassName: e.target.value || undefined })}
            helperText="Storage class for the PVC"
          >
            <MenuItem value="">Default</MenuItem>
            {storageClasses.map(sc => (
              <MenuItem key={sc} value={sc}>
                {sc}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            select
            label="Access Mode"
            value={resource.spec?.template?.spec?.storage?.accessModes?.[0] || 'ReadWriteOnce'}
            onChange={e => updateStorage({ accessModes: [e.target.value] })}
            helperText="Volume access mode"
          >
            <MenuItem value="ReadWriteOnce">ReadWriteOnce</MenuItem>
            <MenuItem value="ReadWriteMany">ReadWriteMany</MenuItem>
            <MenuItem value="ReadOnlyMany">ReadOnlyMany</MenuItem>
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            select
            label="Volume Mode"
            value={resource.spec?.template?.spec?.storage?.volumeMode || 'Filesystem'}
            onChange={e => updateStorage({ volumeMode: e.target.value })}
            helperText="Volume mode"
          >
            <MenuItem value="Filesystem">Filesystem</MenuItem>
            <MenuItem value="Block">Block</MenuItem>
          </TextField>
        </Grid>

        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Switch
                checked={resource.spec?.template?.spec?.preallocation || false}
                onChange={e =>
                  onChange({
                    ...resource,
                    spec: {
                      ...resource.spec,
                      template: {
                        ...resource.spec?.template,
                        spec: {
                          ...resource.spec?.template?.spec,
                          preallocation: e.target.checked || undefined,
                        },
                      },
                    },
                  })
                }
              />
            }
            label={
              <Box>
                <Typography>Preallocation</Typography>
                <Typography variant="caption" color="text.secondary">
                  Preallocate disk space for better performance
                </Typography>
              </Box>
            }
          />
        </Grid>
      </FormSection>
    </Box>
  );
}
