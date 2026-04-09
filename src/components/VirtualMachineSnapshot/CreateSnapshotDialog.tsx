import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { isValidK8sName, safeError } from '../../utils/sanitize';
import { TOOLTIPS } from '../../utils/tooltips';
import InfoTooltip from '../common/InfoTooltip';

interface CreateSnapshotDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  namespace: string;
}

export default function CreateSnapshotDialog({
  open,
  onClose,
  vmName,
  namespace,
}: CreateSnapshotDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [snapshotName, setSnapshotName] = useState(`${vmName}-snapshot-${Date.now()}`);
  const [deletionPolicy, setDeletionPolicy] = useState('default');
  const [failureDeadline, setFailureDeadline] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSnapshotName(`${vmName}-snapshot-${Date.now()}`);
      setDeletionPolicy('default');
      setFailureDeadline('');
    }
  }, [open, vmName]);

  const nameError = useMemo(() => {
    const v = snapshotName.trim();
    if (!v) return '';
    if (!isValidK8sName(v)) return 'Must be lowercase alphanumeric, dashes, dots, or underscores';
    return '';
  }, [snapshotName]);

  const deadlineError = useMemo(() => {
    const v = failureDeadline.trim();
    if (!v) return '';
    if (!/^\d+[smhd]$/.test(v)) return 'Must be a duration like 5m, 1h, 30s';
    return '';
  }, [failureDeadline]);

  const handleCreate = async () => {
    if (!snapshotName.trim()) {
      enqueueSnackbar('Snapshot name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    const snapshot: {
      apiVersion: string;
      kind: string;
      metadata: { name: string; namespace: string };
      spec: {
        source: { apiGroup: string; kind: string; name: string };
        deletionPolicy?: string;
        failureDeadline?: string;
      };
    } = {
      apiVersion: 'snapshot.kubevirt.io/v1beta1',
      kind: 'VirtualMachineSnapshot',
      metadata: {
        name: snapshotName.trim(),
        namespace: namespace,
      },
      spec: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: vmName,
        },
      },
    };

    if (deletionPolicy && deletionPolicy !== 'default') {
      snapshot.spec.deletionPolicy = deletionPolicy;
    }
    if (failureDeadline) {
      snapshot.spec.failureDeadline = failureDeadline;
    }

    try {
      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          namespace
        )}/virtualmachinesnapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        }
      );
      enqueueSnackbar(`Snapshot ${snapshotName} created`, { variant: 'success' });
      onClose();
    } catch (e) {
      enqueueSnackbar(`Failed to create snapshot: ${safeError(e, 'snapshot-create')}`, {
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Take Snapshot</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label="Snapshot Name"
            value={snapshotName}
            onChange={e => setSnapshotName(e.target.value)}
            fullWidth
            required
            error={!!nameError}
            helperText={nameError || 'Unique name for the snapshot'}
          />
          <FormControl fullWidth>
            <InputLabel>Deletion Policy</InputLabel>
            <Select
              value={deletionPolicy}
              label="Deletion Policy"
              onChange={e => setDeletionPolicy(e.target.value)}
            >
              <MenuItem value="default">Default</MenuItem>
              <MenuItem value="Delete">
                Delete - Remove snapshot content when snapshot is deleted
              </MenuItem>
              <MenuItem value="Retain">
                Retain - Keep snapshot content when snapshot is deleted
              </MenuItem>
            </Select>
          </FormControl>
          <TextField
            label={
              <>
                Failure Deadline <InfoTooltip text={TOOLTIPS.snapshotFailureDeadline} />
              </>
            }
            value={failureDeadline}
            onChange={e => setFailureDeadline(e.target.value)}
            fullWidth
            placeholder="e.g., 5m, 1h"
            error={!!deadlineError}
            helperText={deadlineError || 'Timeout for snapshot creation (e.g., 5m for 5 minutes)'}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={creating || !snapshotName.trim() || !!nameError || !!deadlineError}
          startIcon={<Icon icon="mdi:camera" />}
        >
          {creating ? 'Creating...' : 'Create Snapshot'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
