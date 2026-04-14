import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { safeError } from '../../utils/sanitize';
import { substituteParams } from '../../utils/templateUtils';
import VirtualMachineTemplate from './VirtualMachineTemplate';

interface ProcessTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  template: InstanceType<typeof VirtualMachineTemplate>;
}

export default function ProcessTemplateDialog({
  open,
  onClose,
  template,
}: ProcessTemplateDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const params = template.getParameters();
  const [values, setValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Initialize values from defaults
  useEffect(() => {
    if (open) {
      const defaults: Record<string, string> = {};
      params.forEach(p => {
        if (p.value) defaults[p.name] = p.value;
      });
      setValues(defaults);
      setCreating(false);
      setError('');
    }
  }, [open]);

  const handleCreate = async () => {
    // Validate required parameters
    const missing = params.filter(p => p.required && !values[p.name]?.trim());
    if (missing.length > 0) {
      setError(
        `Missing required parameters: ${missing.map(p => p.displayName || p.name).join(', ')}`
      );
      return;
    }

    setCreating(true);
    setError('');

    try {
      // Get the VM spec from the template
      const vmSpec = template.getVirtualMachineSpec();
      if (!vmSpec) {
        setError('Template has no VM spec');
        setCreating(false);
        return;
      }

      // Substitute parameters in the VM spec
      let vmJson = JSON.stringify(vmSpec);
      params.forEach(p => {
        const value = values[p.name] || p.value || '';
        // Replace ${PARAM_NAME} patterns
        vmJson = vmJson.replace(new RegExp(`\\$\\{${p.name}\\}`, 'g'), value);
      });

      const vmResource = JSON.parse(vmJson);

      // Ensure namespace is set
      if (!vmResource.metadata) vmResource.metadata = {};
      if (!vmResource.metadata.namespace) {
        vmResource.metadata.namespace = template.getNamespace();
      }

      // Ensure apiVersion and kind
      if (!vmResource.apiVersion) vmResource.apiVersion = 'kubevirt.io/v1';
      if (!vmResource.kind) vmResource.kind = 'VirtualMachine';

      const ns = vmResource.metadata.namespace;
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines`,
        {
          method: 'POST',
          body: JSON.stringify(vmResource),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar(`VM "${vmResource.metadata.name}" created from template`, {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      setError(safeError('Failed to create VM', err));
    } finally {
      setCreating(false);
    }
  };

  const message = template.getMessage();
  const previewMessage = useMemo(
    () => (message ? substituteParams(message, params, values) : ''),
    [message, params, values]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="mdi:play-circle" width={24} />
          Create VM from Template
        </Box>
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Fill in the parameters to create a VM from <strong>{template.getName()}</strong>.
          {params.some(p => p.generate) && (
            <> Parameters with generators will be auto-filled if left empty.</>
          )}
        </Typography>

        {params.length === 0 ? (
          <Alert severity="info">This template has no parameters.</Alert>
        ) : (
          <Box display="flex" flexDirection="column" gap={2}>
            {params.map(param => (
              <Box key={param.name}>
                <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                  <Typography variant="caption" fontWeight={500}>
                    {param.displayName || param.name}
                  </Typography>
                  {param.required && (
                    <Chip
                      label="required"
                      size="small"
                      color="warning"
                      variant="outlined"
                      sx={{ height: 16, fontSize: '0.6rem' }}
                    />
                  )}
                  {param.generate && (
                    <Chip
                      label="auto"
                      size="small"
                      variant="outlined"
                      sx={{ height: 16, fontSize: '0.6rem' }}
                    />
                  )}
                </Box>
                <TextField
                  value={values[param.name] || ''}
                  onChange={e => setValues({ ...values, [param.name]: e.target.value })}
                  placeholder={
                    param.generate
                      ? `Auto-generated (${param.from || param.generate})`
                      : param.value || undefined
                  }
                  helperText={param.description}
                  size="small"
                  fullWidth
                />
              </Box>
            ))}
          </Box>
        )}

        {previewMessage && (
          <Box mt={2}>
            <Typography variant="caption" color="text.secondary">
              Template Message
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.5,
                fontFamily: 'monospace',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1,
                whiteSpace: 'pre-wrap',
              }}
            >
              {previewMessage}
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
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
            creating ? <CircularProgress size={16} /> : <Icon icon="mdi:plus" width={16} />
          }
        >
          {creating ? 'Creating...' : 'Create VM'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
