import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { safeError } from '../../utils/sanitize';

interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  namespace: string;
}

export default function SaveAsTemplateDialog({
  open,
  onClose,
  vmName,
  namespace,
}: SaveAsTemplateDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [templateName, setTemplateName] = useState('');
  const [targetNamespace, setTargetNamespace] = useState('');
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setTemplateName(`${vmName}-template`);
      setTargetNamespace(namespace);
      setCreating(false);
      ApiProxy.request('/api/v1/namespaces')
        .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
          setAllNamespaces((resp?.items?.map(ns => ns.metadata.name) || []).sort());
        })
        .catch(() => {});
    }
  }, [open, vmName, namespace]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const ns = targetNamespace || namespace;
      await ApiProxy.request(
        `/apis/template.kubevirt.io/v1alpha1/namespaces/${encodeURIComponent(
          ns
        )}/virtualmachinetemplaterequests`,
        {
          method: 'POST',
          body: JSON.stringify({
            apiVersion: 'template.kubevirt.io/v1alpha1',
            kind: 'VirtualMachineTemplateRequest',
            metadata: {
              name: `vmtr-${vmName}-${Date.now()}`.substring(0, 63).replace(/-+$/, ''),
              namespace: ns,
            },
            spec: {
              templateName: templateName.trim() || undefined,
              virtualMachineRef: {
                name: vmName,
                namespace,
              },
            },
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      enqueueSnackbar(`Template request created for "${vmName}". A template will be generated.`, {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      enqueueSnackbar(safeError('Failed to create template request', err), { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Icon
          icon="mdi:content-save"
          width={20}
          style={{ verticalAlign: 'middle', marginRight: 8 }}
        />
        Save VM as Template
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Create a reusable template from <strong>{vmName}</strong>. The controller will generate a
          VirtualMachineTemplate from the current VM configuration.
        </Typography>
        <TextField
          label="Template Name (optional)"
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          size="small"
          fullWidth
          placeholder={`${vmName}-template`}
          helperText="Name for the generated template. Leave empty for auto-generated name."
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 2 }}
        />
        <Autocomplete
          size="small"
          fullWidth
          options={allNamespaces}
          value={targetNamespace || null}
          onChange={(_e, val) => setTargetNamespace(val || namespace)}
          renderInput={params => (
            <TextField
              {...params}
              label="Target Namespace"
              helperText="Namespace where the template will be created. Can differ from the source VM namespace."
            />
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={creating}
          startIcon={
            creating ? <CircularProgress size={16} /> : <Icon icon="mdi:content-save" width={16} />
          }
        >
          {creating ? 'Creating...' : 'Save as Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
