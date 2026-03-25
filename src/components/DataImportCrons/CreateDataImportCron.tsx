import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  MenuItem,
  Radio,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import { KubeListResponse } from '../../types';
import CatalogButton from './CatalogButton';
import { CRON_PRESETS, parseCronExpression } from './cronUtils';
import ImageCatalogPicker, { CatalogSelection } from './ImageCatalogPicker';

interface KubeNamedItem {
  metadata: { name: string };
}

interface CreateDataImportCronProps {
  onClose: () => void;
}

export default function CreateDataImportCron({ onClose }: CreateDataImportCronProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [isCreating, setIsCreating] = useState(false);

  // Basic fields
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [managedDataSource, setManagedDataSource] = useState('');
  const [schedule, setSchedule] = useState('0 0 * * *');

  // Garbage collection
  const [garbageCollect, setGarbageCollect] = useState<'Outdated' | 'Never'>('Outdated');
  const [importsToKeep, setImportsToKeep] = useState(3);
  const [retentionPolicy, setRetentionPolicy] = useState('RetainAll');

  // Source configuration
  const [sourceType, setSourceType] = useState<'registry' | 'http' | 's3' | 'blank'>('registry');

  // Registry source
  const [registryUrl, setRegistryUrl] = useState('');
  const [registrySecretRef, setRegistrySecretRef] = useState('');
  const [registryCertConfigMap, setRegistryCertConfigMap] = useState('');
  const [registryPullMethod, setRegistryPullMethod] = useState<'pod' | 'node'>('pod');

  // HTTP source
  const [httpUrl, setHttpUrl] = useState('');
  const [httpSecretRef, setHttpSecretRef] = useState('');
  const [httpCertConfigMap, setHttpCertConfigMap] = useState('');

  // S3 source
  const [s3Url, setS3Url] = useState('');
  const [s3SecretRef, setS3SecretRef] = useState('');
  const [s3CertConfigMap, setS3CertConfigMap] = useState('');

  // Storage configuration
  const [storageSize, setStorageSize] = useState('30');
  const [storageSizeUnit, setStorageSizeUnit] = useState<'Gi' | 'Mi' | 'Ti'>('Gi');
  const [storageClass, setStorageClass] = useState('');
  const [accessMode, setAccessMode] = useState<'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany'>(
    'ReadWriteOnce'
  );
  const [volumeMode, setVolumeMode] = useState<'Filesystem' | 'Block'>('Filesystem');

  // Additional options
  const [preallocation, setPreallocation] = useState(false);
  const [priorityClassName, setPriorityClassName] = useState('');

  // Image catalog
  const [catalogOpen, setCatalogOpen] = useState(false);

  const handleCatalogSelect = (selection: CatalogSelection) => {
    setSourceType('registry');
    setRegistryUrl(selection.registryUrl);
    if (!managedDataSource) {
      setManagedDataSource(selection.managedDataSourceSuggestion);
    }
    // Parse storage size
    const sizeMatch = selection.storageSize.match(/^(\d+)(Gi|Mi|Ti)$/);
    if (sizeMatch) {
      setStorageSize(sizeMatch[1]);
      setStorageSizeUnit(sizeMatch[2] as 'Gi' | 'Mi' | 'Ti');
    }
  };

  // Fetch available namespaces
  const [namespaces, setNamespaces] = useState<string[]>([]);
  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const nsList = response?.items?.map(ns => ns.metadata.name) || [];
        setNamespaces(nsList);
      })
      .catch(err => console.error('Failed to fetch namespaces:', err));
  }, []);

  // Fetch available storage classes
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  React.useEffect(() => {
    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const scList = response?.items?.map(sc => sc.metadata.name) || [];
        setStorageClasses(scList);
      })
      .catch(err => console.error('Failed to fetch storage classes:', err));
  }, []);

  // Fetch available secrets in selected namespace
  const [secrets, setSecrets] = useState<string[]>([]);
  React.useEffect(() => {
    if (namespace) {
      ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`)
        .then((response: KubeListResponse<KubeNamedItem>) => {
          const secretList = response?.items?.map(secret => secret.metadata.name) || [];
          setSecrets(secretList);
        })
        .catch(err => console.error('Failed to fetch secrets:', err));
    }
  }, [namespace]);

  // Fetch available configmaps in selected namespace
  const [configMaps, setConfigMaps] = useState<string[]>([]);
  React.useEffect(() => {
    if (namespace) {
      ApiProxy.request(`/api/v1/namespaces/${namespace}/configmaps`)
        .then((response: KubeListResponse<KubeNamedItem>) => {
          const cmList = response?.items?.map(cm => cm.metadata.name) || [];
          setConfigMaps(cmList);
        })
        .catch(err => console.error('Failed to fetch configmaps:', err));
    }
  }, [namespace]);

  const handleCreate = async () => {
    if (!name || !managedDataSource || !schedule) {
      enqueueSnackbar('Please fill in all required fields', { variant: 'error' });
      return;
    }

    // Validate source-specific fields
    if (sourceType === 'registry' && !registryUrl) {
      enqueueSnackbar('Registry URL is required', { variant: 'error' });
      return;
    }

    if (sourceType === 'http' && !httpUrl) {
      enqueueSnackbar('HTTP URL is required', { variant: 'error' });
      return;
    }

    if (sourceType === 's3' && !s3Url) {
      enqueueSnackbar('S3 URL is required', { variant: 'error' });
      return;
    }

    if (!storageSize) {
      enqueueSnackbar('Storage size is required', { variant: 'error' });
      return;
    }

    setIsCreating(true);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataImportCron: Record<string, any> = {
        apiVersion: 'cdi.kubevirt.io/v1beta1',
        kind: 'DataImportCron',
        metadata: {
          name,
          namespace,
        },
        spec: {
          managedDataSource,
          schedule,
          garbageCollect,
          importsToKeep,
          retentionPolicy,
          template: {
            spec: {
              storage: {
                resources: {
                  requests: {
                    storage: `${storageSize}${storageSizeUnit}`,
                  },
                },
                accessModes: [accessMode],
                volumeMode,
              },
              source: {},
            },
          },
        },
      };

      // Add storage class if specified
      if (storageClass) {
        dataImportCron.spec.template.spec.storage.storageClassName = storageClass;
      }

      // Add priority class if specified
      if (priorityClassName) {
        dataImportCron.spec.template.spec.priorityClassName = priorityClassName;
      }

      // Add preallocation if enabled
      if (preallocation) {
        dataImportCron.spec.template.spec.preallocation = true;
      }

      // Configure source based on type
      if (sourceType === 'registry') {
        dataImportCron.spec.template.spec.source.registry = {
          url: registryUrl,
          pullMethod: registryPullMethod,
        };
        if (registrySecretRef) {
          dataImportCron.spec.template.spec.source.registry.secretRef = registrySecretRef;
        }
        if (registryCertConfigMap) {
          dataImportCron.spec.template.spec.source.registry.certConfigMap = registryCertConfigMap;
        }
      } else if (sourceType === 'http') {
        dataImportCron.spec.template.spec.source.http = {
          url: httpUrl,
        };
        if (httpSecretRef) {
          dataImportCron.spec.template.spec.source.http.secretRef = httpSecretRef;
        }
        if (httpCertConfigMap) {
          dataImportCron.spec.template.spec.source.http.certConfigMap = httpCertConfigMap;
        }
      } else if (sourceType === 's3') {
        dataImportCron.spec.template.spec.source.s3 = {
          url: s3Url,
        };
        if (s3SecretRef) {
          dataImportCron.spec.template.spec.source.s3.secretRef = s3SecretRef;
        }
        if (s3CertConfigMap) {
          dataImportCron.spec.template.spec.source.s3.certConfigMap = s3CertConfigMap;
        }
      } else if (sourceType === 'blank') {
        dataImportCron.spec.template.spec.source.blank = {};
      }

      await ApiProxy.request(
        `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/dataimportcrons`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dataImportCron),
        }
      );

      enqueueSnackbar(`DataImportCron ${name} created successfully`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      console.error('Failed to create DataImportCron:', error);
      enqueueSnackbar(
        `Failed to create DataImportCron: ${(error as Error).message || 'Unknown error'}`,
        {
          variant: 'error',
        }
      );
    } finally {
      setIsCreating(false);
    }
  };

  // Get human-readable schedule description
  const scheduleDescription = parseCronExpression(schedule);

  return (
    <>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="mdi:calendar-sync" width="28" height="28" />
          <span>Create DataImportCron</span>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ mt: 1 }}>
          {/* Basic Information */}
          <Grid item xs={12}>
            <Accordion defaultExpanded sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:information-outline" />
                  <Typography variant="h6">Basic Information</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Name *
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="my-dataimportcron"
                      helperText="Name of the DataImportCron resource"
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Namespace *
                    </Typography>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={namespaces}
                      value={namespace}
                      onChange={(_, newValue) => setNamespace(newValue || 'default')}
                      renderInput={params => (
                        <TextField {...params} placeholder="Select namespace..." />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Managed DataSource *
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={managedDataSource}
                      onChange={e => setManagedDataSource(e.target.value)}
                      placeholder="my-datasource"
                      helperText="Name of the DataSource that will be created/managed by this cron (must be in the same namespace)"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Schedule (Cron Expression) *
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          size="small"
                          value={schedule}
                          onChange={e => setSchedule(e.target.value)}
                          placeholder="0 0 * * *"
                          helperText="Format: minute hour day month weekday"
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={CRON_PRESETS}
                          getOptionLabel={option => option.label}
                          onChange={(_, newValue) => {
                            if (newValue) {
                              setSchedule(newValue.value);
                            }
                          }}
                          renderInput={params => (
                            <TextField {...params} placeholder="Choose preset..." />
                          )}
                        />
                      </Grid>
                    </Grid>
                    <Box sx={{ mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon icon="mdi:clock-outline" fontSize="small" />
                        <Typography variant="body2" fontWeight="medium">
                          {scheduleDescription}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Source Configuration */}
          <Grid item xs={12}>
            <Accordion defaultExpanded sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:database-import" />
                  <Typography variant="h6">Source Configuration</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <CatalogButton onClick={() => setCatalogOpen(true)} />
                  </Grid>

                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'block' }}
                      >
                        Source Type *
                      </Typography>
                      <Select
                        size="small"
                        value={sourceType}
                        onChange={e =>
                          setSourceType(e.target.value as 'registry' | 'http' | 's3' | 'blank')
                        }
                      >
                        <MenuItem value="registry">Container Registry</MenuItem>
                        <MenuItem value="http">HTTP/HTTPS</MenuItem>
                        <MenuItem value="s3">S3</MenuItem>
                        <MenuItem value="blank">Blank Image</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {sourceType === 'registry' && (
                    <>
                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Registry URL *
                        </Typography>
                        <TextField
                          fullWidth
                          size="small"
                          value={registryUrl}
                          onChange={e => setRegistryUrl(e.target.value)}
                          placeholder="docker://quay.io/kubevirt/cirros-container-disk-demo"
                          helperText="URL starting with docker:// or oci-archive://"
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Pull Method
                        </Typography>
                        <FormControl fullWidth>
                          <Select
                            size="small"
                            value={registryPullMethod}
                            onChange={e => setRegistryPullMethod(e.target.value as 'pod' | 'node')}
                          >
                            <MenuItem value="pod">Pod (default)</MenuItem>
                            <MenuItem value="node">Node (docker cache)</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Secret Reference (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={secrets}
                          value={registrySecretRef}
                          onChange={(_, newValue) => setRegistrySecretRef(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select secret..." />
                          )}
                        />
                      </Grid>

                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Certificate ConfigMap (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={configMaps}
                          value={registryCertConfigMap}
                          onChange={(_, newValue) => setRegistryCertConfigMap(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select configmap..." />
                          )}
                        />
                      </Grid>
                    </>
                  )}

                  {sourceType === 'http' && (
                    <>
                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          HTTP URL *
                        </Typography>
                        <TextField
                          fullWidth
                          size="small"
                          value={httpUrl}
                          onChange={e => setHttpUrl(e.target.value)}
                          placeholder="https://example.com/disk.img"
                          helperText="HTTP or HTTPS URL to the disk image"
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Secret Reference (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={secrets}
                          value={httpSecretRef}
                          onChange={(_, newValue) => setHttpSecretRef(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select secret..." />
                          )}
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Certificate ConfigMap (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={configMaps}
                          value={httpCertConfigMap}
                          onChange={(_, newValue) => setHttpCertConfigMap(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select configmap..." />
                          )}
                        />
                      </Grid>
                    </>
                  )}

                  {sourceType === 's3' && (
                    <>
                      <Grid item xs={12}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          S3 URL *
                        </Typography>
                        <TextField
                          fullWidth
                          size="small"
                          value={s3Url}
                          onChange={e => setS3Url(e.target.value)}
                          placeholder="s3://bucket-name/disk.img"
                          helperText="S3 URL to the disk image"
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Secret Reference (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={secrets}
                          value={s3SecretRef}
                          onChange={(_, newValue) => setS3SecretRef(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select secret..." />
                          )}
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, display: 'block' }}
                        >
                          Certificate ConfigMap (optional)
                        </Typography>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={configMaps}
                          value={s3CertConfigMap}
                          onChange={(_, newValue) => setS3CertConfigMap(newValue || '')}
                          renderInput={params => (
                            <TextField {...params} placeholder="Select configmap..." />
                          )}
                        />
                      </Grid>
                    </>
                  )}

                  {sourceType === 'blank' && (
                    <Grid item xs={12}>
                      <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          A blank disk image will be created with the specified size.
                        </Typography>
                      </Box>
                    </Grid>
                  )}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Storage Configuration */}
          <Grid item xs={12}>
            <Accordion defaultExpanded sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:harddisk" />
                  <Typography variant="h6">Storage Configuration</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Size *
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      value={storageSize}
                      onChange={e => setStorageSize(e.target.value)}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Select
                              size="small"
                              value={storageSizeUnit}
                              onChange={e =>
                                setStorageSizeUnit(e.target.value as 'Gi' | 'Mi' | 'Ti')
                              }
                              variant="standard"
                              disableUnderline
                            >
                              <MenuItem value="Mi">MiB</MenuItem>
                              <MenuItem value="Gi">GiB</MenuItem>
                              <MenuItem value="Ti">TiB</MenuItem>
                            </Select>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Storage Class (optional)
                    </Typography>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={storageClasses}
                      value={storageClass}
                      onChange={(_, newValue) => setStorageClass(newValue || '')}
                      renderInput={params => (
                        <TextField {...params} placeholder="Select storage class..." />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Access Mode
                    </Typography>
                    <FormControl fullWidth>
                      <Select
                        size="small"
                        value={accessMode}
                        onChange={e =>
                          setAccessMode(
                            e.target.value as 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany'
                          )
                        }
                      >
                        <MenuItem value="ReadWriteOnce">ReadWriteOnce (RWO)</MenuItem>
                        <MenuItem value="ReadWriteMany">ReadWriteMany (RWX)</MenuItem>
                        <MenuItem value="ReadOnlyMany">ReadOnlyMany (ROX)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Volume Mode
                    </Typography>
                    <FormControl fullWidth>
                      <Select
                        size="small"
                        value={volumeMode}
                        onChange={e => setVolumeMode(e.target.value as 'Filesystem' | 'Block')}
                      >
                        <MenuItem value="Filesystem">Filesystem</MenuItem>
                        <MenuItem value="Block">Block</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Garbage Collection & Retention */}
          <Grid item xs={12}>
            <Accordion sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:delete-sweep" />
                  <Typography variant="h6">Garbage Collection & Retention</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Garbage Collect
                    </Typography>
                    <FormControl fullWidth>
                      <Select
                        size="small"
                        value={garbageCollect}
                        onChange={e => setGarbageCollect(e.target.value as 'Outdated' | 'Never')}
                      >
                        <MenuItem value="Outdated">Outdated (clean old PVCs)</MenuItem>
                        <MenuItem value="Never">Never (keep all PVCs)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Imports to Keep
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      value={importsToKeep}
                      onChange={e => setImportsToKeep(parseInt(e.target.value) || 3)}
                      inputProps={{ min: 1 }}
                      helperText="Number of import PVCs to keep when garbage collecting"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Retention Policy
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={retentionPolicy}
                      onChange={e => setRetentionPolicy(e.target.value)}
                      placeholder="RetainAll"
                      helperText="Whether created DataVolumes and DataSources are retained when the DataImportCron is deleted"
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Advanced Options */}
          <Grid item xs={12}>
            <Accordion sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:cog-outline" />
                  <Typography variant="h6">Advanced Options</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, display: 'block' }}
                    >
                      Priority Class (optional)
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      value={priorityClassName}
                      onChange={e => setPriorityClassName(e.target.value)}
                      placeholder="high-priority"
                      helperText="Priority class for importer pod"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Radio
                          checked={preallocation}
                          onChange={e => setPreallocation(e.target.checked)}
                        />
                      }
                      label="Preallocate storage space"
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ ml: 4 }}
                    >
                      Allocate full storage space in advance (slower creation, better performance)
                    </Typography>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Actions */}
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Button variant="outlined" onClick={onClose} disabled={isCreating}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleCreate}
                disabled={isCreating || !name || !managedDataSource || !schedule}
                startIcon={<Icon icon="mdi:plus" />}
              >
                {isCreating ? 'Creating...' : 'Create DataImportCron'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </DialogContent>

      <ImageCatalogPicker
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onSelect={handleCatalogSelect}
      />
    </>
  );
}
