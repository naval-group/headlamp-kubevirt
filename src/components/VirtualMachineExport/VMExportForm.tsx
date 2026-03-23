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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface KubeNamedItem {
  metadata: { name: string; namespace: string };
}

type SourceKind = 'VirtualMachine' | 'VirtualMachineSnapshot' | 'PersistentVolumeClaim';

const SOURCE_KIND_CONFIG: Record<
  SourceKind,
  { apiGroup: string; label: string; listEndpoint: (ns: string) => string }
> = {
  VirtualMachine: {
    apiGroup: 'kubevirt.io',
    label: 'Virtual Machine',
    listEndpoint: ns => `/apis/kubevirt.io/v1/namespaces/${ns}/virtualmachines`,
  },
  VirtualMachineSnapshot: {
    apiGroup: 'snapshot.kubevirt.io/v1beta1',
    label: 'VM Snapshot',
    listEndpoint: ns =>
      `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${ns}/virtualmachinesnapshots`,
  },
  PersistentVolumeClaim: {
    apiGroup: '',
    label: 'PVC',
    listEndpoint: ns => `/api/v1/namespaces/${ns}/persistentvolumeclaims`,
  },
};

const TTL_PRESETS = [
  { label: '30 minutes', value: '30m' },
  { label: '1 hour', value: '1h' },
  { label: '2 hours', value: '2h' },
  { label: '6 hours', value: '6h' },
  { label: '12 hours', value: '12h' },
  { label: '24 hours', value: '24h' },
  { label: 'Custom', value: 'custom' },
];

interface VMExportFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function VMExportForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: VMExportFormProps) {
  const name = resource.metadata?.name || '';
  const namespace = resource.metadata?.namespace || 'default';
  const sourceKind: SourceKind = resource.spec?.source?.kind || 'VirtualMachine';
  const sourceName = resource.spec?.source?.name || '';
  const ttlDuration = resource.spec?.ttlDuration || '1h';

  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [sourceItems, setSourceItems] = useState<string[]>([]);
  const [ttlMode, setTtlMode] = useState<string>(
    TTL_PRESETS.some(p => p.value === ttlDuration && p.value !== 'custom') ? ttlDuration : 'custom'
  );
  const [customTtl, setCustomTtl] = useState(
    TTL_PRESETS.some(p => p.value === ttlDuration) ? '' : ttlDuration
  );

  const { updateMetadata } = useResourceEditor(resource, onChange);

  // Fetch namespaces
  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        setNamespaces(response?.items?.map(ns => ns.metadata.name) || ['default']);
      })
      .catch(() => {});
  }, []);

  // Fetch source items when namespace or kind changes
  React.useEffect(() => {
    if (!namespace) return;
    const config = SOURCE_KIND_CONFIG[sourceKind];
    ApiProxy.request(config.listEndpoint(namespace))
      .then((response: KubeListResponse<KubeNamedItem>) => {
        setSourceItems(response?.items?.map(item => item.metadata.name) || []);
      })
      .catch(() => setSourceItems([]));
  }, [namespace, sourceKind]);

  const updateSource = (kind: SourceKind, name: string) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        source: {
          apiGroup: SOURCE_KIND_CONFIG[kind].apiGroup,
          kind,
          name,
        },
      },
    });
  };

  const updateTtl = (value: string) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        ttlDuration: value,
      },
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <FormSection icon="mdi:information-outline" title="Basic Information" color="other" noGrid>
        <MandatoryTextField
          fullWidth
          label="Name"
          value={name}
          onChange={e => updateMetadata('name', e.target.value)}
          showErrors={showErrors}
          helperText={editMode ? 'Name cannot be changed' : 'Unique name for the export'}
          disabled={editMode}
          sx={{ mb: 2 }}
        />
        <Autocomplete
          fullWidth
          options={namespaces}
          value={namespace}
          onChange={(_, v) => updateMetadata('namespace', v || 'default')}
          disabled={editMode}
          renderInput={params => (
            <TextField
              {...params}
              label="Namespace"
              required
              helperText={
                showErrors && !namespace
                  ? 'Namespace is required'
                  : 'Namespace of the source resource'
              }
              sx={showErrors && !namespace ? mandatoryFieldSx : undefined}
            />
          )}
        />
      </FormSection>

      <Divider />

      <FormSection icon="mdi:export" title="Export Source" color="storage" noGrid>
        <FormControl component="fieldset" sx={{ mb: 3 }}>
          <FormLabel component="legend">Source Kind</FormLabel>
          <RadioGroup
            value={sourceKind}
            onChange={e => {
              updateSource(e.target.value as SourceKind, '');
            }}
          >
            {(Object.keys(SOURCE_KIND_CONFIG) as SourceKind[]).map(kind => (
              <FormControlLabel
                key={kind}
                value={kind}
                control={<Radio />}
                label={SOURCE_KIND_CONFIG[kind].label}
                disabled={editMode}
              />
            ))}
          </RadioGroup>
        </FormControl>

        <Autocomplete
          fullWidth
          options={sourceItems}
          value={sourceName || null}
          onChange={(_, v) => updateSource(sourceKind, v || '')}
          disabled={editMode}
          renderInput={params => (
            <TextField
              {...params}
              label={`${SOURCE_KIND_CONFIG[sourceKind].label} Name`}
              required
              placeholder={`Select a ${SOURCE_KIND_CONFIG[sourceKind].label.toLowerCase()}...`}
              helperText={
                showErrors && !sourceName
                  ? `${SOURCE_KIND_CONFIG[sourceKind].label} Name is required`
                  : ''
              }
              sx={showErrors && !sourceName ? mandatoryFieldSx : undefined}
            />
          )}
        />

        {sourceKind === 'VirtualMachine' && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Running VMs will be exported but the export will stay Pending until the VM is stopped or
            has snapshottable volumes.
          </Typography>
        )}
      </FormSection>

      <Divider />

      <FormSection icon="mdi:timer-outline" title="TTL Duration" color="migration" noGrid>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          How long the export should remain available before being automatically cleaned up.
        </Typography>

        <RadioGroup
          value={ttlMode}
          onChange={e => {
            const val = e.target.value;
            setTtlMode(val);
            if (val !== 'custom') {
              updateTtl(val);
            }
          }}
          sx={{ mb: 2 }}
        >
          {TTL_PRESETS.map(preset => (
            <FormControlLabel
              key={preset.value}
              value={preset.value}
              control={<Radio size="small" />}
              label={preset.label}
            />
          ))}
        </RadioGroup>

        {ttlMode === 'custom' && (
          <TextField
            label="Custom TTL"
            value={customTtl}
            onChange={e => {
              setCustomTtl(e.target.value);
              updateTtl(e.target.value);
            }}
            placeholder="e.g. 90m, 3h, 1h30m"
            helperText="Go duration format: h (hours), m (minutes), s (seconds)"
            sx={{ maxWidth: 300 }}
          />
        )}
      </FormSection>
    </Box>
  );
}
