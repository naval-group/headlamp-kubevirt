import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KubeCondition } from '../../types';
import { isKubeVirt18OrNewer } from '../../utils/kubevirtVersion';
import { safeError } from '../../utils/sanitize';
import { findCondition } from '../../utils/statusColors';

interface CloneDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  namespace: string;
}

type ClonePhase =
  | 'Unknown'
  | 'SnapshotInProgress'
  | 'CreatingTargetVM'
  | 'RestoreInProgress'
  | 'Succeeded'
  | 'Failed';

interface CloneResourceSpec {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string };
  spec: {
    source: { apiGroup: string; kind: string; name: string };
    target: { apiGroup: string; kind: string; name: string };
    labelFilters?: string[];
    annotationFilters?: string[];
    newMacAddresses?: Record<string, string>;
    newSMBiosSerial?: string;
    volumeNamePolicy?: 'RandomizeNames' | 'PrefixTargetName';
  };
}

const PHASE_INFO: Record<string, { label: string; color: string; icon: string }> = {
  SnapshotInProgress: { label: 'Snapshotting source VM...', color: '#2196f3', icon: 'mdi:camera' },
  CreatingTargetVM: { label: 'Creating target VM...', color: '#42a5f5', icon: 'mdi:plus-box' },
  RestoreInProgress: { label: 'Restoring disks...', color: '#f0ab00', icon: 'mdi:harddisk' },
  Succeeded: { label: 'Clone completed', color: '#3e8635', icon: 'mdi:check-circle' },
  Failed: { label: 'Clone failed', color: '#c9190b', icon: 'mdi:alert-circle' },
  Unknown: { label: 'Initializing...', color: '#78909c', icon: 'mdi:help-circle-outline' },
};

export default function CloneDialog({ open, onClose, vmName, namespace }: CloneDialogProps) {
  const { enqueueSnackbar } = useSnackbar();

  // Form state
  const [targetName, setTargetName] = useState('');
  const [stripMAC, setStripMAC] = useState(true);
  const [stripFirmwareUUID, setStripFirmwareUUID] = useState(true);
  const [labelFilters, setLabelFilters] = useState('');
  const [annotationFilters, setAnnotationFilters] = useState('');
  const [volumeNamePolicy, setVolumeNamePolicy] = useState<'RandomizeNames' | 'PrefixTargetName'>(
    'RandomizeNames'
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Progress state
  const [creating, setCreating] = useState(false);
  const [cloneName, setCloneName] = useState<string | null>(null);
  const [clonePhase, setClonePhase] = useState<ClonePhase>('Unknown');
  const [cloneDetail, setCloneDetail] = useState('');
  const [targetVMName, setTargetVMName] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTargetName(`${vmName}-clone`);
      setStripMAC(true);
      setStripFirmwareUUID(true);
      setLabelFilters('');
      setAnnotationFilters('');
      setShowAdvanced(false);
      setCreating(false);
      setCloneName(null);
      setClonePhase('Unknown');
      setCloneDetail('');
      setTargetVMName(null);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, [open, vmName]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const pollClone = useCallback(
    (name: string, fallbackTarget: string) => {
      stopPolling();
      const apiPath = `/apis/clone.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
        namespace
      )}/virtualmachineclones/${encodeURIComponent(name)}`;

      pollRef.current = setInterval(async () => {
        try {
          const res = await ApiProxy.request(apiPath);
          const phase: ClonePhase = res?.status?.phase || 'Unknown';

          if (res?.status?.targetName) {
            setTargetVMName(res.status.targetName);
          }

          // Check conditions for failure even when phase is empty/Unknown
          const conditions: KubeCondition[] = res?.status?.conditions || [];
          const readyCond = findCondition(conditions, 'Ready');
          const progressCond = findCondition(conditions, 'Progressing');

          if (phase === 'Succeeded') {
            stopPolling();
            setClonePhase('Succeeded');
            setCloneDetail('');
            enqueueSnackbar(`Clone completed: ${res?.status?.targetName || fallbackTarget}`, {
              variant: 'success',
            });
          } else if (
            phase === 'Failed' ||
            (readyCond?.status === 'False' && progressCond?.status === 'False')
          ) {
            stopPolling();
            const reason = readyCond?.reason || readyCond?.message || 'Unknown error';
            setClonePhase('Failed');
            setCloneDetail(reason);
            enqueueSnackbar(`Clone failed: ${safeError(new Error(reason), 'clone-poll')}`, {
              variant: 'error',
            });
          } else {
            setClonePhase(phase);
          }
        } catch {
          // Clone resource may have been deleted
          stopPolling();
          setCloneName(null);
          setClonePhase('Unknown');
        }
      }, 3000);

      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setClonePhase('Failed');
        setCloneDetail('Timed out waiting for clone to complete');
      }, 600000); // 10 min timeout for large disks
    },
    [namespace, stopPolling, enqueueSnackbar]
  );

  const handleCreate = useCallback(async () => {
    const trimmed = targetName.trim();
    if (!trimmed) {
      enqueueSnackbar('Target VM name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    const cloneResourceName = `clone-${vmName}-${Date.now()}`.substring(0, 63).replace(/-+$/, '');

    const cloneSpec: CloneResourceSpec = {
      apiVersion: 'clone.kubevirt.io/v1beta1',
      kind: 'VirtualMachineClone',
      metadata: {
        name: cloneResourceName,
        namespace,
      },
      spec: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: vmName,
        },
        target: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: trimmed,
        },
        ...(isKubeVirt18OrNewer() && volumeNamePolicy !== 'RandomizeNames'
          ? { volumeNamePolicy }
          : {}),
      },
    };

    // Label filters
    const lf = labelFilters
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (lf.length > 0) {
      cloneSpec.spec.labelFilters = lf;
    }

    // Annotation filters
    const af = annotationFilters
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (af.length > 0) {
      cloneSpec.spec.annotationFilters = af;
    }

    // Strip MAC addresses — use a patch to clear all interface MAC addresses
    if (stripMAC) {
      if (!cloneSpec.spec.newMacAddresses) {
        cloneSpec.spec.newMacAddresses = {};
      }
      // Empty map = KubeVirt auto-generates new MACs for all interfaces
    }

    // Strip firmware UUID — clear SMBios serial
    if (stripFirmwareUUID) {
      // Empty string = auto-generate new serial
      cloneSpec.spec.newSMBiosSerial = '';
    }

    try {
      await ApiProxy.request(
        `/apis/clone.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          namespace
        )}/virtualmachineclones`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cloneSpec),
        }
      );
      setCloneName(cloneResourceName);
      setClonePhase('Unknown');
      enqueueSnackbar('Clone initiated...', { variant: 'info' });
      pollClone(cloneResourceName, trimmed);
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to create clone: ${safeError(e, 'clone-create')}`, {
        variant: 'error',
      });
      setCreating(false);
    }
  }, [
    targetName,
    vmName,
    namespace,
    labelFilters,
    annotationFilters,
    stripMAC,
    stripFirmwareUUID,
    enqueueSnackbar,
    pollClone,
  ]);

  const nameError = useMemo(() => {
    const v = targetName.trim();
    if (!v) return '';
    if (v === vmName) return 'Target name must differ from source';
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v))
      return 'Must be lowercase alphanumeric with dashes';
    if (v.length > 63) return 'Max 63 characters';
    return '';
  }, [targetName, vmName]);

  const isTracking = !!cloneName;
  const phaseInfo = PHASE_INFO[clonePhase] || PHASE_INFO.Unknown;
  const isComplete = clonePhase === 'Succeeded' || clonePhase === 'Failed';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon="mdi:content-copy" width={22} />
        Clone Virtual Machine
      </DialogTitle>
      <DialogContent>
        {/* Tracking mode */}
        {isTracking ? (
          <Box sx={{ py: 2 }}>
            {!isComplete && (
              <LinearProgress
                sx={{
                  mb: 2,
                  height: 4,
                  borderRadius: 2,
                  '& .MuiLinearProgress-bar': { bgcolor: phaseInfo.color },
                }}
              />
            )}
            <Box display="flex" alignItems="center" gap={1.5} mb={2}>
              {isComplete ? (
                <Icon icon={phaseInfo.icon} width={28} color={phaseInfo.color} />
              ) : (
                <CircularProgress size={24} sx={{ color: phaseInfo.color }} />
              )}
              <Box>
                <Typography variant="body1" fontWeight={600}>
                  {phaseInfo.label}
                </Typography>
                {cloneDetail && (
                  <Typography variant="body2" color="text.secondary">
                    {cloneDetail}
                  </Typography>
                )}
              </Box>
            </Box>

            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 1,
                px: 2,
                py: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              <Box display="flex" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Source
                </Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {vmName}
                </Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Target
                </Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {targetVMName || targetName.trim()}
                </Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Clone resource
                </Typography>
                <Tooltip title={cloneName || ''} arrow>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    noWrap
                  >
                    {cloneName}
                  </Typography>
                </Tooltip>
              </Box>
            </Box>

            {clonePhase === 'Succeeded' && targetVMName && (
              <Alert
                severity="success"
                sx={{ mt: 2 }}
                icon={<Icon icon="mdi:check-circle" width={20} />}
              >
                VM <strong>{targetVMName}</strong> has been created in namespace{' '}
                <strong>{namespace}</strong>.
              </Alert>
            )}
          </Box>
        ) : (
          /* Form mode */
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1, mb: 1 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:information-outline" width={18} color="#78909c" />
                <Typography variant="body2" color="text.secondary">
                  Creates a <strong>VirtualMachineClone</strong> resource. KubeVirt snapshots the
                  source VM, clones all disks, and creates a new VM. The source VM does not need to
                  be stopped.
                </Typography>
              </Box>
            </Box>

            <TextField
              label="Source VM"
              value={vmName}
              fullWidth
              disabled
              InputProps={{
                startAdornment: (
                  <Icon
                    icon="mdi:desktop-classic"
                    width={18}
                    style={{ marginRight: 8, opacity: 0.5 }}
                  />
                ),
              }}
            />

            <TextField
              label="Target VM Name"
              value={targetName}
              onChange={e => setTargetName(e.target.value)}
              fullWidth
              required
              error={!!nameError}
              helperText={nameError || 'Name for the cloned VM'}
            />

            <Box display="flex" gap={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={stripMAC}
                    onChange={e => setStripMAC(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Tooltip title="Generate new MAC addresses for all network interfaces" arrow>
                    <Typography variant="body2" sx={{ cursor: 'help' }}>
                      New MAC addresses
                    </Typography>
                  </Tooltip>
                }
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={stripFirmwareUUID}
                    onChange={e => setStripFirmwareUUID(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Tooltip title="Generate a new SMBios serial for the cloned VM" arrow>
                    <Typography variant="body2" sx={{ cursor: 'help' }}>
                      New firmware UUID
                    </Typography>
                  </Tooltip>
                }
              />
            </Box>

            {isKubeVirt18OrNewer() && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={volumeNamePolicy === 'PrefixTargetName'}
                    onChange={e =>
                      setVolumeNamePolicy(e.target.checked ? 'PrefixTargetName' : 'RandomizeNames')
                    }
                    size="small"
                  />
                }
                label={
                  <Tooltip
                    title="Use predictable PVC names (<target-vm>-<volume-name>) instead of random suffixes"
                    arrow
                  >
                    <Typography variant="body2" sx={{ cursor: 'help' }}>
                      Predictable volume names
                    </Typography>
                  </Tooltip>
                }
              />
            )}

            {/* Advanced */}
            <Box>
              <Button
                size="small"
                onClick={() => setShowAdvanced(!showAdvanced)}
                startIcon={
                  <Icon icon={showAdvanced ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={18} />
                }
                sx={{ textTransform: 'none', color: 'text.secondary' }}
              >
                Advanced options
              </Button>
              <Collapse in={showAdvanced}>
                <Box display="flex" flexDirection="column" gap={2} mt={1}>
                  <TextField
                    label="Label Filters"
                    value={labelFilters}
                    onChange={e => setLabelFilters(e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="e.g., !some/key*, other/key"
                    helperText="Comma-separated. Prefix with ! to exclude. Supports * wildcards."
                  />
                  <TextField
                    label="Annotation Filters"
                    value={annotationFilters}
                    onChange={e => setAnnotationFilters(e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="e.g., !internal/*, keep/this"
                    helperText="Comma-separated. Prefix with ! to exclude. Supports * wildcards."
                  />
                  <Alert severity="info" variant="outlined" sx={{ fontSize: '0.8rem' }}>
                    <Typography variant="body2">
                      Filters control which labels/annotations are copied to the target VM. By
                      default, all are copied. Use <code>!key*</code> to exclude patterns.
                    </Typography>
                  </Alert>
                </Box>
              </Collapse>
            </Box>

            <Box display="flex" gap={1} flexWrap="wrap">
              <Chip
                icon={<Icon icon="mdi:harddisk" width={16} />}
                label="All disks cloned"
                size="small"
                variant="outlined"
              />
              <Chip
                icon={<Icon icon="mdi:camera" width={16} />}
                label="Snapshot-based"
                size="small"
                variant="outlined"
              />
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {isTracking ? (
          <Button onClick={onClose}>
            {isComplete ? 'Close' : 'Close (cloning continues in background)'}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={creating || !targetName.trim() || !!nameError}
              startIcon={
                creating ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Icon icon="mdi:content-copy" />
                )
              }
            >
              {creating ? 'Creating...' : 'Clone'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
