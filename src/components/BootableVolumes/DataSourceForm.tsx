/**
 * DataSourceForm - Form component for creating DataSources
 *
 * A DataSource can reference:
 * 1. Another DataSource (reference, max depth 1)
 * 2. A PVC (PersistentVolumeClaim)
 * 3. A VolumeSnapshot
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import useResourceEditor from '../../hooks/useResourceEditor';
import { KubeListResponse } from '../../types';
import FormSection from '../common/FormSection';
import MandatoryTextField, { mandatoryFieldSx } from '../common/MandatoryTextField';
import DataSource from './DataSource';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface KubeNamedItem {
  metadata: { name: string };
}

interface DataSourceFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function DataSourceForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: DataSourceFormProps) {
  // Parse current values from resource
  const name = resource.metadata?.name || '';
  const namespace = resource.metadata?.namespace || 'default';

  // Determine source type
  let sourceType: 'dataSource' | 'pvc' | 'snapshot' = 'pvc';
  if (resource.spec?.source?.dataSource) {
    sourceType = 'dataSource';
  } else if (resource.spec?.source?.snapshot) {
    sourceType = 'snapshot';
  }

  // Source details
  const sourceName = resource.spec?.source?.[sourceType]?.name || '';
  const sourceNamespace = resource.spec?.source?.[sourceType]?.namespace || namespace;

  // Fetch available resources
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [pvcs, setPvcs] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<string[]>([]);

  // Fetch DataSources for reference
  const { items: dataSources } = DataSource.useList();

  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const nsList = response?.items?.map(ns => ns.metadata.name) || ['default'];
        setNamespaces(nsList);
      })
      .catch(err => console.error('Failed to fetch namespaces:', err));
  }, []);

  // Fetch PVCs for source namespace
  React.useEffect(() => {
    if (!sourceNamespace) return;

    ApiProxy.request(`/api/v1/namespaces/${sourceNamespace}/persistentvolumeclaims`)
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const pvcList = response?.items?.map(pvc => pvc.metadata.name) || [];
        setPvcs(pvcList);
      })
      .catch(err => console.error('Failed to fetch PVCs:', err));
  }, [sourceNamespace]);

  // Fetch VolumeSnapshots for source namespace
  React.useEffect(() => {
    if (!sourceNamespace) return;

    ApiProxy.request(
      `/apis/snapshot.storage.k8s.io/v1/namespaces/${sourceNamespace}/volumesnapshots`
    )
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const snapshotList = response?.items?.map(snap => snap.metadata.name) || [];
        setSnapshots(snapshotList);
      })
      .catch(err => console.error('Failed to fetch snapshots:', err));
  }, [sourceNamespace]);

  // Helper functions to update resource
  const { updateMetadata } = useResourceEditor(resource, onChange);

  const updateSource = (
    type: 'dataSource' | 'pvc' | 'snapshot',
    name: string,
    namespace: string
  ) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        source: {
          [type]: {
            name,
            namespace,
          },
        },
      },
    });
  };

  const handleSourceTypeChange = (type: 'dataSource' | 'pvc' | 'snapshot') => {
    // Clear previous source and set new one
    updateSource(type, '', namespace);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Name and Namespace */}
      <FormSection icon="mdi:information-outline" title="Basic Information" color="other" noGrid>
        <MandatoryTextField
          fullWidth
          label="Name"
          value={name}
          onChange={e => updateMetadata('name', e.target.value)}
          showErrors={showErrors}
          helperText={editMode ? 'Name cannot be changed' : 'Unique name for the DataSource'}
          disabled={editMode}
          sx={{ mb: 2 }}
        />

        <Autocomplete
          fullWidth
          options={namespaces}
          value={namespace}
          onChange={(_, newValue) => updateMetadata('namespace', newValue || 'default')}
          disabled={editMode}
          renderInput={params => (
            <TextField
              {...params}
              label="Namespace"
              required
              helperText={
                showErrors && !namespace
                  ? 'Namespace is required'
                  : editMode
                  ? 'Namespace cannot be changed'
                  : 'Namespace for the DataSource'
              }
              sx={showErrors && !namespace ? mandatoryFieldSx : undefined}
            />
          )}
        />
      </FormSection>

      <Divider />

      {/* Source Configuration */}
      <FormSection icon="mdi:source-branch" title="Source Configuration" color="storage" noGrid>
        <FormControl component="fieldset" sx={{ mb: 3 }}>
          <FormLabel component="legend">Source Type</FormLabel>
          <RadioGroup
            value={sourceType}
            onChange={e =>
              handleSourceTypeChange(e.target.value as 'dataSource' | 'pvc' | 'snapshot')
            }
          >
            <FormControlLabel value="pvc" control={<Radio />} label="PVC (PersistentVolumeClaim)" />
            <FormControlLabel value="snapshot" control={<Radio />} label="VolumeSnapshot" />
            <FormControlLabel
              value="dataSource"
              control={<Radio />}
              label="DataSource (Reference, max depth 1)"
            />
          </RadioGroup>
        </FormControl>

        {sourceType === 'pvc' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Reference an existing PVC as the source for this DataSource
            </Typography>

            <Autocomplete
              fullWidth
              options={namespaces}
              value={sourceNamespace}
              onChange={(_, newValue) => updateSource('pvc', sourceName, newValue || namespace)}
              renderInput={params => <TextField {...params} label="Source Namespace" required />}
              sx={{ mb: 2 }}
            />

            <Autocomplete
              fullWidth
              options={pvcs}
              value={sourceName}
              onChange={(_, newValue) => updateSource('pvc', newValue || '', sourceNamespace)}
              renderInput={params => (
                <TextField {...params} label="PVC Name" required placeholder="Select PVC..." />
              )}
            />
          </Box>
        )}

        {sourceType === 'snapshot' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Reference an existing VolumeSnapshot as the source for this DataSource
            </Typography>

            <Autocomplete
              fullWidth
              options={namespaces}
              value={sourceNamespace}
              onChange={(_, newValue) =>
                updateSource('snapshot', sourceName, newValue || namespace)
              }
              renderInput={params => <TextField {...params} label="Source Namespace" required />}
              sx={{ mb: 2 }}
            />

            <Autocomplete
              fullWidth
              options={snapshots}
              value={sourceName}
              onChange={(_, newValue) => updateSource('snapshot', newValue || '', sourceNamespace)}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Snapshot Name"
                  required
                  placeholder="Select snapshot..."
                />
              )}
            />
          </Box>
        )}

        {sourceType === 'dataSource' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Reference another DataSource (maximum depth of 1)
            </Typography>

            <Autocomplete
              fullWidth
              options={dataSources || []}
              getOptionLabel={option => `${option.getName()} (${option.getNamespace()})`}
              value={
                dataSources?.find(
                  ds => ds.getName() === sourceName && ds.getNamespace() === sourceNamespace
                ) || null
              }
              onChange={(_, newValue) => {
                if (newValue) {
                  updateSource('dataSource', newValue.getName(), newValue.getNamespace());
                } else {
                  updateSource('dataSource', '', namespace);
                }
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  label="DataSource"
                  required
                  placeholder="Select DataSource..."
                />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.metadata.uid}>
                  <Box>
                    <Typography variant="body2">
                      <strong>{option.getName()}</strong>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Namespace: {option.getNamespace()} | OS: {option.getOperatingSystem()}
                    </Typography>
                  </Box>
                </li>
              )}
            />
          </Box>
        )}
      </FormSection>

      {/* Information */}
      <Box sx={{ p: 2, bgcolor: 'info.main', color: 'info.contrastText', borderRadius: 1 }}>
        <Typography variant="body2">
          <strong>Note:</strong> DataSources are typically managed automatically by DataImportCrons.
          Manual creation is for advanced use cases where you need to reference existing PVCs or
          snapshots.
        </Typography>
      </Box>
    </Box>
  );
}
