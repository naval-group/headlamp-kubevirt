import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { KubeListResponse } from '../../types';
import { fetchNamespaceNames } from '../../utils/namespaces';
import DataSource from '../BootableVolumes/DataSource';
import VirtualMachineClusterInstanceType from '../InstanceTypes/VirtualMachineClusterInstanceType';
import VirtualMachineClusterPreference from '../Preferences/VirtualMachineClusterPreference';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface KubeNamedItem {
  metadata: { name: string };
}

interface VMFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
}

export default function VMForm({ resource, onChange }: VMFormProps) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const { items: dataSources } = DataSource.useList();
  const { items: instanceTypes } = VirtualMachineClusterInstanceType.useList();
  const { items: preferences } = VirtualMachineClusterPreference.useList();

  // Fetch namespaces and storage classes
  useEffect(() => {
    fetchNamespaceNames()
      .then(nsList => {
        setNamespaces(nsList);
      })
      .catch(err => console.error('Failed to fetch namespaces:', err));

    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const scList = response?.items?.map(sc => sc.metadata.name) || [];
        setStorageClasses(scList);
      })
      .catch(err => console.error('Failed to fetch storage classes:', err));
  }, []);

  const updateMetadata = (field: string, value: unknown) => {
    onChange({
      ...resource,
      metadata: {
        ...resource.metadata,
        [field]: value,
      },
    });
  };

  const updateSpec = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        ...updates,
      },
    });
  };

  const updateTemplate = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        template: {
          ...resource.spec?.template,
          spec: {
            ...resource.spec?.template?.spec,
            ...updates,
          },
        },
      },
    });
  };

  // Resource mode
  const useInstanceType = !!resource.spec?.instancetype;

  // Parse custom resources
  const customCpu = resource.spec?.template?.spec?.domain?.cpu?.cores ?? '';
  const customMemoryGuest = resource.spec?.template?.spec?.domain?.resources?.requests?.memory;
  const customMemoryMatch = customMemoryGuest?.match?.(/^(\d+)(Mi|Gi)$/);
  const customMemoryValue = customMemoryMatch ? customMemoryMatch[1] : '';
  const customMemoryUnit = customMemoryMatch ? customMemoryMatch[2] : 'Gi';

  // Storage size
  const storageSize =
    resource.spec?.dataVolumeTemplates?.[0]?.spec?.pvc?.resources?.requests?.storage;
  const storageSizeMatch = storageSize?.match(/^(\d+)(Gi|Mi|Ti)$/);
  const storageSizeValue = storageSizeMatch ? storageSizeMatch[1] : '';
  const storageSizeUnit = storageSizeMatch ? storageSizeMatch[2] : 'Gi';

  const handleCustomMemoryChange = (value: string, unit: string) => {
    if (value === '') {
      updateTemplate({
        domain: {
          ...resource.spec?.template?.spec?.domain,
          resources: {
            requests: {
              memory: undefined,
            },
          },
        },
      });
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) {
        updateTemplate({
          domain: {
            ...resource.spec?.template?.spec?.domain,
            resources: {
              requests: {
                memory: `${num}${unit}`,
              },
            },
          },
        });
      }
    }
  };

  const handleStorageSizeChange = (value: string, unit: string) => {
    if (value === '') {
      onChange({
        ...resource,
        spec: {
          ...resource.spec,
          dataVolumeTemplates: resource.spec?.dataVolumeTemplates
            ? [
                {
                  ...resource.spec.dataVolumeTemplates[0],
                  spec: {
                    ...resource.spec.dataVolumeTemplates[0]?.spec,
                    pvc: {
                      ...resource.spec.dataVolumeTemplates[0]?.spec?.pvc,
                      resources: {
                        requests: {
                          storage: undefined,
                        },
                      },
                    },
                  },
                },
              ]
            : [],
        },
      });
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) {
        onChange({
          ...resource,
          spec: {
            ...resource.spec,
            dataVolumeTemplates: [
              {
                ...(resource.spec?.dataVolumeTemplates?.[0] || {
                  metadata: { name: `${resource.metadata?.name || 'vm'}-disk` },
                }),
                spec: {
                  ...resource.spec?.dataVolumeTemplates?.[0]?.spec,
                  pvc: {
                    ...resource.spec?.dataVolumeTemplates?.[0]?.spec?.pvc,
                    resources: {
                      requests: {
                        storage: `${num}${unit}`,
                      },
                    },
                  },
                },
              },
            ],
          },
        });
      }
    }
  };

  // Validation
  const isCustomCpuEmpty = !useInstanceType && (!customCpu || customCpu === '');
  const isCustomMemoryEmpty = !useInstanceType && (!customMemoryGuest || customMemoryValue === '');
  const isStorageSizeEmpty = !storageSize || storageSizeValue === '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Basic Information */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Icon icon="mdi:information-outline" />
          <Typography variant="h6">Basic Information</Typography>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              label="Name"
              value={resource.metadata?.name || ''}
              onChange={e => updateMetadata('name', e.target.value)}
              helperText="Unique name for the Virtual Machine"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              select
              label="Namespace"
              value={resource.metadata?.namespace || 'default'}
              onChange={e => updateMetadata('namespace', e.target.value)}
              helperText="Namespace for the Virtual Machine"
            >
              {namespaces.map(ns => (
                <MenuItem key={ns} value={ns}>
                  {ns}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12}>
            <Autocomplete
              options={dataSources || []}
              getOptionLabel={ds => `${ds.getName()} (${ds.getNamespace()})`}
              value={
                dataSources?.find(
                  ds =>
                    ds.getName() ===
                    resource.spec?.dataVolumeTemplates?.[0]?.spec?.source?.pvc?.name
                ) || null
              }
              onChange={(_, value) => {
                if (value) {
                  onChange({
                    ...resource,
                    spec: {
                      ...resource.spec,
                      dataVolumeTemplates: [
                        {
                          metadata: {
                            name: `${resource.metadata?.name || 'vm'}-disk`,
                          },
                          spec: {
                            source: {
                              pvc: {
                                name: value.getName(),
                                namespace: value.getNamespace(),
                              },
                            },
                            pvc: {
                              accessModes: ['ReadWriteOnce'],
                              resources: {
                                requests: {
                                  storage: value.getSize() || '30Gi',
                                },
                              },
                              storageClassName:
                                value.getStorageClass() !== '-'
                                  ? value.getStorageClass()
                                  : undefined,
                            },
                          },
                        },
                      ],
                    },
                  });
                }
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Boot Source (DataSource)"
                  helperText="Select a bootable volume (DataSource) to boot from"
                />
              )}
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Resources */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Icon icon="mdi:chip" />
          <Typography variant="h6">Resources</Typography>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12}>
            <FormControl>
              <FormLabel>Resource Configuration</FormLabel>
              <RadioGroup
                row
                value={useInstanceType ? 'instanceType' : 'custom'}
                onChange={e => {
                  if (e.target.value === 'instanceType') {
                    updateSpec({
                      instancetype: {
                        kind: 'VirtualMachineClusterInstancetype',
                        name: '',
                      },
                    });
                  } else {
                    const newSpec = { ...resource.spec };
                    delete newSpec.instancetype;
                    onChange({ ...resource, spec: newSpec });
                  }
                }}
              >
                <FormControlLabel
                  value="instanceType"
                  control={<Radio />}
                  label="Use Instance Type"
                />
                <FormControlLabel value="custom" control={<Radio />} label="Custom Resources" />
              </RadioGroup>
            </FormControl>
          </Grid>

          {useInstanceType ? (
            <>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={instanceTypes || []}
                  getOptionLabel={it => `${it.getName()} (${it.getCPU()} CPU, ${it.getMemory()})`}
                  value={
                    instanceTypes?.find(it => it.getName() === resource.spec?.instancetype?.name) ||
                    null
                  }
                  onChange={(_, value) => {
                    updateSpec({
                      instancetype: {
                        kind: 'VirtualMachineClusterInstancetype',
                        name: value?.getName() || '',
                      },
                    });
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Instance Type"
                      helperText="Pre-defined CPU and memory configuration"
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={preferences || []}
                  getOptionLabel={pref => pref.getDisplayName() || pref.getName()}
                  value={
                    preferences?.find(pref => pref.getName() === resource.spec?.preference?.name) ||
                    null
                  }
                  onChange={(_, value) => {
                    if (value) {
                      updateSpec({
                        preference: {
                          kind: 'VirtualMachineClusterPreference',
                          name: value.getName(),
                        },
                      });
                    } else {
                      const newSpec = { ...resource.spec };
                      delete newSpec.preference;
                      onChange({ ...resource, spec: newSpec });
                    }
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Preference (Optional)"
                      helperText="Operating system preferences"
                    />
                  )}
                />
              </Grid>
            </>
          ) : (
            <>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label="CPU Cores"
                  value={customCpu}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '') {
                      updateTemplate({
                        domain: {
                          ...resource.spec?.template?.spec?.domain,
                          cpu: {
                            cores: undefined,
                          },
                        },
                      });
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num)) {
                        updateTemplate({
                          domain: {
                            ...resource.spec?.template?.spec?.domain,
                            cpu: {
                              cores: num,
                            },
                          },
                        });
                      }
                    }
                  }}
                  inputProps={{ min: 1, type: 'number' }}
                  helperText="Number of virtual CPU cores"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        borderColor: isCustomCpuEmpty ? 'warning.main' : undefined,
                      },
                      '&:hover fieldset': {
                        borderColor: isCustomCpuEmpty ? 'warning.dark' : undefined,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: isCustomCpuEmpty ? 'warning.main' : undefined,
                      },
                    },
                  }}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  required
                  label="Memory"
                  value={customMemoryValue}
                  onChange={e => handleCustomMemoryChange(e.target.value, customMemoryUnit)}
                  inputProps={{ min: 1, type: 'number' }}
                  helperText="Amount of memory"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        borderColor: isCustomMemoryEmpty ? 'warning.main' : undefined,
                      },
                      '&:hover fieldset': {
                        borderColor: isCustomMemoryEmpty ? 'warning.dark' : undefined,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: isCustomMemoryEmpty ? 'warning.main' : undefined,
                      },
                    },
                  }}
                />
              </Grid>

              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  select
                  label="Unit"
                  value={customMemoryUnit}
                  onChange={e => handleCustomMemoryChange(customMemoryValue, e.target.value)}
                >
                  <MenuItem value="Mi">Mi</MenuItem>
                  <MenuItem value="Gi">Gi</MenuItem>
                </TextField>
              </Grid>
            </>
          )}
        </Grid>
      </Paper>

      {/* Storage */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Icon icon="mdi:harddisk" />
          <Typography variant="h6">Storage</Typography>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              label="Storage Size"
              value={storageSizeValue}
              onChange={e => handleStorageSizeChange(e.target.value, storageSizeUnit)}
              inputProps={{ min: 1, type: 'number' }}
              helperText="Size of the root disk"
              sx={{
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: isStorageSizeEmpty ? 'warning.main' : undefined,
                  },
                  '&:hover fieldset': {
                    borderColor: isStorageSizeEmpty ? 'warning.dark' : undefined,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: isStorageSizeEmpty ? 'warning.main' : undefined,
                  },
                },
              }}
            />
          </Grid>

          <Grid item xs={12} md={6}>
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

          <Grid item xs={12}>
            <TextField
              fullWidth
              select
              label="Storage Class"
              value={resource.spec?.dataVolumeTemplates?.[0]?.spec?.pvc?.storageClassName || ''}
              onChange={e => {
                onChange({
                  ...resource,
                  spec: {
                    ...resource.spec,
                    dataVolumeTemplates: [
                      {
                        ...resource.spec?.dataVolumeTemplates?.[0],
                        spec: {
                          ...resource.spec?.dataVolumeTemplates?.[0]?.spec,
                          pvc: {
                            ...resource.spec?.dataVolumeTemplates?.[0]?.spec?.pvc,
                            storageClassName: e.target.value || undefined,
                          },
                        },
                      },
                    ],
                  },
                });
              }}
              helperText="Storage class for the disk"
            >
              <MenuItem value="">Default</MenuItem>
              {storageClasses.map(sc => (
                <MenuItem key={sc} value={sc}>
                  {sc}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {/* VM Control */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Icon icon="mdi:play-circle" />
          <Typography variant="h6">VM Control</Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={resource.spec?.running || false}
              onChange={e => updateSpec({ running: e.target.checked })}
            />
          }
          label={
            <Box>
              <Typography>Start VM after creation</Typography>
              <Typography variant="caption" color="text.secondary">
                Automatically power on the VM once created
              </Typography>
            </Box>
          }
        />
      </Paper>
    </Box>
  );
}
