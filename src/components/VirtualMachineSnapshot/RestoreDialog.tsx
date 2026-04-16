import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
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
import { TOOLTIPS } from '../../utils/tooltips';
import InfoTooltip from '../common/InfoTooltip';

interface RestoreDialogProps {
  open: boolean;
  onClose: () => void;
  snapshotName: string;
  vmName: string;
  namespace: string;
}

type RestorePhase = 'Unknown' | 'InProgress' | 'Succeeded' | 'Failed';

const PHASE_INFO: Record<string, { label: string; color: string; icon: string }> = {
  InProgress: { label: 'Restoring...', color: '#2196f3', icon: 'mdi:restore' },
  Succeeded: { label: 'Restore completed', color: '#3e8635', icon: 'mdi:check-circle' },
  Failed: { label: 'Restore failed', color: '#c9190b', icon: 'mdi:alert-circle' },
  Unknown: { label: 'Initializing...', color: '#78909c', icon: 'mdi:help-circle-outline' },
};

type ReadinessPolicy = 'StopTarget' | 'WaitGracePeriod' | 'FailImmediate';

interface RestoreResourceSpec {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string };
  spec: {
    target: { apiGroup: string; kind: string; name: string };
    virtualMachineSnapshotName: string;
    targetReadinessPolicy?: ReadinessPolicy;
    volumeRestorePolicy?: string;
  };
}

export default function RestoreDialog({
  open,
  onClose,
  snapshotName,
  vmName,
  namespace,
}: RestoreDialogProps) {
  const { enqueueSnackbar } = useSnackbar();

  // Form state
  const [restoreMode, setRestoreMode] = useState<'same' | 'new'>('same');
  const [newVmName, setNewVmName] = useState('');
  const [readinessPolicy, setReadinessPolicy] = useState<ReadinessPolicy>('StopTarget');
  const [usePrefix, setUsePrefix] = useState(false);

  // Progress state
  const [creating, setCreating] = useState(false);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>('Unknown');
  const [restoreDetail, setRestoreDetail] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setRestoreMode('same');
      setNewVmName(`${vmName}-restored`);
      setReadinessPolicy('StopTarget');
      setCreating(false);
      setRestoreName(null);
      setRestorePhase('Unknown');
      setRestoreDetail('');
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

  const pollRestore = useCallback(
    (name: string) => {
      stopPolling();
      const apiPath = `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
        namespace
      )}/virtualmachinerestores/${encodeURIComponent(name)}`;

      pollRef.current = setInterval(async () => {
        if (!mountedRef.current) {
          stopPolling();
          return;
        }
        try {
          const res = await ApiProxy.request(apiPath);
          if (!mountedRef.current) return;
          const conditions: KubeCondition[] = res?.status?.conditions || [];
          const ready = findCondition(conditions, 'Ready');
          const progressing = findCondition(conditions, 'Progressing');

          if (ready?.status === 'True') {
            stopPolling();
            setRestorePhase('Succeeded');
            setRestoreDetail('');
            enqueueSnackbar('Restore completed successfully', { variant: 'success' });
          } else if (ready?.status === 'False' && progressing?.status === 'False') {
            stopPolling();
            const reason = ready?.reason || ready?.message || 'Unknown error';
            setRestorePhase('Failed');
            setRestoreDetail(String(reason));
            enqueueSnackbar(`Restore failed: ${safeError(reason, 'restore-poll')}`, {
              variant: 'error',
            });
          } else if (progressing?.status === 'True') {
            setRestorePhase('InProgress');
          }
        } catch {
          if (!mountedRef.current) return;
          stopPolling();
          setRestoreName(null);
          setRestorePhase('Unknown');
        }
      }, 3000);

      pollTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        stopPolling();
        setRestorePhase('Failed');
        setRestoreDetail('Timed out waiting for restore to complete');
      }, 600000);
    },
    [namespace, stopPolling, enqueueSnackbar]
  );

  const targetVmName = useMemo(
    () => (restoreMode === 'same' ? vmName : newVmName.trim()),
    [restoreMode, vmName, newVmName]
  );

  const handleCreate = useCallback(async () => {
    if (!targetVmName) {
      enqueueSnackbar('Target VM name is required', { variant: 'error' });
      return;
    }

    setCreating(true);
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const restoreResourceName =
      `restore-${snapshotName}-${randomSuffix}`.substring(0, 63).replace(/-+$/, '') ||
      `restore-${randomSuffix}`;

    const restoreSpec: RestoreResourceSpec = {
      apiVersion: 'snapshot.kubevirt.io/v1beta1',
      kind: 'VirtualMachineRestore',
      metadata: {
        name: restoreResourceName,
        namespace,
      },
      spec: {
        target: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: targetVmName,
        },
        virtualMachineSnapshotName: snapshotName,
      },
    };

    if (isKubeVirt18OrNewer() && usePrefix) {
      restoreSpec.spec.volumeRestorePolicy = 'PrefixTargetName';
    }

    // Only set readiness policy when restoring to same VM
    if (restoreMode === 'same') {
      restoreSpec.spec.targetReadinessPolicy = readinessPolicy;
    }

    try {
      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          namespace
        )}/virtualmachinerestores`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(restoreSpec),
        }
      );
      setRestoreName(restoreResourceName);
      setRestorePhase('Unknown');
      enqueueSnackbar('Restore initiated...', { variant: 'info' });
      pollRestore(restoreResourceName);
    } catch (e: unknown) {
      enqueueSnackbar(`Failed to create restore: ${safeError(e, 'restore-create')}`, {
        variant: 'error',
      });
      setCreating(false);
    }
  }, [
    targetVmName,
    snapshotName,
    namespace,
    restoreMode,
    readinessPolicy,
    enqueueSnackbar,
    pollRestore,
  ]);

  const nameError = useMemo(() => {
    if (restoreMode === 'same') return '';
    const v = newVmName.trim();
    if (!v) return '';
    if (v === vmName) return 'Use "Restore to same VM" mode instead';
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v))
      return 'Must be lowercase alphanumeric with dashes';
    if (v.length > 63) return 'Max 63 characters';
    return '';
  }, [restoreMode, newVmName, vmName]);

  const isTracking = !!restoreName;
  const phaseInfo = PHASE_INFO[restorePhase] || PHASE_INFO.Unknown;
  const isComplete = restorePhase === 'Succeeded' || restorePhase === 'Failed';

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
            <Box display="flex" alignItems="center" gap={1}>
              <Icon icon="mdi:restore" width={22} />
              <Typography variant="h6">Restore Snapshot</Typography>
            </Box>
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <Icon icon="mdi:close" width={20} />
            </IconButton>
          </Box>

          {isTracking ? (
            <Box>
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
                  {restoreDetail && (
                    <Typography variant="body2" color="text.secondary">
                      {safeError(restoreDetail, 'restore-detail')}
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
                <Box display="flex" justifyContent="space-between" alignItems="baseline" gap={2}>
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    Snapshot
                  </Typography>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{ textAlign: 'right', wordBreak: 'break-all' }}
                  >
                    {snapshotName}
                  </Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="baseline" gap={2}>
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    Target VM
                  </Typography>
                  <Link routeName="virtualmachine" params={{ name: targetVmName, namespace }}>
                    <Typography variant="body2" fontFamily="monospace" sx={{ textAlign: 'right' }}>
                      {targetVmName}
                    </Typography>
                  </Link>
                </Box>
              </Box>

              {restorePhase === 'Succeeded' && (
                <Alert
                  severity="success"
                  variant="filled"
                  sx={{ mt: 2 }}
                  icon={<Icon icon="mdi:check-circle" width={20} />}
                >
                  VM{' '}
                  <Link
                    routeName="virtualmachine"
                    params={{ name: targetVmName, namespace }}
                    style={{ color: 'inherit', fontWeight: 700 }}
                  >
                    {targetVmName}
                  </Link>{' '}
                  has been restored from snapshot <strong>{snapshotName}</strong>.
                </Alert>
              )}

              <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={onClose}>
                  {isComplete ? 'Close' : 'Close (restore continues in background)'}
                </Button>
              </Box>
            </Box>
          ) : (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Snapshot: {snapshotName}
              </Typography>

              <FormControl sx={{ mb: 2 }}>
                <RadioGroup
                  value={restoreMode}
                  onChange={e => setRestoreMode(e.target.value as 'same' | 'new')}
                >
                  <FormControlLabel
                    value="same"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2">
                          Restore to the same VM (<strong>{vmName}</strong>){' '}
                          <InfoTooltip text={TOOLTIPS.restoreToSameVM} />
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Overwrites the current VM disks and configuration
                        </Typography>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="new"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2">
                          Restore to a new VM <InfoTooltip text={TOOLTIPS.restoreToNewVM} />
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Creates a new VM from the snapshot (same configuration)
                        </Typography>
                      </Box>
                    }
                  />
                </RadioGroup>
              </FormControl>

              {restoreMode === 'new' && (
                <TextField
                  label="New VM Name"
                  value={newVmName}
                  onChange={e => setNewVmName(e.target.value)}
                  fullWidth
                  size="small"
                  required
                  error={!!nameError}
                  helperText={nameError || 'Name for the restored VM'}
                  sx={{ mb: 2 }}
                />
              )}

              {restoreMode === 'same' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Readiness Policy
                  </Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={readinessPolicy}
                      onChange={e => setReadinessPolicy(e.target.value as ReadinessPolicy)}
                    >
                      <MenuItem value="StopTarget">Stop VM automatically</MenuItem>
                      <MenuItem value="WaitGracePeriod">
                        Wait for VM to stop (5 min timeout)
                      </MenuItem>
                      <MenuItem value="FailImmediate">Fail if VM is running</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}

              {isKubeVirt18OrNewer() && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={usePrefix}
                      onChange={e => setUsePrefix(e.target.checked)}
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

              {restoreMode === 'same' && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2, '& .MuiAlert-message': { color: '#ffb74d' } }}
                >
                  This will overwrite the current VM disks and configuration. Make sure you have a
                  backup or another snapshot if needed.
                </Alert>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={onClose} disabled={creating}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleCreate}
                  disabled={creating || !targetVmName || !!nameError}
                >
                  {creating ? 'Restoring...' : 'Restore'}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
