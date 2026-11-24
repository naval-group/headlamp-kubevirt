import { Icon } from '@iconify/react';
import { Alert, Box, Button, Chip, TextField, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useEffect, useState } from 'react';
import {
  CLUSTER_CONFIG_NAME,
  parseNamespaceList,
  saveClusterConfig,
  SHARED_NAD_NAMESPACES_KEY,
  useClusterConfig,
} from '../../utils/clusterConfig';

/**
 * Cluster-wide setting: namespaces whose NetworkAttachmentDefinitions can be used by VMs in any
 * namespace (match Multus `globalNamespaces` when namespace isolation is enabled).
 * Stored in the cluster's headlamp-kubevirt-config ConfigMap so all users get the same value.
 */
export default function SharedNadNamespacesConfig() {
  const { enqueueSnackbar } = useSnackbar();
  const config = useClusterConfig();
  const current = config.data[SHARED_NAD_NAMESPACES_KEY] || '';
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(current), [current]);

  const parsed = parseNamespaceList(value);
  const normalized = parsed.join(',');
  const dirty = normalized !== parseNamespaceList(current).join(',');

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveClusterConfig(config.namespace, { [SHARED_NAD_NAMESPACES_KEY]: normalized });
      enqueueSnackbar('Shared NAD namespaces saved for this cluster', { variant: 'success' });
      config.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      enqueueSnackbar(
        `Could not save ${config.namespace}/${CLUSTER_CONFIG_NAME}: ${msg}. ` +
          'Editing this setting requires permission to update that ConfigMap.',
        { variant: 'error' }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box display="flex" alignItems="center" gap={1}>
        <Icon icon="mdi:lan" width={20} style={{ color: '#2196f3' }} />
        <Typography variant="subtitle1" fontWeight={500} flex={1}>
          Shared NAD Namespaces
        </Typography>
        <Chip
          label={current ? 'Cluster ConfigMap' : 'Not set (all namespaces)'}
          size="small"
          color={current ? 'success' : 'warning'}
          variant="outlined"
        />
      </Box>

      <Typography variant="body2" color="text.secondary">
        Namespaces whose NetworkAttachmentDefinitions VMs in any namespace may use. When set, the VM
        network dropdown lists the VM&apos;s own namespace plus these namespaces; when empty, it
        lists NADs from all namespaces. With Multus namespace isolation, set this to match its{' '}
        <code>globalNamespaces</code>. Applies to all users of this cluster (stored in ConfigMap{' '}
        <code>
          {config.namespace}/{CLUSTER_CONFIG_NAME}
        </code>
        , key <code>{SHARED_NAD_NAMESPACES_KEY}</code>).
      </Typography>

      {config.error && (
        <Alert severity="warning">
          Could not read the cluster configuration ({config.error}). The VM form will list NADs from
          all namespaces it can read.
        </Alert>
      )}

      <Box display="flex" gap={1} alignItems="flex-start">
        <TextField
          size="small"
          fullWidth
          label="Namespaces (comma-separated)"
          placeholder="e.g. networks,default"
          value={value}
          onChange={e => setValue(e.target.value)}
          helperText={
            parsed.length > 0 ? `Will list: <VM namespace>, ${parsed.join(', ')}` : 'All namespaces'
          }
          disabled={!config.loaded || saving}
        />
        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={!config.loaded || saving || !dirty}
          sx={{ mt: 0.5 }}
        >
          Save
        </Button>
      </Box>
    </Box>
  );
}
