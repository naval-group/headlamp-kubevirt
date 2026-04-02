import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { safeError } from '../../utils/sanitize';

interface CreateExportDialogProps {
  open: boolean;
  onClose: () => void;
  snapshotName: string;
  snapshotNamespace: string;
}

export default function CreateExportDialog({
  open,
  onClose,
  snapshotName,
  snapshotNamespace,
}: CreateExportDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [exportName, setExportName] = useState('');
  const [ttl, setTtl] = useState('2h');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setExportName(`${snapshotName}-export`);
      setTtl('2h');
      setCreating(false);
    }
  }, [open, snapshotName]);

  const nameError = useMemo(() => {
    const v = exportName.trim();
    if (!v) return '';
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(v))
      return 'Must be lowercase alphanumeric with dashes or dots';
    if (v.length > 253) return 'Max 253 characters';
    return '';
  }, [exportName]);

  const handleCreate = useCallback(async () => {
    const name = exportName.trim();
    if (!name) {
      enqueueSnackbar('Export name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    try {
      await ApiProxy.request(
        `/apis/export.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          snapshotNamespace
        )}/virtualmachineexports`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiVersion: 'export.kubevirt.io/v1beta1',
            kind: 'VirtualMachineExport',
            metadata: { name, namespace: snapshotNamespace },
            spec: {
              source: {
                apiGroup: 'snapshot.kubevirt.io',
                kind: 'VirtualMachineSnapshot',
                name: snapshotName,
              },
              ttlDuration: ttl,
            },
          }),
        }
      );
      enqueueSnackbar(`Export ${name} created`, { variant: 'success' });
      onClose();
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to create export: ${safeError(e, 'export-create')}`, {
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  }, [exportName, snapshotName, snapshotNamespace, ttl, enqueueSnackbar, onClose]);

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
      }}
      onClick={onClose}
    >
      <Card sx={{ minWidth: 400, maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="h6">Create Export from Snapshot</Typography>
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <Icon icon="mdi:close" width={20} />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Snapshot: {snapshotName}
          </Typography>

          <TextField
            label="Export Name"
            value={exportName}
            onChange={e => setExportName(e.target.value)}
            fullWidth
            size="small"
            required
            error={!!nameError}
            helperText={nameError || 'Unique name for the export'}
            sx={{ mt: 2, mb: 2 }}
          />

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              TTL Duration
            </Typography>
            <FormControl fullWidth size="small">
              <Select value={ttl} onChange={e => setTtl(e.target.value)}>
                <MenuItem value="1h">1 hour</MenuItem>
                <MenuItem value="2h">2 hours</MenuItem>
                <MenuItem value="6h">6 hours</MenuItem>
                <MenuItem value="12h">12 hours</MenuItem>
                <MenuItem value="24h">24 hours</MenuItem>
                <MenuItem value="48h">48 hours</MenuItem>
                <MenuItem value="168h">1 week</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={creating || !exportName.trim() || !!nameError}
            >
              {creating ? 'Creating...' : 'Create Export'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
